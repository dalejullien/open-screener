import { fmtPct } from "../lib/format";
import type { PMResult } from "../lib/patternMatch";
import type { MarketData, Params, Projection, Scanner, Signal, Status } from "../lib/types";

/**
 * Pattern Match is cross-sectional (every coin is compared with every coin's history), so it runs
 * in its own worker instead of per asset. This descriptor gives it a page, parameters and rules;
 * `toSignal` turns a worker result into the common Signal shape the list/detail views use.
 */
export const patternMatchTool: Scanner = {
  id: "pmatch",
  name: "Pattern Match",
  tagline: "Find familiar shapes. Explore what followed.",
  icon: "∿",
  params: [
    { key: "len", label: "Pattern bars", default: 60, min: 20, max: 150, step: 10 },
    { key: "horizon", label: "Project bars", default: 30, min: 5, max: 90, step: 5 },
  ],
  methodology: `The last N completed bars (default 60) of each asset are reduced to a 20-point shape: log prices, with level and scale removed (z-normalised), so only the shape matters.
That shape is compared with every historical window of the same length across all loaded assets (stepping 2 bars), whose following M bars (default 30) are already known. Distance = Euclidean distance between shapes. At most one match per asset; an asset's own windows must end before its current pattern begins.
The 5 closest matches are weighted by 1/distance⁴ (closer shapes dominate). Each match's forward path is scaled by the volatility ratio (current σ / match σ) and drawn from today's price. Weighted estimate = weighted average of the scaled forward log-returns. Agreement = how many of the 5 point the same way.
Status: Trigger = estimate ≥ +10% with 4–5 of 5 agreeing; Pass = positive with ≥ 3 agreeing; Near = positive but mixed; bearish estimates are listed under "All".
These are historical scenarios, not a forecast guarantee. Not included in Signal Confluence or backtests yet.`,
  run() {
    throw new Error("Pattern Match runs in its worker");
  },
};

export function toSignal(r: PMResult, d: MarketData, library: Map<string, MarketData>, p: Params): Signal {
  const { asset, daily, tf } = d;
  const lastTime = daily[daily.length - 1].time;
  const lastClose = daily[daily.length - 1].close;
  const qs = daily.length - p.len;
  const future = (j: number) => lastTime + j * tf.primarySec;

  // Each match: its pattern window rescaled onto ours, then its volatility-adjusted continuation.
  const projections: Projection[] = r.matches.map((m) => {
    const md = library.get(m.symbol)!;
    const c = md.daily.map((x) => x.close);
    const anchorQ = Math.log(daily[qs].close);
    const anchorM = Math.log(c[m.start]);
    const endM = Math.log(c[m.start + p.len - 1]);
    const endQ = Math.log(lastClose);
    const pts = [];
    for (let j = 0; j < p.len; j++) pts.push({ time: daily[qs + j].time, value: Math.exp(anchorQ + (Math.log(c[m.start + j]) - anchorM) * m.volRatio) });
    for (let j = 1; j <= p.horizon; j++) pts.push({ time: future(j), value: Math.exp(endQ + (Math.log(c[m.start + p.len - 1 + j]) - endM) * m.volRatio) });
    const from = new Date(md.daily[m.start].time * 1000).toISOString().slice(0, 7);
    return { label: `${m.base} ${from} · ${(m.weight * 100).toFixed(0)}%`, points: pts };
  });
  // Weighted estimate path: weighted average of the matches' forward log-returns, bar by bar.
  const est = [{ time: lastTime, value: lastClose }];
  for (let j = 1; j <= p.horizon; j++) {
    let lr = 0;
    r.matches.forEach((m) => {
      const c = library.get(m.symbol)!.daily;
      lr += m.weight * Math.log(c[m.start + p.len - 1 + j].close / c[m.start + p.len - 1].close) * m.volRatio;
    });
    est.push({ time: future(j), value: lastClose * Math.exp(lr) });
  }
  projections.push({ label: "Weighted estimate", points: est, main: true });

  const up = r.forecastPct > 0;
  const status: Status = up && r.forecastPct >= 10 && r.agreement >= 4 ? "trigger" : up && r.agreement >= 3 ? "pass" : up ? "near" : "fail";
  const top = r.matches[0];
  const unit = { "1H": "h", "4H": "×4h", D: "d", "3D": "×3d", W: "w" }[tf.id];

  return {
    symbol: asset.symbol,
    status,
    direction: up ? "bullish" : "bearish",
    score: Math.max(0, Math.min(100, 50 + r.forecastPct / 2)),
    headline: `${fmtPct(r.forecastPct)} in ${p.horizon}${unit} · ${r.agreement}/5 agree`,
    reason:
      `The last ${p.len} bars most resemble ${r.matches.map((m) => `${m.base} (${(m.weight * 100).toFixed(0)}%)`).join(", ")}. ` +
      `After those shapes, the volatility-adjusted moves over ${p.horizon} bars ranged ${fmtPct(r.minPct)} to ${fmtPct(r.maxPct)}; the weighted estimate is ${fmtPct(r.forecastPct)} with ${r.agreement}/5 pointing the same way. Historical scenarios, not a forecast.`,
    metrics: [
      { label: "Weighted estimate", value: fmtPct(r.forecastPct) },
      { label: "Agreement", value: `${r.agreement}/5` },
      { label: "Scenario range", value: `${fmtPct(r.minPct, 0)} … ${fmtPct(r.maxPct, 0)}` },
      { label: "Closest match", value: `${top.base} · ${(top.weight * 100).toFixed(0)}%` },
    ],
    levels: [],
    chart: { timeframe: "daily", overlays: [], projections, visibleBars: p.len + 30 },
  };
}
