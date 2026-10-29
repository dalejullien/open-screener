import type { MarketData, Params, ScanContext, Scanner, Signal } from "../lib/types";
import { BENCHMARK } from "../data/universe";
import { breakout } from "./breakout";
import { relativeStrength } from "./relativeStrength";
import { trend } from "./trend";
import { volSqueeze } from "./volSqueeze";
import { sTier } from "./sTier";
import { chartPatterns } from "./chartPatterns";
import { secondChance } from "./secondChance";

/** Register new strategies here. Order = sidebar order. */
export const SCANNERS: Scanner[] = [sTier, trend, secondChance, relativeStrength, volSqueeze, breakout, chartPatterns];

export const defaultParams = (s: Scanner): Params => Object.fromEntries(s.params.map((d) => [d.key, d.default]));

export function runScanner(s: Scanner, data: MarketData[], params: Params): Signal[] {
  const benchmarks: ScanContext["benchmarks"] = {};
  for (const d of data) if (d.asset.base === BENCHMARK[d.asset.assetClass]) benchmarks[d.asset.assetClass] = d;
  const out: Signal[] = [];
  for (const d of data) {
    try {
      out.push(s.run(d, params, { benchmarks }));
    } catch {
      // one bad series shouldn't sink the scan; the asset is simply absent from this tool
    }
  }
  s.finalize?.(out, params);
  return out;
}

export interface ConfluenceRow {
  symbol: string;
  hits: { scanner: Scanner; signal: Signal }[];
  score: number; // sum of trigger=2 / pass=1 across scanners
}

/** Equal weights for now; Phase 2 replaces these with backtested weights. */
export function confluence(results: Map<string, Signal[]>): ConfluenceRow[] {
  const rows = new Map<string, ConfluenceRow>();
  for (const s of SCANNERS) {
    for (const sig of results.get(s.id) ?? []) {
      const row = rows.get(sig.symbol) ?? { symbol: sig.symbol, hits: [], score: 0 };
      // Long-side ranking: bearish signals (e.g. a confirmed double top) don't add confluence.
      if ((sig.status === "trigger" || sig.status === "pass") && sig.direction !== "bearish") {
        row.hits.push({ scanner: s, signal: sig });
        row.score += sig.status === "trigger" ? 2 : 1;
      }
      rows.set(sig.symbol, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.score - a.score || b.hits.length - a.hits.length);
}
