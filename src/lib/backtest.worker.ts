/// <reference lib="webworker" />
import { SCANNERS, defaultParams } from "../scanners";
import { backtestScanner, type BacktestOptions, type BacktestResult } from "./backtest";
import type { MarketData, Params } from "./types";

export interface BacktestRequest {
  data: MarketData[];
  params: Record<string, Params>;
  opts: BacktestOptions;
  scannerIds: string[];
}

export type BacktestMessage =
  | { type: "progress"; scannerId: string; done: number; total: number }
  | { type: "result"; result: BacktestResult }
  | { type: "done" };

// Runs off the main thread: replaying ~100 coins × 240 days × every tool is CPU-heavy.
self.onmessage = (e: MessageEvent<BacktestRequest>) => {
  const { data, params, opts, scannerIds } = e.data;
  for (const s of SCANNERS.filter((x) => scannerIds.includes(x.id))) {
    let last = 0;
    const result = backtestScanner(s, data, { ...defaultParams(s), ...params[s.id] }, opts, (done, total) => {
      if (done - last >= 10 || done === total) {
        last = done;
        self.postMessage({ type: "progress", scannerId: s.id, done, total } satisfies BacktestMessage);
      }
    });
    self.postMessage({ type: "result", result } satisfies BacktestMessage);
  }
  self.postMessage({ type: "done" } satisfies BacktestMessage);
};
