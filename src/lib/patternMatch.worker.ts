/// <reference lib="webworker" />
import { matchAll, type PMResult, type PMSeries } from "./patternMatch";

export interface PMRequest {
  id: number;
  series: PMSeries[];
  queries: string[];
  len: number;
  horizon: number;
}

export interface PMResponse {
  id: number;
  results: PMResult[];
  ms: number;
}

// Comparing every coin's recent shape with ~40k historical windows is CPU-heavy; keep it off the UI thread.
self.onmessage = (e: MessageEvent<PMRequest>) => {
  const t0 = performance.now();
  const { id, series, queries, len, horizon } = e.data;
  const results = matchAll(series, queries, len, horizon);
  self.postMessage({ id, results, ms: performance.now() - t0 } satisfies PMResponse);
};
