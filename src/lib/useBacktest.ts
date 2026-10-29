import { useCallback, useRef, useState } from "react";
import { fetchDeepCandles, pool } from "../data/binance";
import { TIMEFRAMES } from "../data/useMarket";
import { SCANNERS } from "../scanners";
import type { BacktestOptions, BacktestResult } from "./backtest";
import type { BacktestMessage, BacktestRequest } from "./backtest.worker";
import type { Asset, MarketData, Params } from "./types";
import { usePersisted } from "./usePersisted";

export interface BacktestProgress {
  phase: "idle" | "download" | "run" | "done" | "error";
  done: number;
  total: number;
  label: string;
  error?: string;
}

export const DEFAULT_BT: BacktestOptions & { coins: number } = { coins: 100, days: 240, maxHold: 20, feePct: 0.1 };

/** Keep stored results small: stats + the most recent trades. */
// Keep every trade (with its entry conditions) so the Patterns analysis can use the full sample.
const compact = (r: BacktestResult): BacktestResult => ({ ...r, trades: [...r.trades].sort((a, b) => b.entryTime - a.entryTime).slice(0, 4000) });

/** Downloads deep daily + 4h history for the chosen coins, then replays every tool in a Web Worker. */
export function useBacktest() {
  const [results, setResults] = usePersisted<Record<string, BacktestResult>>("backtests", {});
  const [progress, setProgress] = useState<BacktestProgress>({ phase: "idle", done: 0, total: 0, label: "" });
  const worker = useRef<Worker | null>(null);

  const run = useCallback(
    async (assets: Asset[], benchmarks: Asset[], params: Record<string, Params>, opts = DEFAULT_BT) => {
      worker.current?.terminate();
      const coins = [...assets].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, opts.coins);
      const list = [...benchmarks.filter((b) => !coins.includes(b)), ...coins];
      const dailyBars = 300 + opts.days + 1;
      const h4Bars = 499 + opts.days * 6 + 6;
      setProgress({ phase: "download", done: 0, total: list.length, label: "Downloading history" });
      let done = 0;
      const tf = TIMEFRAMES.D.info;
      const loaded = await pool(list, 8, async (asset) => {
        const [daily, h4] = await Promise.all([
          fetchDeepCandles(asset.source, asset.symbol, "1d", dailyBars),
          fetchDeepCandles(asset.source, asset.symbol, "4h", h4Bars),
        ]);
        return { asset, daily, h4, tf } satisfies MarketData;
      }, () => {
        const n = ++done;
        setProgress((p) => ({ ...p, done: n }));
      });
      const data = loaded.flatMap((r) => (r.ok && r.value.daily.length > 120 ? [r.value] : []));

      setProgress({ phase: "run", done: 0, total: SCANNERS.length * opts.days, label: "Replaying strategies" });
      const w = new Worker(new URL("./backtest.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      const offsets = new Map(SCANNERS.map((s, i) => [s.id, i * opts.days]));
      w.onmessage = (e: MessageEvent<BacktestMessage>) => {
        const m = e.data;
        if (m.type === "progress") {
          const name = SCANNERS.find((s) => s.id === m.scannerId)?.name ?? "";
          setProgress((p) => ({ ...p, done: (offsets.get(m.scannerId) ?? 0) + m.done, label: `Replaying ${name}` }));
        } else if (m.type === "result") {
          setResults((prev) => ({ ...prev, [m.result.scannerId]: compact(m.result) }));
        } else {
          setProgress((p) => ({ ...p, phase: "done", label: `Done — ${data.length} coins × ${opts.days} days` }));
          w.terminate();
        }
      };
      w.onerror = (err) => setProgress((p) => ({ ...p, phase: "error", error: err.message }));
      w.postMessage({ data, params, opts, scannerIds: SCANNERS.map((s) => s.id) } satisfies BacktestRequest);
    },
    [setResults],
  );

  return { results, progress, run };
}
