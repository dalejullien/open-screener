import { adrPct, atr, bollinger, clamp, closes, ema, last, mean, median, pctChange, percentileRank, rsiSeries, sma } from "../lib/indicators";
import { fmtPct, fmtX } from "../lib/format";
import { longPlan } from "../lib/plan";
import type { Candle, Marker, Scanner } from "../lib/types";

interface Setup {
  name: string;
  triggered: boolean; // trigger fired on a completed bar
  forming: boolean; // conditions in place, waiting for the trigger
  entry: number; // close if triggered, trigger price if forming
  stop: number;
  quality: number; // 0–20
  note: string;
  marker?: Marker;
}

const lows = (c: Candle[]) => c.map((x) => x.low);
const highs = (c: Candle[]) => c.map((x) => x.high);

/** A — RSI-reset pullback (Cardwell bull range + Raschke "Holy Grail"). */
function rsiReset(D: Candle[], H: Candle[], e20: number): Setup {
  const drsi = rsiSeries(closes(D)).slice(-5).filter((v): v is number => v !== null);
  const dipMin = Math.min(...drsi);
  const dipped = dipMin <= 50 && dipMin >= 38;
  const touched = Math.min(...lows(D.slice(-5))) <= e20 * 1.01;

  const hc = closes(H);
  const hr = rsiSeries(hc);
  const win = H.slice(-30);
  const li = win.reduce((m, c, i) => (c.low < win[m].low ? i : m), 0);
  const pullbackBar = win[li];
  const confirmed = li <= win.length - 4; // 3 bars on the right → no look-ahead
  const rNow = last(hr) ?? 0;
  const crossed = rNow > 50 && hr.slice(-6, -1).some((v) => v !== null && v < 50);
  const triggered = dipped && touched && confirmed && last(hc) > pullbackBar.high && crossed;
  const stop = pullbackBar.low - 0.25 * atr(H);
  const idealDip = dipMin >= 40 && dipMin <= 48;

  return {
    name: "RSI-reset pullback",
    triggered,
    forming: dipped && touched && !triggered,
    entry: triggered ? last(hc) : Math.max(pullbackBar.high, last(hc)),
    stop,
    quality: (dipped ? 10 : 0) + (touched ? 5 : 0) + (idealDip ? 5 : 0),
    note: `Daily RSI cooled to ${dipMin.toFixed(0)}${touched ? " and price tagged the 20-day EMA" : ""}; 4h RSI ${rNow.toFixed(0)}.`,
    marker: triggered ? { time: last(D).time, text: "RSI RESET" } : undefined,
  };
}

/** B — Tight-base breakout / VCP (Qullamaggie, Minervini). */
function tightBase(D: Candle[], a: number, adr: number): Setup {
  const today = last(D);
  const tight = D.slice(-8, -1);
  const pivot = Math.max(...highs(tight));
  const tLow = Math.min(...lows(tight));
  const rangePct = (pivot / tLow - 1) * 100;
  const runUp = pivot / Math.min(...lows(D.slice(-60, -8))) - 1;
  const isTight = rangePct <= 1.5 * adr;
  const vol50 = mean(D.slice(-51, -1).map((c) => c.volume));
  const dryUp = mean(D.slice(-6, -1).map((c) => c.volume)) < 0.8 * vol50;
  const volOk = today.volume >= 1.5 * mean(D.slice(-21, -1).map((c) => c.volume));
  const base = runUp >= 0.3 && isTight;
  const triggered = base && today.close > pivot && volOk;

  return {
    name: "Tight-base breakout",
    triggered,
    forming: base && !triggered && today.close <= pivot && today.close >= pivot * 0.97,
    entry: triggered ? today.close : pivot,
    stop: Math.min(today.low, tLow) - 0.1 * a,
    quality: clamp((1 - rangePct / (1.5 * adr)) * 12, 0, 12) + (dryUp ? 8 : 0),
    note: `+${(runUp * 100).toFixed(0)}% run, then a ${rangePct.toFixed(1)}% base (ADR ${adr.toFixed(1)}%)${dryUp ? " on drying-up volume" : ""}.`,
    marker: triggered ? { time: today.time, text: "BASE BREAKOUT" } : undefined,
  };
}

