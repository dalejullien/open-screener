import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, MarketData, TimeframeId, TimeframeInfo } from "../lib/types";
import { INTERVAL_SEC, fetchAllTickers, fetchCandles, fetchPrices, pool, type Interval } from "./binance";
import { BENCHMARK, mergeMarkets, selectUniverse, type ClassFilter, type MarketFilter, type UniverseMode } from "./universe";

export interface LoadState {
  phase: "idle" | "loading" | "done" | "error";
  done: number;
  total: number;
  ms: number;
  at: Date | null;
  skipped: string[];
  missing: string[];
  listed: { spot: number; perp: number; coins: number };
  /** Symbols the user asked to scan (benchmarks may be loaded in addition). */
  universe: Set<string>;
  /** When prices/24h change were last refreshed (every minute, independent of candles). */
  pricesAt: Date | null;
  error?: string;
  warning?: string;
}

interface TfConfig {
  primary: Interval;
  lower: Interval;
  primaryBars: number;
  lowerBars: number;
  minPrimary: number;
  info: TimeframeInfo;
}

// 4h history ~83 days so recent days can be replayed for "detected on" dates (still request weight 2).
// Intraday views: trend on the chosen bars, entries one step lower (4h → 1h, 1h → 15m).
export const TIMEFRAMES: Record<TimeframeId, TfConfig> = {
  "1H": { primary: "1h", lower: "15m", primaryBars: 300, lowerBars: 499, minPrimary: 60, info: { id: "1H", label: "1-hour", lowerLabel: "15m", primarySec: 3_600, lowerSec: 900 } },
  "4H": { primary: "4h", lower: "1h", primaryBars: 300, lowerBars: 499, minPrimary: 60, info: { id: "4H", label: "4-hour", lowerLabel: "1h", primarySec: 14_400, lowerSec: 3_600 } },
  D: { primary: "1d", lower: "4h", primaryBars: 300, lowerBars: 499, minPrimary: 60, info: { id: "D", label: "Daily", lowerLabel: "4h", primarySec: 86_400, lowerSec: 14_400 } },
  "3D": { primary: "3d", lower: "1d", primaryBars: 300, lowerBars: 300, minPrimary: 40, info: { id: "3D", label: "3-day", lowerLabel: "daily", primarySec: INTERVAL_SEC["3d"], lowerSec: 86_400 } },
  W: { primary: "1w", lower: "1d", primaryBars: 300, lowerBars: 300, minPrimary: 40, info: { id: "W", label: "Weekly", lowerLabel: "daily", primarySec: INTERVAL_SEC["1w"], lowerSec: 86_400 } },
};
const CONCURRENCY = 16;
const PUBLISH_EVERY = 40; // push partial results to the UI every N coins
const PRICE_EVERY_MS = 60_000;
const FALLBACK_SCAN_MS = 15 * 60_000;
const FOUR_HOURS = 4 * 3600_000;

/** Next candle close for a bar size (default 4h: 00/04/08/12/16/20 UTC — daily closes coincide with 00:00). */
export const nextBarClose = (now = Date.now(), ms = FOUR_HOURS) => Math.floor(now / ms) * ms + ms;

