import { closes, ema, last, pctChange } from "../lib/indicators";
import { fmtPct } from "../lib/format";
import { longPlan, structureStop } from "../lib/plan";
import type { Scanner, Signal } from "../lib/types";

const WINDOWS = [7, 30, 90] as const;
const WEIGHTS = [0.2, 0.4, 0.4];

export const relativeStrength: Scanner = {
  id: "rs",
  name: "Relative Strength",
  tagline: "Who is leading the benchmark. Track the rank.",
  icon: "⇡",
  params: [
    { key: "minPct", label: "Top percentile ≥", default: 75, min: 1, max: 99 },
    { key: "trendEma", label: "Trend EMA", default: 50, min: 5 },
  ],
  methodology: `Benchmark per asset class: BTC for crypto, SPY for stocks, gold (XAU) for commodities.
For each asset, performance relative to its benchmark over 7, 30 and 90 days: (asset return) − (benchmark return).
Composite = 20% × 7d + 40% × 30d + 40% × 90d. Assets are ranked by percentile within their own class.
Pass: percentile ≥ threshold (default 75) and close above the daily trend EMA (default 50).
Trigger: passes AND the 7-day relative return is stronger than the 30-day one (leadership accelerating).
Near miss: within 15 percentile points of the threshold, or top-ranked but below the trend EMA.
Benchmarks themselves are not ranked.`,

  run({ asset, daily, h4 }, p, ctx) {
    const bench = ctx.benchmarks[asset.assetClass];
    const name = bench?.asset.base ?? "benchmark";
    const dc = closes(daily);
    const bc = bench ? closes(bench.daily) : [];
    const close = last(dc);
    const rel = WINDOWS.map((w) =>
      dc.length > w && bc.length > w ? pctChange(dc[dc.length - 1 - w], close) - pctChange(bc[bc.length - 1 - w], last(bc)) : NaN,
    );
    const composite = rel.reduce((s, v, i) => s + v * WEIGHTS[i], 0);
    const trendLine = ema(dc, p.trendEma);
    const aboveTrend = close > (last(trendLine) ?? Infinity);
    const isBench = bench?.asset.symbol === asset.symbol;

    return {
      symbol: asset.symbol,
      status: "fail", // set in finalize once we know the cross-sectional rank
      direction: composite > 0 ? "bullish" : "bearish",
      score: 0,
      raw: isBench || !isFinite(composite) ? undefined : composite,
      headline: `vs ${name}: 7d ${fmtPct(rel[0], 0)} · 30d ${fmtPct(rel[1], 0)} · 90d ${fmtPct(rel[2], 0)}`,
      reason: "",
      metrics: [
        { label: `7d vs ${name}`, value: fmtPct(rel[0]) },
        { label: `30d vs ${name}`, value: fmtPct(rel[1]) },
        { label: `90d vs ${name}`, value: fmtPct(rel[2]) },
        { label: `Above EMA ${p.trendEma}`, value: aboveTrend ? "Yes" : "No" },
      ],
      levels: aboveTrend ? longPlan(close, structureStop(daily, h4)) : [],
      chart: { timeframe: "daily", overlays: [{ label: `EMA ${p.trendEma}`, values: trendLine }] },
      meta: { accel: rel[0] > rel[1], above: aboveTrend, cls: asset.assetClass, bench: name },
    };
  },

  finalize(signals, p) {
    // Rank within each asset class so stocks aren't compared with memecoins.
    const groups = new Map<string, Signal[]>();
    for (const s of signals) {
      if (s.raw === undefined) continue;
      const k = String(s.meta?.cls);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    for (const ranked of groups.values()) {
      ranked.sort((a, b) => a.raw! - b.raw!);
      ranked.forEach((s, i) => {
        const pct = ranked.length > 1 ? (i / (ranked.length - 1)) * 100 : 50;
        const { accel, above, bench } = s.meta ?? {};
        s.score = pct;
        const top = pct >= p.minPct;
        s.status = top && above ? (accel ? "trigger" : "pass") : top || pct >= p.minPct - 15 ? "near" : "fail";
        s.metrics.unshift({ label: "RS percentile", value: pct.toFixed(0) });
        s.reason =
          `Ranks in the ${pct.toFixed(0)}th percentile of ${ranked.length} scanned assets in its class for strength vs ${bench}. ` +
          (above ? `Price is above its EMA ${p.trendEma}. ` : `Price is below its EMA ${p.trendEma}, so the trend filter fails. `) +
          (accel ? "Short-term (7d) leadership is stronger than 30d — accelerating." : "Short-term leadership is not accelerating.");
      });
    }
    for (const s of signals.filter((x) => x.raw === undefined)) {
      s.status = "fail";
      s.reason = "Benchmark, or not enough history — not ranked.";
    }
  },
};