/** C — Squeeze breakout (Bollinger BandWidth at a multi-month low). */
function squeeze(D: Candle[], a: number): Setup {
  const dc = closes(D);
  const bb = bollinger(dc, 20);
  const widths = bb.width.filter((w): w is number => w !== null);
  const hist = widths.slice(-125);
  const pctNow = Math.min(...widths.slice(-5).map((w) => percentileRank(hist, w)));
  const squeezed = pctNow <= 10;
  const today = last(D);
  const prior = D.slice(-11, -1);
  const tenHigh = Math.max(...highs(prior));
  const upper = last(bb.upper) ?? Infinity;
  const volOk = today.volume >= 1.5 * mean(D.slice(-21, -1).map((c) => c.volume));
  const triggered = squeezed && (today.close > upper || today.close > tenHigh) && volOk;
  const stop = Math.max(Math.min(...lows(prior)), last(bb.mid) ?? 0) - 0.1 * a;

  return {
    name: "Squeeze breakout",
    triggered,
    forming: squeezed && !triggered,
    entry: triggered ? today.close : Math.min(upper, tenHigh),
    stop,
    quality: clamp((10 - pctNow) * 1.5, 0, 15) + (volOk ? 5 : 0),
    note: `Bollinger width in the bottom ${Math.max(1, Math.round(pctNow))}% of 125 days.`,
    marker: triggered ? { time: today.time, text: "SQUEEZE BREAK" } : undefined,
  };
}

