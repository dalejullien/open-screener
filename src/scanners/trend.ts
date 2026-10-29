import { clamp, closes, ema, last, relativeVolume, rsi } from "../lib/indicators";
import { fmtPct, fmtX } from "../lib/format";
import { longPlan, structureStop } from "../lib/plan";
import type { Scanner } from "../lib/types";

export const trend: Scanner = {
  id: "trend",
  name: "Trend Continuation",
  tagline: "Uptrends with momentum. Flag the volume spikes.",
  icon: "↗",
  params: [
    { key: "fast", label: "Daily EMA fast", default: 12, min: 2 },
    { key: "slow", label: "Daily EMA slow", default: 25, min: 3 },
    { key: "rsi", label: "4h RSI >", default: 50, min: 1, max: 99 },
    { key: "relvol", label: "Trigger rel. vol ≥", default: 2, step: 0.1, min: 0.5, suffix: "×" },
  ],
  methodology: `Trend: the last completed daily close is above both the fast and slow daily EMA (default 12/25).
Momentum: 4h RSI(14) on completed bars is above the threshold (default 50).
Trigger: both pass AND the last completed 4h bar's volume is at least N× (default 2×) the average of the prior 20 bars.
Near miss: exactly one of trend / momentum passes.
Example levels: entry at the last close; stop under the latest confirmed 4h swing low (−0.25 × 4h ATR) when that is tighter than 2× daily ATR, otherwise 2× daily ATR; targets at 1.5R and 3R.`,

  run({ asset, daily, h4 }, p) {
    const dc = closes(daily);
    const fast = ema(dc, p.fast);
    const slow = ema(dc, p.slow);
    const close = last(dc);
    const ef = last(fast) ?? NaN;
    const es = last(slow) ?? NaN;
    const r = rsi(closes(h4));
    const rv = relativeVolume(h4);
    const up = close > ef && close > es;
    const mom = r > p.rsi;
    const status = up && mom ? (rv >= p.relvol ? "trigger" : "pass") : up || mom ? "near" : "fail";
    const distSlow = (close / es - 1) * 100;
    const score = clamp((up ? 40 : 0) + (mom ? 20 + Math.min(r - p.rsi, 20) / 2 : 0) + Math.min(rv / p.relvol, 1.5) * 20);
    const stop = structureStop(daily, h4);

    return {
      symbol: asset.symbol,
      status,
      direction: up ? "bullish" : close < Math.min(ef, es) ? "bearish" : "neutral",
      score,
      headline: `${up ? "Above" : close < Math.min(ef, es) ? "Below" : "Inside"} EMA band · RSI ${r.toFixed(0)} · ${fmtX(rv)} vol`,
      reason:
        (up ? `Daily close is above the ${p.fast}/${p.slow} EMA band (${fmtPct(distSlow)} vs the slow EMA). ` : `Daily close is not above both EMAs, so the trend filter fails. `) +
        (mom ? `4h RSI ${r.toFixed(1)} confirms momentum. ` : `4h RSI ${r.toFixed(1)} is at or below ${p.rsi}. `) +
        (status === "trigger" ? `Volume on the last 4h bar is ${fmtX(rv)} normal — breakout trigger.` : ""),
      metrics: [
        { label: "Close vs slow EMA", value: fmtPct(distSlow) },
        { label: "4h RSI", value: r.toFixed(1) },
        { label: "Rel. volume (4h)", value: fmtX(rv) },
      ],
      levels: up ? longPlan(close, stop) : [],
      chart: {
        timeframe: "daily",
        overlays: [
          { label: `EMA ${p.fast}`, values: fast },
          { label: `EMA ${p.slow}`, values: slow },
        ],
      },
    };
  },
};
