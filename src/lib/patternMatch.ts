/**
 * Pattern Match: find the K most similar historical price shapes across all loaded assets and
 * report what followed them. Pure functions — run inside a Web Worker.
 */

export interface PMSeries {
  symbol: string;
  base: string;
  times: number[];
  closes: number[];
}

export interface PMMatch {
  symbol: string;
  base: string;
  start: number; // index of the window start in that asset's series
  distance: number;
  weight: number; // 0–1, closer = heavier
  volRatio: number; // query σ / match σ, used to scale the forward path
  forwardPct: number; // volatility-adjusted move over the horizon
}

export interface PMResult {
  symbol: string;
  matches: PMMatch[];
  forecastPct: number; // weighted forward move
  agreement: number; // matches pointing the same way as the forecast
  minPct: number;
  maxPct: number;
}

const POINTS = 20; // shapes are compared on 20 evenly spaced points

/** Z-normalised log-price shape of closes[s .. s+len-1] — level and scale removed, shape kept. */
function shape(closes: number[], s: number, len: number): Float64Array | null {
  const v = new Float64Array(POINTS);
  for (let j = 0; j < POINTS; j++) v[j] = Math.log(closes[s + Math.round((j * (len - 1)) / (POINTS - 1))]);
  let mean = 0;
  for (const x of v) mean += x;
  mean /= POINTS;
  let sd = 0;
  for (const x of v) sd += (x - mean) ** 2;
  sd = Math.sqrt(sd / POINTS);
  if (!(sd > 1e-9) || !isFinite(sd)) return null;
  for (let j = 0; j < POINTS; j++) v[j] = (v[j] - mean) / sd;
  return v;
}

/** Daily-return volatility of a window (for scaling forward paths). */
function vol(closes: number[], s: number, len: number) {
  let sum = 0;
  let sq = 0;
  for (let i = s + 1; i < s + len; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    sum += r;
    sq += r * r;
  }
  const n = len - 1;
  return Math.sqrt(Math.max(sq / n - (sum / n) ** 2, 1e-12));
}

export function matchAll(series: PMSeries[], querySymbols: string[], len: number, horizon: number, k = 5, step = 2): PMResult[] {
  // Library: every historical window whose forward path is fully known.
  const lib: { a: number; s: number; v: Float64Array; vol: number }[] = [];
  series.forEach((ser, a) => {
    for (let s = 0; s + len + horizon <= ser.closes.length; s += step) {
      const v = shape(ser.closes, s, len);
      if (v) lib.push({ a, s, v, vol: vol(ser.closes, s, len) });
    }
  });

  const out: PMResult[] = [];
  const idx = new Map(series.map((s, i) => [s.symbol, i]));
  for (const sym of querySymbols) {
    const qi = idx.get(sym);
    if (qi === undefined) continue;
    const q = series[qi];
    const qs = q.closes.length - len;
    if (qs < 0) continue;
    const qv = shape(q.closes, qs, len);
    if (!qv) continue;
    const qVol = vol(q.closes, qs, len);

    // Best window per asset (diversity: at most one match per asset); same asset must end before the query starts.
    const bestPerAsset = new Map<number, { s: number; d: number; vol: number }>();
    for (const w of lib) {
      if (w.a === qi && w.s + len + horizon > qs) continue;
      let d = 0;
      for (let j = 0; j < POINTS; j++) d += (w.v[j] - qv[j]) ** 2;
      const cur = bestPerAsset.get(w.a);
      if (!cur || d < cur.d) bestPerAsset.set(w.a, { s: w.s, d, vol: w.vol });
    }
    const top = [...bestPerAsset.entries()].sort((x, y) => x[1].d - y[1].d).slice(0, k);
    if (!top.length) continue;

    // Inverse-power weights: the closest shapes dominate, as in the reference tool.
    const inv = top.map(([, m]) => 1 / Math.max(Math.sqrt(m.d), 1e-6) ** 4);
    const sumInv = inv.reduce((s, x) => s + x, 0);
    const matches: PMMatch[] = top.map(([a, m], i) => {
      const c = series[a].closes;
      const ratio = qVol / m.vol;
      const fwd = Math.log(c[m.s + len - 1 + horizon] / c[m.s + len - 1]) * ratio;
      return { symbol: series[a].symbol, base: series[a].base, start: m.s, distance: Math.sqrt(m.d), weight: inv[i] / sumInv, volRatio: ratio, forwardPct: (Math.exp(fwd) - 1) * 100 };
    });
    const forecastPct = (Math.exp(matches.reduce((s, m) => s + m.weight * Math.log(1 + m.forwardPct / 100), 0)) - 1) * 100;
    out.push({
      symbol: sym,
      matches,
      forecastPct,
      agreement: matches.filter((m) => Math.sign(m.forwardPct) === Math.sign(forecastPct)).length,
      minPct: Math.min(...matches.map((m) => m.forwardPct)),
      maxPct: Math.max(...matches.map((m) => m.forwardPct)),
    });
  }
  return out;
}
