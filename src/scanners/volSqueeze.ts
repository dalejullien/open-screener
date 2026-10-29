import { bollinger, closes, ema, last, percentileRank } from "../lib/indicators";
import { fmtPct } from "../lib/format";
import { longPlan } from "../lib/plan";
import type { Scanner } from "../lib/types";

export const volSqueeze: Scanner = {
  id: "squeeze",
  name: "Volatility Squeeze",
  tagline: "Volatility coiled tight. Expansion tends to follow.",
  icon: "⇥",
  params: [
    { key: "len", label: "Bollinger length", default: 20, min: 5 },
    { key: "lookback", label: "History (days)", default: 120, min: 30 },
    { key: "pct", label: "Squeeze percentile ≤", default: 15, min: 1, max: 50 },
  ],
  methodology: `Bollinger Band width (20-day, 2σ) as a share of price, compared with the coin's own last 120 days.
Squeeze: current width is in the bottom 15% of its own history — volatility is unusually compressed.
Trigger: was in a squeeze within the last 5 days AND the latest daily close broke above the upper band (bullish) or below the lower band (bearish).
Near miss: width in the bottom 30% (2× the threshold).
A squeeze says a big move is likely, not which direction. Direction comes from the breakout.`,

  run({ asset, daily }, p) {
    const dc = closes(daily);
    const bb = bollinger(dc, p.len);
    const widths = bb.width.filter((w): w is number => w !== null);
    const hist = widths.slice(-p.lookback);
    const now = last(widths);
    const pct = percentileRank(hist, now);
    const recentMin = Math.min(...widths.slice(-6, -1).map((w) => percentileRank(hist, w)));
    const close = last(dc);
    const up = last(bb.upper) ?? NaN;
    const lo = last(bb.lower) ?? NaN;
    const breakUp = close > up;
    const breakDown = close < lo;
    const wasSqueezed = recentMin <= p.pct;
    const trigger = wasSqueezed && (breakUp || breakDown);
    const squeezed = pct <= p.pct;
    const status = trigger ? "trigger" : squeezed ? "pass" : pct <= p.pct * 2 ? "near" : "fail";
    const trendUp = close > (last(ema(dc, 50)) ?? Infinity);
    const mid = last(bb.mid) ?? NaN;

    return {
      symbol: asset.symbol,
      status,
      direction: trigger ? (breakUp ? "bullish" : "bearish") : trendUp ? "bullish" : "neutral",
      score: Math.max(0, 100 - pct) * (trigger ? 1 : 0.9),
      headline: trigger
        ? `Squeeze breakout ${breakUp ? "up" : "down"} · width pct ${pct.toFixed(0)}`
        : `Band width in bottom ${Math.max(1, Math.round(pct))}% of ${p.lookback}d`,
      reason:
        `Bollinger width is at the ${pct.toFixed(0)}th percentile of the last ${p.lookback} days. ` +
        (trigger
          ? `After a squeeze, the close broke ${breakUp ? "above the upper" : "below the lower"} band — expansion has started.`
          : squeezed
            ? `Volatility is compressed; watch for a close outside the bands (${fmtPct((up / close - 1) * 100)} / ${fmtPct((lo / close - 1) * 100)} away).`
            : "Not compressed enough to count as a squeeze."),
      metrics: [
        { label: "Width percentile", value: pct.toFixed(0) },
        { label: "Band width", value: `${(now * 100).toFixed(1)}%` },
        { label: "Trend (EMA 50)", value: trendUp ? "Up" : "Down" },
      ],
      levels:
        trigger && breakUp
          ? longPlan(close, mid)
          : [
              { price: up, label: "Upper band", kind: "level" },
              { price: lo, label: "Lower band", kind: "level" },
            ],
      chart: {
        timeframe: "daily",
        overlays: [
          { label: "Upper band", values: bb.upper },
          { label: "Lower band", values: bb.lower },
        ],
      },
    };
  },
};
