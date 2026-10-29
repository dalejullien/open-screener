import { runScanner } from "../scanners";
import { atr, closes, ema, last, relativeVolume, rsi } from "./indicators";
import type { MarketData, Params, Scanner, Signal } from "./types";

export interface BacktestOptions {
  days: number; // how many past daily closes to replay
  maxHold: number; // exit at the close after this many bars if neither stop nor target hit
  feePct: number; // per side, e.g. 0.1
}

export interface Trade {
  symbol: string;
  tier?: string;
  signalTime: number;
  entryTime: number;
  entry: number;
  stop: number;
  target: number;
  exitTime: number;
  exit: number;
  r: number; // result in R after fees
  outcome: "target" | "stop" | "time";
  bars: number;
  /** Market conditions at the signal close — used to find what separates winners from losers. */
  f?: Record<string, number>;
}

/** Conditions known at the signal close (no look-ahead): trend, extension, momentum, volume, risk, regime. */
function conditions(d: MarketData, btc: MarketData | undefined, sig: Signal): Record<string, number> {
  const c = closes(d.daily);
  const close = c[c.length - 1];
  const a = atr(d.daily);
  const e20 = last(ema(c, 20)) ?? NaN;
  const e50 = last(ema(c, 50)) ?? NaN;
  const stop = sig.levels.find((l) => l.kind === "stop")?.price ?? NaN;
  const bc = btc ? closes(btc.daily) : [];
  const ret = (arr: number[], n: number) => (arr.length > n ? (arr[arr.length - 1] / arr[arr.length - 1 - n] - 1) * 100 : NaN);
  return {
    btcUp: bc.length ? Number(bc[bc.length - 1] > (last(ema(bc, 50)) ?? Infinity)) : NaN,
    btc7: ret(bc, 7),
    above50: Number(close > e50),
    ext: (close - e20) / a,
    rsi: rsi(c),
    rvol: relativeVolume(d.daily),
    stopPct: ((close - stop) / close) * 100,
    ret7: ret(c, 7),
    ret30: ret(c, 30),
    atrPct: (a / close) * 100,
  };
}

export interface Stats {
  trades: number;
  winRate: number; // % of trades with r > 0
  avgR: number; // expectancy per trade, after fees
  profitFactor: number;
  maxDrawdownR: number;
  avgBars: number;
  totalR: number;
  /** How trades ended, % of trades. */
  targetRate: number;
  stopRate: number;
  timeRate: number;
  equity: { time: number; r: number }[];
}

export interface BacktestResult {
  scannerId: string;
  at: number;
  coins: number;
  days: number;
  stats: Stats;
  byTier?: Record<string, Stats>;
  /** For graded tools: of all fresh triggers, how many failed each gate (keys from meta "gate_*"). */
  gates?: { total: number; allPass: number; fails: Record<string, number> };
  trades: Trade[];
}

/** Same view a live scan would have had: the last 300 primary / 499 lower bars up to that close. */
function windowAt(d: MarketData, k: number): MarketData | null {
  const end = d.daily.length - k;
  if (end < 60) return null;
  const daily = d.daily.slice(Math.max(0, end - 300), end);
  const cutoff = daily[daily.length - 1].time + d.tf.primarySec;
  let hi = d.h4.length;
  while (hi > 0 && d.h4[hi - 1].time + d.tf.lowerSec > cutoff) hi--;
  const h4 = d.h4.slice(Math.max(0, hi - 499), hi);
  if (h4.length < 40) return null;
  return { ...d, asset: { ...d.asset, price: daily[daily.length - 1].close }, daily, h4 };
}

/** An entry is a fresh trigger. Graded tools (S-Tier) count triggered setups that earned a tier; others need status "trigger". */
const isEntry = (s: Signal | undefined) => !!s && (s.meta?.triggered !== undefined ? s.meta.triggered === true && !!s.tier : s.status === "trigger");