/** Loads the universe and its candles straight from Binance in the browser, streaming results in. */
export function useMarket(mode: UniverseMode, top: number, watchlist: string[], market: MarketFilter, cls: ClassFilter, tfId: TimeframeId = "D") {
  const [data, setData] = useState<MarketData[]>([]);
  const [state, setState] = useState<LoadState>({
    phase: "idle", done: 0, total: 0, ms: 0, at: null, skipped: [], missing: [], listed: { spot: 0, perp: 0, coins: 0 }, universe: new Set(), pricesAt: null,
  });
  const run = useRef(0);
  const [candleVersion, setCandleVersion] = useState(0);

  const load = useCallback(async () => {
    const id = ++run.current;
    const tf = TIMEFRAMES[tfId];
    const live = () => run.current === id;
    const t0 = performance.now();
    setState((s) => ({ ...s, phase: "loading", done: 0, error: undefined }));
    try {
      const { spot, perp, perpError } = await fetchAllTickers();
      const all = mergeMarkets(spot, perp);
      const { assets, missing } = selectUniverse(all, mode, top, watchlist, market, cls);
      // Benchmarks for every class in view are loaded first (relative strength needs them).
      const classes = new Set(assets.map((a) => a.assetClass));
      const benches = all.filter((a) => classes.has(a.assetClass) && a.base === BENCHMARK[a.assetClass]);
      const list: Asset[] = [...benches, ...assets.filter((a) => !benches.includes(a))];
      if (!live()) return;
      setState((s) => ({
        ...s,
        total: list.length,
        universe: new Set(assets.map((a) => a.symbol)),
        listed: { spot: spot.length, perp: perp.length, coins: all.length },
        warning: perpError ? `Perpetuals unavailable (${perpError}) — showing spot only.` : undefined,
      }));

      const loaded: MarketData[] = [];
      let done = 0;
      const results = await pool(
        list,
        CONCURRENCY,
        async (asset) => {
          const [daily, h4] = await Promise.all([
            fetchCandles(asset.source, asset.symbol, tf.primary, tf.primaryBars),
            fetchCandles(asset.source, asset.symbol, tf.lower, tf.lowerBars),
          ]);
          if (daily.length < tf.minPrimary || h4.length < 40) throw new Error("not enough history");
          return { asset, daily, h4, tf: tf.info } satisfies MarketData;
        },
        (r) => {
          if (!live()) return;
          done++;
          if (r.ok) loaded.push(r.value);
          if (done % PUBLISH_EVERY === 0) setData([...loaded]);
          setState((s) => ({ ...s, done }));
        },
      );
      if (!live()) return;
      setData([...loaded]);
      setCandleVersion((v) => v + 1);
      setState((s) => ({
        ...s,
        phase: "done",
        done: list.length,
        ms: performance.now() - t0,
        at: new Date(),
        skipped: results.flatMap((r) => (r.ok ? [] : [r.item.base])),
        missing,
      }));
    } catch (e) {
      if (live()) setState((s) => ({ ...s, phase: "error", error: (e as Error).message }));
    }
  }, [mode, top, watchlist, market, cls, tfId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live prices: cheap (2 ticker calls), so scores using price stay current between bar closes.
  const refreshPrices = useCallback(async () => {
    try {
      // Price-only feed (~36 KB). 24h change and volume refresh with the 15-minute rescan.
      const prices = await fetchPrices();
      setData((prev) =>
        prev.map((d) => {
          const p = prices[d.asset.source].get(d.asset.symbol);
          return p ? { ...d, asset: { ...d.asset, price: p } } : d;
        }),
      );
      setState((s) => ({ ...s, pricesAt: new Date() }));
    } catch {
      // transient — next tick retries
    }
  }, []);

  useEffect(() => {
    const prices = setInterval(() => document.visibilityState === "visible" && refreshPrices(), PRICE_EVERY_MS);
    // Rescan ~30s after every 4h/daily close (when signals can actually change), plus a slow fallback.
    let barTimer: ReturnType<typeof setTimeout>;
    const scheduleBar = () => {
      barTimer = setTimeout(() => {
        load();
        scheduleBar();
      }, nextBarClose(Date.now(), Math.min(FOUR_HOURS, TIMEFRAMES[tfId].info.lowerSec * 1000)) - Date.now() + 30_000);
    };
    scheduleBar();
    const fallback = setInterval(load, FALLBACK_SCAN_MS);
    return () => {
      clearInterval(prices);
      clearInterval(fallback);
      clearTimeout(barTimer);
    };
  }, [load, refreshPrices, tfId]);

  return { data, state, reload: load, candleVersion };
}