export const sTier: Scanner = {
  id: "stier",
  name: "S-Tier Setups",
  tagline: "Only the cleanest setups — with tight, structure-based stops.",
  icon: "★",
  params: [
    { key: "minScore", label: "S-tier score ≥", default: 80, min: 50, max: 100 },
    { key: "maxStop", label: "Max stop", default: 6, step: 0.5, min: 1, suffix: "%" },
    { key: "minVol", label: "Min daily volume", default: 5, min: 0, suffix: "$M" },
  ],
  methodology: `Three long setup types, each with a stop placed under real price structure instead of a fixed ATR multiple:
A) RSI-reset pullback — daily RSI dipped to 38–50 in the last 5 days, price came within 1% of the 20-day EMA; trigger = 4h close above the high of the pullback-low bar with 4h RSI crossing back above 50. Stop: under that 4h swing low − 0.25 × 4h ATR.
B) Tight-base breakout (VCP) — ≥30% run-up, then a 7-day base no wider than 1.5 × ADR%; trigger = daily close above the base high on ≥1.5× volume. Stop: under the base / breakout-bar low.
C) Squeeze breakout — Bollinger width in the bottom 10% of 125 days; trigger = close above the upper band or 10-day high on ≥1.5× volume. Stop: under the squeeze range low or mid-band, whichever is tighter.

Hard gates for S-tier: trend (close > EMA50 > rising SMA200), stop ≤ min(1 × daily ATR, 0.6 × ADR%, max stop %), at least 3R of room to the nearest overhead resistance (highest high of the prior 120 days), healthy regime (class benchmark above its EMA50), liquidity (median 20-day volume ≥ minimum), and a fired trigger.
Score /100: trend 25 · relative strength vs benchmark 15 · setup quality 20 · stop tightness 20 (≤ half the stop cap = 20, at the cap = 10, 1.5× the cap = 0) · room to resistance 10 · regime 10.
S = score ≥ threshold + all gates + triggered. A = score ≥ 65, trend passes, stop ≤ 1.5× the cap and ≤ 1.5 ATR (triggered or forming). B = trend passes with a setup present but a wider stop or lower score.
Targets: 3R and 5R. Tight stops get hit more often — expect a lower win rate offset by larger winners. Rules are fixed a priori (not curve-fitted) and will be backtested in Phase 2.`,

  run({ asset, daily: D, h4: H }, p, ctx) {
    const base = {
      symbol: asset.symbol,
      levels: [],
      metrics: [],
      chart: { timeframe: "daily" as const, overlays: [] },
    };
    if (D.length < 210 || H.length < 40) {
      return { ...base, status: "fail", direction: "neutral", score: 0, headline: "Needs 200+ days of history", reason: "The trend filter uses a 200-day average, so newer listings are not rated yet." };
    }

    const dc = closes(D);
    const close = last(dc);
    const e20s = ema(dc, 20);
    const e50s = ema(dc, 50);
    const s200s = sma(dc, 200);
    const e20 = last(e20s) ?? NaN;
    const e50 = last(e50s) ?? NaN;
    const s200 = last(s200s) ?? NaN;
    const s200prev = s200s[s200s.length - 21] ?? NaN;
    const a = atr(D);
    const atrPct = (a / close) * 100;
    const adr = adrPct(D);
    const liq = median(D.slice(-20).map((c) => c.close * c.volume)) / 1e6;

    const bench = ctx.benchmarks[asset.assetClass];
    const bc = bench ? closes(bench.daily) : dc;
    const regime = last(bc) > (last(ema(bc, 50)) ?? Infinity);
    const rs30 = pctChange(dc[dc.length - 31], close) - pctChange(bc[bc.length - 31], last(bc));

    const trendOk = close > e50 && e50 > s200 && s200 > s200prev;
    const hi = Math.max(...highs(D));
    const lo = Math.min(...lows(D));
    const structureOk = close >= 1.25 * lo && close >= 0.75 * hi;
    const notExtended = close - e20 <= a;
    const liqOk = liq >= p.minVol;

    const setups = [rsiReset(D, H, e20), tightBase(D, a, adr), squeeze(D, a)].filter((s) => s.triggered || s.forming);
    const resistance = Math.max(...highs(D.slice(-120, -10)));

    const rated = setups.map((s) => {
      const risk = s.entry - s.stop;
      const stopPct = (risk / s.entry) * 100;
      const stopAtr = risk / a;
      const stopCap = Math.min(atrPct, 0.6 * adr, p.maxStop);
      const roomR = resistance > s.entry ? (resistance - s.entry) / risk : Infinity;
      const stopOk = risk > 0 && stopPct <= stopCap;
      const roomOk = roomR >= 3;
      const pts = {
        trend: (trendOk ? 15 : 0) + (structureOk ? 5 : 0) + (notExtended ? 5 : 0),
        rs: rs30 > 0 ? 15 : clamp(15 + rs30, 0, 15),
        setup: s.quality,
        // Tightness vs the cap (not raw ATR, which is huge on wild coins): ≤ half the cap = 20, at the cap = 10, 1.5× = 0.
        stop: risk > 0 ? clamp(((1.5 - stopPct / stopCap) / 1) * 20, 0, 20) : 0,
        room: roomOk ? 10 : clamp((roomR / 3) * 10, 0, 10),
        regime: regime ? 10 : 0,
      };
      const score = Object.values(pts).reduce((x, y) => x + y, 0);
      const tier: "S" | "A" | "B" | undefined = !liqOk || !trendOk || !(risk > 0)
        ? undefined
        : score >= p.minScore && stopOk && roomOk && regime && s.triggered
          ? "S"
          : score >= 65 && stopPct <= 1.5 * stopCap && stopAtr <= 1.5
            ? "A"
            : "B";
      return { s, risk, stopPct, stopAtr, stopCap, roomR, stopOk, roomOk, pts, score, tier };
    });
    const rank = (t?: string) => (t === "S" ? 3 : t === "A" ? 2 : t === "B" ? 1 : 0);
    const best = rated.sort((x, y) => rank(y.tier) - rank(x.tier) || Number(y.s.triggered) - Number(x.s.triggered) || y.score - x.score)[0];

    const checklist = [
      { label: "Trend: close > EMA50 > rising SMA200", ok: trendOk },
      { label: "Within 25% of high, 25%+ off the low", ok: structureOk },
      { label: "Not extended (≤ 1 ATR above EMA20)", ok: notExtended },
      { label: `Beats ${bench?.asset.base ?? "benchmark"} over 30 days`, ok: rs30 > 0, detail: fmtPct(rs30) },
      { label: `Regime: ${bench?.asset.base ?? "benchmark"} above its EMA50`, ok: regime },
      { label: `Liquidity ≥ $${p.minVol}M/day`, ok: liqOk, detail: `$${liq.toFixed(1)}M` },
    ];
    const overlays = [
      { label: "EMA 20", values: e20s },
      { label: "EMA 50", values: e50s },
      { label: "SMA 200", values: s200s },
    ];

    if (!best) {
      return {
        ...base,
        status: "fail",
        direction: trendOk ? "bullish" : "neutral",
        score: 0,
        headline: trendOk ? "Uptrend — no setup yet" : "No setup",
        reason: trendOk ? "Trend is healthy but none of the three setups (RSI reset, tight base, squeeze) is in place." : "Trend filter fails and no setup is in place.",
        checklist,
        chart: { timeframe: "daily", overlays },
      };
    }

    const { s, tier } = best;
    checklist.push(
      { label: `Setup: ${s.name}`, ok: s.triggered, detail: s.triggered ? "triggered" : "forming" },
      { label: `Tight stop ≤ ${best.stopCap.toFixed(1)}% (1 ATR / 0.6 ADR / cap)`, ok: best.stopOk, detail: `${best.stopPct.toFixed(1)}% · ${best.stopAtr.toFixed(2)} ATR` },
      { label: "Room to resistance ≥ 3R", ok: best.roomOk, detail: isFinite(best.roomR) ? `${best.roomR.toFixed(1)}R` : "clear" },
    );

    return {
      symbol: asset.symbol,
      status: tier === "S" ? "trigger" : tier === "A" ? "pass" : tier === "B" ? "near" : "fail",
      direction: trendOk ? "bullish" : "neutral",
      score: best.score,
      tier,
      headline: `${tier ? `${tier}-tier · ` : ""}${s.name}${s.triggered ? "" : " (forming)"} · stop ${best.stopPct.toFixed(1)}%`,
      reason:
        `${s.note} ` +
        (s.triggered ? `Triggered — entry ${s.entry.toPrecision(5)}, stop ${s.stop.toPrecision(5)} (${best.stopPct.toFixed(1)}%, ${best.stopAtr.toFixed(2)}× ATR). ` : `Not triggered yet — buy-stop above ${s.entry.toPrecision(5)}, stop ${s.stop.toPrecision(5)}. `) +
        `Score ${best.score.toFixed(0)}/100: trend ${best.pts.trend}, RS ${best.pts.rs.toFixed(0)}, setup ${best.pts.setup.toFixed(0)}, stop ${best.pts.stop.toFixed(0)}, room ${best.pts.room.toFixed(0)}, regime ${best.pts.regime}.` +
        (!liqOk ? " Volume is below the liquidity minimum, so it isn't tiered." : ""),
      metrics: [
        { label: "Tier · score", value: `${tier ?? "–"} · ${best.score.toFixed(0)}` },
        { label: "Stop distance", value: `${best.stopPct.toFixed(1)}%` },
        { label: "Stop / ATR", value: fmtX(best.stopAtr) },
        { label: "Room to resistance", value: isFinite(best.roomR) ? `${best.roomR.toFixed(1)}R` : "Clear" },
        { label: "ADR", value: `${adr.toFixed(1)}%` },
      ],
      levels: longPlan(s.entry, s.stop, [3, 5]).map((l) => (l.kind === "entry" && !s.triggered ? { ...l, label: "Buy above" } : l)),
      checklist,
      chart: { timeframe: "daily", overlays, markers: s.marker ? [s.marker] : undefined },
      // Which S-tier gates passed — the backtest tallies these to show why setups miss S.
      meta: {
        triggered: s.triggered,
        gate_trend: trendOk,
        gate_liquidity: liqOk,
        gate_stop: best.stopOk,
        gate_room: best.roomOk,
        gate_regime: regime,
        gate_score: best.score >= p.minScore,
      },
    };
  },
};
