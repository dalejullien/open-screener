import { atr, clamp, closes, last, relativeVolume } from "../lib/indicators";
import { fmtPct, fmtX } from "../lib/format";
import { longPlan } from "../lib/plan";
import type { Scanner } from "../lib/types";

export const breakout: Scanner = {
  id: "breakout",
  name: "Range Breakout",
  tagline: "Closes above the range high. Volume confirms.",
  icon: "⤒",
  params: [
    { key: "lookback", label: "Range (days)", default: 20, min: 5 },
    { key: "vol", label: "Volume ≥", default: 1.5, step: 0.1, min: 1, suffix: "×" },
    { key: "near", label: "Near within", default: 3, step: 0.5, min: 0.5, suffix: "%" },
    { key: "maxExtension", label: "Max entry extension", default: 5, step: 0.5, min: 1, max: 15, suffix: "%" },
  ],
  methodology: `Range = highest high and lowest low of the prior N completed days (default 20), excluding the latest day.
Trigger: latest daily close is above the range high AND daily volume is at least 1.5× its 20-day average.
Pass: close above the range high without the volume confirmation.
Near miss: close within 3% below the range high.
Research state: a confirmed breakout more than 5% above the range high is marked Extended; the original range high becomes the retest reference.
Example levels: entry at the close, stop at the higher of (range high − 1 ATR) or (close − 2 ATR), targets at 1.5R and 3R.`,

  run({ asset, daily }, p) {
    const prior = daily.slice(-p.lookback - 1, -1);
    const hi = Math.max(...prior.map((c) => c.high));
    const lo = Math.min(...prior.map((c) => c.low));
    const close = last(closes(daily));
    const rv = relativeVolume(daily);
    const above = close > hi;
    const dist = (close / hi - 1) * 100;
    const status = above ? (rv >= p.vol ? "trigger" : "pass") : dist >= -p.near ? "near" : "fail";
    const a = atr(daily);
    const stop = Math.max(hi - a, close - 2 * a);
    const rangeLine = daily.map((_, i) => (i >= daily.length - p.lookback - 1 ? hi : null));

    return {
      symbol: asset.symbol,
      status,
      direction: above ? "bullish" : "neutral",
      score: clamp(50 + dist * 5 + (rv - 1) * 15),
      headline: above ? `Broke ${p.lookback}d high · ${fmtX(rv)} vol` : `${fmtPct(dist)} from ${p.lookback}d high`,
      reason: above
        ? `Closed ${fmtPct(dist)} above the ${p.lookback}-day range high on ${fmtX(rv)} average volume` +
          (status === "trigger" ? " — confirmed breakout." : ", but volume hasn't confirmed yet.")
        : `Close is ${fmtPct(dist)} from the ${p.lookback}-day high (range ${((hi / lo - 1) * 100).toFixed(1)}% tall).`,
      metrics: [
        { label: "vs range high", value: fmtPct(dist) },
        { label: "Daily rel. volume", value: fmtX(rv) },
        { label: "Range height", value: `${((hi / lo - 1) * 100).toFixed(1)}%` },
      ],
      levels: above
        ? longPlan(close, stop)
        : [
            { price: hi, label: "Range high", kind: "level" },
            { price: lo, label: "Range low", kind: "level" },
          ],
      chart: {
        timeframe: "daily",
        overlays: [{ label: `${p.lookback}d high`, values: rangeLine }],
        markers: above ? [{ time: last(daily).time, text: "BREAKOUT" }] : undefined,
      },
      meta: above
        ? {
            retestPrice: hi,
            maxEntryPrice: hi * (1 + p.maxExtension / 100),
            breakoutExtensionPct: dist,
          }
        : undefined,
    };
  },
};
