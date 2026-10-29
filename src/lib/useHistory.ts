import { useEffect, useState } from "react";
import { SCANNERS, defaultParams } from "../scanners";
import { computeHistory, type History } from "./replay";
import type { MarketData, Params, Signal } from "./types";

/**
 * Replays every tool over recent days in the background after each candle load (not on price
 * ticks), filling in "detected on" dates and rank changes tool by tool.
 */
export function useHistory(data: MarketData[], candleVersion: number, results: Map<string, Signal[]>, allParams: Record<string, Params>) {
  const [history, setHistory] = useState<Map<string, Map<string, History>>>(new Map());

  useEffect(() => {
    if (!data.length) return;
    let cancelled = false;
    (async () => {
      for (const s of SCANNERS) {
        const h = await computeHistory(s, data, { ...defaultParams(s), ...allParams[s.id] }, results.get(s.id) ?? [], () => cancelled);
        if (cancelled) return;
        setHistory((prev) => new Map(prev).set(s.id, h));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when candles or parameters change — price ticks don't alter completed bars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleVersion, allParams]);

  return history;
}
