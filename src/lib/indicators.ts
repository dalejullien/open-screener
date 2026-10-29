import type { Candle } from "./types";

export const last = <T>(a: T[]): T => a[a.length - 1];
export const closes = (c: Candle[]) => c.map((x) => x.close);
export const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** EMA seeded with an SMA of the first `period` values (matches TradingView's ta.ema). */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder's RSI, last value (matches TradingView's ta.rsi). */
export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return NaN;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    g += Math.max(d, 0);
    l += Math.max(-d, 0);
  }
  g /= period;
  l /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

/** Wilder's RSI as a series (null until enough bars). */
export function rsiSeries(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    g += Math.max(d, 0);
    l += Math.max(-d, 0);
  }
  g /= period;
  l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
export function median(v: number[]) {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Average daily range in % (mean of high/low − 1), the "ADR%" breakout traders size stops against. */
export const adrPct = (c: Candle[], period = 20) => mean(c.slice(-period).map((x) => (x.high / x.low - 1) * 100));

/** Wilder's ATR, last value. */
export function atr(c: Candle[], period = 14): number {
  if (c.length <= period) return NaN;
  const tr = c.slice(1).map((x, i) => Math.max(x.high - x.low, Math.abs(x.high - c[i].close), Math.abs(x.low - c[i].close)));
  let a = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const width: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const m = mid[i];
    if (m === null) {
      upper.push(null);
      lower.push(null);
      width.push(null);
      continue;
    }
    const w = values.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / period);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
    width.push((2 * mult * sd) / m);
  }
  return { mid, upper, lower, width };
}

/** Percent of `history` values that are <= `value` (0–100). */
export function percentileRank(history: number[], value: number): number {
  if (!history.length) return NaN;
  return (history.filter((v) => v <= value).length / history.length) * 100;
}

/** Last closed bar's volume relative to the average of the `period` bars before it. */
export function relativeVolume(c: Candle[], period = 20): number {
  if (c.length < period + 1) return NaN;
  const prior = c.slice(-period - 1, -1);
  const avg = prior.reduce((s, x) => s + x.volume, 0) / period;
  return avg ? last(c).volume / avg : NaN;
}

export const pctChange = (from: number, to: number) => (to / from - 1) * 100;