function simulate(d: MarketData, sig: Signal, entryIdx: number, opts: BacktestOptions): Trade | null {
  const stopLevel = sig.levels.find((l) => l.kind === "stop")?.price;
  const targetLevel = sig.levels.find((l) => l.kind === "target")?.price;
  const bar = d.daily[entryIdx];
  if (!bar || stopLevel === undefined || targetLevel === undefined) return null;
  const stop = stopLevel;
  const target = targetLevel;
  const entry = bar.open;
  if (!(entry > stop) || !(target > entry)) return null; // gapped through the stop or the target
  const risk = entry - stop;
  const fees = ((opts.feePct * 2) / 100) * entry;
  const lastIdx = entryIdx + opts.maxHold - 1;
  for (let i = entryIdx; i <= Math.min(lastIdx, d.daily.length - 1); i++) {
    const c = d.daily[i];
    // Conservative: if a bar touches both, assume the stop came first. Gaps fill at the open.
    if (c.low <= stop) return mk(Math.min(stop, c.open), "stop", i);
    if (c.high >= target) return mk(Math.max(target, c.open), "target", i);
  }
  if (lastIdx > d.daily.length - 1) return null; // trade still open today — not counted
  return mk(d.daily[lastIdx].close, "time", lastIdx);

  function mk(exit: number, outcome: Trade["outcome"], i: number): Trade {
    return {
      symbol: d.asset.symbol,
      tier: sig.tier,
      signalTime: d.daily[entryIdx - 1].time,
      entryTime: bar.time,
      entry,
      stop,
      target,
      exitTime: d.daily[i].time,
      exit,
      r: (exit - entry - fees) / risk,
      outcome,
      bars: i - entryIdx + 1,
    };
  }
}

export function summarize(trades: Trade[]): Stats {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let cum = 0;
  let peak = 0;
  let dd = 0;
  const equity = sorted.map((t) => {
    cum += t.r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    return { time: t.exitTime, r: cum };
  });
  const wins = trades.filter((t) => t.r > 0);
  const gross = wins.reduce((s, t) => s + t.r, 0);
  const loss = -trades.filter((t) => t.r <= 0).reduce((s, t) => s + t.r, 0);
  return {
    trades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    targetRate: trades.length ? (trades.filter((t) => t.outcome === "target").length / trades.length) * 100 : 0,
    stopRate: trades.length ? (trades.filter((t) => t.outcome === "stop").length / trades.length) * 100 : 0,
    timeRate: trades.length ? (trades.filter((t) => t.outcome === "time").length / trades.length) * 100 : 0,
    avgR: trades.length ? cum / trades.length : 0,
    profitFactor: loss ? gross / loss : gross ? Infinity : 0,
    maxDrawdownR: dd,
    avgBars: trades.length ? trades.reduce((s, t) => s + t.bars, 0) / trades.length : 0,
    totalR: cum,
    equity,
  };
}

/**
 * Walk forward one daily close at a time, open a trade on each fresh trigger (one open trade per
 * coin), and resolve it on the following bars. Signals at close k are filled at the next bar's open.
 */
export function backtestScanner(
  scanner: Scanner,
  data: MarketData[],
  params: Params,
  opts: BacktestOptions,
  onProgress?: (done: number, total: number) => void,
): BacktestResult {
  const trades: Trade[] = [];
  const busyUntil = new Map<string, number>();
  let prev = new Map<string, Signal>();
  const gates = { total: 0, allPass: 0, fails: {} as Record<string, number> };
  for (let k = opts.days; k >= 1; k--) {
    const sliced = data.map((d) => windowAt(d, k)).filter((d): d is MarketData => d !== null);
    const sigs = new Map(runScanner(scanner, sliced, params).map((s) => [s.symbol, s]));
    for (const [sym, sig] of sigs) {
      if (sig.meta?.triggered === true && prev.get(sym)?.meta?.triggered !== true) {
        const keys = Object.keys(sig.meta).filter((k) => k.startsWith("gate_"));
        if (keys.length) {
          gates.total++;
          const failed = keys.filter((k) => sig.meta![k] === false);
          if (!failed.length) gates.allPass++;
          for (const k of failed) gates.fails[k] = (gates.fails[k] ?? 0) + 1;
        }
      }
      if (!isEntry(sig) || isEntry(prev.get(sym))) continue;
      const d = data.find((x) => x.asset.symbol === sym);
      if (!d) continue;
      const entryIdx = d.daily.length - k;
      if ((busyUntil.get(sym) ?? -1) >= entryIdx) continue;
      const t = simulate(d, sig, entryIdx, opts);
      if (!t) continue;
      const here = sliced.find((x) => x.asset.symbol === sym);
      if (here) t.f = conditions(here, sliced.find((x) => x.asset.base === "BTC"), sig);
      trades.push(t);
      busyUntil.set(sym, entryIdx + t.bars - 1);
    }
    prev = sigs;
    onProgress?.(opts.days - k + 1, opts.days);
  }
  const tiers = [...new Set(trades.map((t) => t.tier).filter(Boolean))] as string[];
  return {
    scannerId: scanner.id,
    at: Date.now(),
    coins: data.length,
    days: opts.days,
    stats: summarize(trades),
    gates: gates.total ? gates : undefined,
    byTier: tiers.length ? Object.fromEntries(tiers.sort().map((t) => [t, summarize(trades.filter((x) => x.tier === t))])) : undefined,
    trades,
  };
}
