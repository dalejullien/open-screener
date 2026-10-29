import { useEffect, useMemo, useRef, useState } from "react";
import { patternMatchTool, toSignal } from "../scanners/patternMatch";
import type { PMResult } from "./patternMatch";
import type { PMRequest, PMResponse } from "./patternMatch.worker";
import type { MarketData, Params, Signal } from "./types";

/** Runs Pattern Match in a worker after each candle load (and when its parameters change). */
export function usePatternMatch(data: MarketData[], candleVersion: number, universe: Set<string>, params: Params, enabled: boolean) {
  const [results, setResults] = useState<PMResult[]>([]);
  const [ms, setMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);
  const p = useMemo(() => ({ len: params.len ?? patternMatchTool.params[0].default, horizon: params.horizon ?? patternMatchTool.params[1].default }), [params]);

  useEffect(() => {
    if (!enabled || !data.length) return;
    const id = ++reqId.current;
    const w = new Worker(new URL("./patternMatch.worker.ts", import.meta.url), { type: "module" });
    setBusy(true);
    w.onmessage = (e: MessageEvent<PMResponse>) => {
      if (e.data.id === reqId.current) {
        setResults(e.data.results);
        setMs(e.data.ms);
        setBusy(false);
      }
      w.terminate();
    };
    w.postMessage({
      id,
      series: data.map((d) => ({ symbol: d.asset.symbol, base: d.asset.base, times: d.daily.map((c) => c.time), closes: d.daily.map((c) => c.close) })),
      queries: data.filter((d) => universe.has(d.asset.symbol)).map((d) => d.asset.symbol),
      len: p.len,
      horizon: p.horizon,
    } satisfies PMRequest);
    return () => w.terminate();
    // Only completed candles matter, not live price ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleVersion, p, enabled, universe]);

  const signals: Signal[] = useMemo(() => {
    const lib = new Map(data.map((d) => [d.asset.symbol, d]));
    return results.flatMap((r) => {
      const d = lib.get(r.symbol);
      return d ? [toSignal(r, d, lib, p)] : [];
    });
    // Rebuild only when results arrive; data identity changes every price tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, p]);

  return { signals, ms, busy };
}
