import { runScanner } from "../scanners";
import type { MarketData, Params, Scanner, Signal } from "./types";


/**
 * The market as it looked `k` daily closes ago: daily bars up to that close, and only the 4h bars
 * that had completed by then. Running a scanner on this is exactly what it would have shown that
 * day — the basis for "detected on" dates, rank changes and (later) backtests. No look-ahead.
 */
export function sliceAt(d: MarketData, k: number): MarketData | null {
  if (k === 0) return d;
  const daily = d.daily.slice(0, d.daily.length - k);
  if (daily.length < 40) return null;
  const end = daily[daily.length - 1].time + d.tf.primarySec;
  const h4 = d.h4.filter((c) => c.time + d.tf.lowerSec <= end);
  if (h4.length < 40) return null;
  return { ...d, asset: { ...d.asset, price: daily[daily.length - 1].close }, daily, h4 };
}

export interface History {
  /** Open time of the daily bar on which the current run of pass/trigger began. */
  since: number;
  /** Completed days the setup has been active (0 = new on the latest close). */
  days: number;
  /** True when still active at the oldest replayed day. */
  atLeast: boolean;
  priceAtDetect: number;
  /** For ranked tools: places gained (+) or lost (−) vs 7 days ago. */
  rankChange?: number;
}

const active = (s?: Signal) => s?.status === "trigger" || s?.status === "pass";
const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

/** Places in the ranking (1 = best) within each asset class, by score. */
function placeMap(signals: Signal[], data: Map<string, MarketData>) {
  const groups = new Map<string, Signal[]>();
  for (const s of signals) {
    if (s.raw === undefined) continue;
    const cls = data.get(s.symbol)?.asset.assetClass ?? "";
    groups.set(cls, [...(groups.get(cls) ?? []), s]);
  }
  const places = new Map<string, number>();
  for (const g of groups.values()) [...g].sort((a, b) => b.score - a.score).forEach((s, i) => places.set(s.symbol, i + 1));
  return places;
}

/**
 * Walk back day by day until each active setup stops being active. Scanners with a cross-sectional
 * `finalize` (rankings) are replayed on the whole universe; others only on the active symbols.
 */
export async function computeHistory(
  scanner: Scanner,
  data: MarketData[],
  params: Params,
  current: Signal[],
  isCancelled: () => boolean,
  maxDays = 45,
): Promise<Map<string, History>> {
  const bySymbol = new Map(data.map((d) => [d.asset.symbol, d]));
  const remaining = new Set(current.filter(active).map((s) => s.symbol));
  const sinceK = new Map<string, number>([...remaining].map((s) => [s, 0]));
  const cross = !!scanner.finalize;
  const out = new Map<string, History>();

  let rankAgo: Map<string, number> | null = null;
  const rankNow = cross ? placeMap(current, bySymbol) : null;

  for (let k = 1; k <= maxDays && (remaining.size || (cross && k <= 7 && !rankAgo)); k++) {
    if (isCancelled()) return out;
    const subset = cross ? data : data.filter((d) => remaining.has(d.asset.symbol) || d.asset.base === "BTC" || d.asset.base === "SPY" || d.asset.base === "XAU");
    const sliced = subset.map((d) => sliceAt(d, k)).filter((d): d is MarketData => d !== null);
    const sigs = new Map(runScanner(scanner, sliced, params).map((s) => [s.symbol, s]));
    if (cross && k === 7) rankAgo = placeMap([...sigs.values()], bySymbol);
    for (const sym of [...remaining]) {
      if (active(sigs.get(sym))) sinceK.set(sym, k);
      else remaining.delete(sym);
    }
    await yieldToUI();
  }

  for (const [sym, k] of sinceK) {
    const d = bySymbol.get(sym);
    if (!d) continue;
    const bar = d.daily[d.daily.length - 1 - k];
    if (!bar) continue;
    out.set(sym, {
      since: bar.time,
      days: k,
      atLeast: k === maxDays && remaining.has(sym),
      priceAtDetect: bar.close,
      rankChange: rankNow && rankAgo?.has(sym) && rankNow.has(sym) ? rankAgo.get(sym)! - rankNow.get(sym)! : undefined,
    });
  }
  // Rank change for ranked tools also matters for assets that aren't passing.
  if (rankNow && rankAgo) {
    for (const [sym, place] of rankNow) {
      if (out.has(sym) || !rankAgo.has(sym)) continue;
      out.set(sym, { since: 0, days: -1, atLeast: false, priceAtDetect: NaN, rankChange: rankAgo.get(sym)! - place });
    }
  }
  return out;
}
