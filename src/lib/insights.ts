import type { Trade } from "./backtest";

/**
 * "What separates winners from losers": groups backtest trades by the conditions at entry and
 * compares win rate and average R per group. A pattern only counts as reliable when it holds in
 * both the earlier and the later half of the trades (a simple out-of-sample check).
 */

export type TradeWithConf = Trade & { conf: number; tool: string };

interface Bucket {
  label: string;
  test: (v: number) => boolean;
}

export interface Factor {
  key: string;
  name: string;
  buckets: Bucket[];
}

const ranges = (cuts: number[], unit: string, fmt = (v: number) => `${v}`): Bucket[] =>
  cuts.slice(0, -1).map((lo, i) => {
    const hi = cuts[i + 1];
    const label = !isFinite(lo) ? `< ${fmt(hi)}${unit}` : !isFinite(hi) ? `> ${fmt(lo)}${unit}` : `${fmt(lo)} to ${fmt(hi)}${unit}`;
    return { label, test: (v: number) => v >= lo && v < hi };
  });
const yesNo = (yes: string, no: string): Bucket[] => [
  { label: yes, test: (v) => v === 1 },
  { label: no, test: (v) => v === 0 },
];
const INF = Infinity;

export const FACTORS: Factor[] = [
  { key: "btcUp", name: "BTC trend", buckets: yesNo("BTC above its 50-day EMA", "BTC below its 50-day EMA") },
  { key: "btc7", name: "BTC over the last 7 days", buckets: ranges([-INF, -5, 0, 5, INF], "%") },
  { key: "above50", name: "Coin vs its 50-day EMA", buckets: yesNo("Coin above its 50-day EMA", "Coin below its 50-day EMA") },
  { key: "ext", name: "How stretched above the 20-day EMA", buckets: ranges([-INF, 0, 1, 2, INF], " ATR") },
  { key: "rsi", name: "Daily RSI at entry", buckets: ranges([-INF, 50, 60, 70, INF], "") },
  { key: "rvol", name: "Volume vs 20-day average", buckets: ranges([-INF, 1, 2, 4, INF], "×") },
  { key: "stopPct", name: "Stop distance", buckets: ranges([-INF, 5, 10, 15, INF], "%") },
  { key: "ret7", name: "Coin's move over the last 7 days", buckets: ranges([-INF, 0, 15, 40, INF], "%") },
  { key: "ret30", name: "Coin's move over the last 30 days", buckets: ranges([-INF, 0, 30, 100, INF], "%") },
  { key: "atrPct", name: "Coin volatility (daily ATR)", buckets: ranges([-INF, 5, 8, 12, INF], "%") },
  {
    key: "conf",
    name: "Other strategies firing on the same coin",
    buckets: [
      { label: "None (alone)", test: (v) => v === 0 },
      { label: "1 other", test: (v) => v === 1 },
      { label: "2 or more", test: (v) => v >= 2 },
    ],
  },
];

export interface Group {
  n: number;
  winRate: number;
  avgR: number;
}

const stats = (ts: TradeWithConf[]): Group => ({
  n: ts.length,
  winRate: ts.length ? (ts.filter((t) => t.r > 0).length / ts.length) * 100 : 0,
  avgR: ts.length ? ts.reduce((s, t) => s + t.r, 0) / ts.length : 0,
});

export interface BucketResult extends Group {
  factor: Factor;
  label: string;
  dWin: number; // win-rate difference vs all trades (percentage points)
  dR: number;
  consistent: boolean; // same direction in the early and late halves
}

export interface Insights {
  all: Group;
  factors: { factor: Factor; buckets: BucketResult[]; spread: number }[];
  best: BucketResult[];
  worst: BucketResult[];
  combo?: { rule: string; kept: Group; early: Group; late: Group; skipped: number };
}

/** Minimum trades in a group before we report it. */
export const MIN_N = 25;

export function analyze(trades: TradeWithConf[]): Insights {
  const ts = trades.filter((t) => t.f);
  const all = stats(ts);
  const mid = [...ts].sort((a, b) => a.entryTime - b.entryTime)[Math.floor(ts.length / 2)]?.entryTime ?? 0;
  const early = ts.filter((t) => t.entryTime < mid);
  const late = ts.filter((t) => t.entryTime >= mid);
  const eAll = stats(early);
  const lAll = stats(late);
  const value = (t: TradeWithConf, key: string) => (key === "conf" ? t.conf : t.f![key]);

  const factors = FACTORS.map((factor) => {
    const buckets = factor.buckets.map((b): BucketResult => {
      const inB = (t: TradeWithConf) => {
        const v = value(t, factor.key);
        return v !== undefined && isFinite(v) && b.test(v);
      };
      const g = stats(ts.filter(inB));
      const e = stats(early.filter(inB));
      const l = stats(late.filter(inB));
      const dE = e.winRate - eAll.winRate;
      const dL = l.winRate - lAll.winRate;
      return {
        ...g,
        factor,
        label: b.label,
        dWin: g.winRate - all.winRate,
        dR: g.avgR - all.avgR,
        consistent: e.n >= 8 && l.n >= 8 && Math.sign(dE) === Math.sign(dL) && Math.abs(dE) >= 2 && Math.abs(dL) >= 2,
      };
    });
    const solid = buckets.filter((b) => b.n >= MIN_N);
    const spread = solid.length >= 2 ? Math.max(...solid.map((b) => b.winRate)) - Math.min(...solid.map((b) => b.winRate)) : 0;
    return { factor, buckets, spread };
  }).sort((a, b) => b.spread - a.spread);

  const reliable = factors.flatMap((f) => f.buckets).filter((b) => b.n >= MIN_N && b.consistent);
  const best = reliable.filter((b) => b.dWin >= 4 && b.dR > 0).sort((a, b) => b.dWin - a.dWin).slice(0, 4);
  const worst = reliable.filter((b) => b.dWin <= -4 && b.dR < 0).sort((a, b) => a.dWin - b.dWin).slice(0, 4);

  // Test the simplest rule the data suggests: skip trades in the two most reliable "avoid" conditions.
  let combo: Insights["combo"];
  const avoid = worst.filter((b, i) => worst.findIndex((x) => x.factor.key === b.factor.key) === i).slice(0, 2);
  if (avoid.length) {
    const hit = (t: TradeWithConf) =>
      avoid.some((b) => {
        const v = value(t, b.factor.key);
        return v !== undefined && isFinite(v) && b.factor.buckets.find((x) => x.label === b.label)!.test(v);
      });
    const keep = (arr: TradeWithConf[]) => arr.filter((t) => !hit(t));
    combo = {
      rule: `Skip trades when: ${avoid.map((b) => b.label.toLowerCase()).join(" OR ")}`,
      kept: stats(keep(ts)),
      early: stats(keep(early)),
      late: stats(keep(late)),
      skipped: ts.length - keep(ts).length,
    };
  }
  return { all, factors, best, worst, combo };
}
