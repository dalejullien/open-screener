import { atr, clamp, closes, ema, last, mean, rsiSeries } from "../lib/indicators";
import { fmtPct, fmtX } from "../lib/format";
import type { Level, Scanner } from "../lib/types";

export const secondChance: Scanner = {
  id: "second",
  name: "Second Chance",
  tagline: "Missed the pump? Catch the pullback.",
  icon: "↺",
  params: [
    { key: "minPump", label: "Min pump", default: 30, min: 10, max: 200, step: 5, suffix: "%" },
    { key: "lookback", label: "Pump within", default: 15, min: 3, max: 40, suffix: "bars" },
    { key: "deep", label: "Max pullback", default: 62, min: 30, max: 79, suffix: "%" },
  ],
  methodology: `For coins that recently pumped and are now pulling back — the "second chance" entry instead of chasing.
Pump: within the last N bars (default 15), the high is at least the minimum % (default 30%) above the lowest low of the 20 bars before it, with a volume spike of at least 2× the prior 20-bar average somewhere in the run-up.
Pullback: how much of the pump has been given back, measured from the peak. Buy zone = 38.2%–62% (the max is a parameter). Under 23.6% = still extended (wait). Beyond 78.6%, or below the pump's starting low = invalidated.
Healthy pullback: average volume since the peak is below 60% of the run-up's average volume (sellers aren't in control).
Trigger (entry timeframe, 4h on daily charts): a close above the high of the bar that made the pullback low, with RSI crossing back above 50, while the pullback is 30%–max and volume is drying up. The pullback low must be at least 3 bars old (confirmed — no look-ahead). A turn outside those conditions shows as "pass", not a trigger.
Stop: under the pullback low − 0.25 × entry-timeframe ATR. Targets: retest of the peak, then the full pump height added to the pullback low.`,

  run({ asset, daily: D, h4: H, tf }, p) {
    const n = D.length;
    const empty = { symbol: asset.symbol, levels: [] as Level[], chart: { timeframe: "daily" as const, overlays: [] } };
    // Peak search includes the latest bar: a coin printing new highs is "extended", not "pulled back".
    const win = D.slice(-p.lookback);
    if (n < 45 || !win.length) return { ...empty, status: "fail", direction: "neutral", score: 0, headline: "Not enough history", reason: "", metrics: [] };

    // Peak of the recent run (completed bars before today, so there is something to pull back from).
    const pk = n - p.lookback + win.reduce((m, c, i) => (c.high > win[m].high ? i : m), 0);
    const peak = D[pk].high;
    const pre = D.slice(Math.max(0, pk - 20), pk + 1);
    const baseRel = pre.reduce((m, c, i) => (c.low < pre[m].low ? i : m), 0);
    const baseIdx = Math.max(0, pk - 20) + baseRel;
    const baseLow = D[baseIdx].low;
    const pump = peak / baseLow - 1;
    const priorVol = mean(D.slice(Math.max(0, baseIdx - 20), baseIdx).map((c) => c.volume));
    const runVols = D.slice(baseIdx, pk + 1).map((c) => c.volume);
    const spike = priorVol ? Math.max(...runVols) / priorVol : 0;
    const pumped = pump >= p.minPump / 100 && spike >= 2;

    const close = last(closes(D));
    const height = peak - baseLow;
    const retrace = height > 0 ? (peak - close) / height : 0;
    const sincePeak = D.slice(pk + 1);
    const dryUp = sincePeak.length > 0 && mean(sincePeak.map((c) => c.volume)) < 0.6 * mean(runVols);
    const fib = (r: number) => peak - height * r;
    const e20 = ema(closes(D), 20);

    // Entry-timeframe trigger: break of the pullback-low bar's high + RSI back above 50.
    const peakTime = D[pk].time;
    const hAfter = H.filter((c) => c.time > peakTime);
    const hr = rsiSeries(closes(H));
    let triggered = false;
    let pbBar = hAfter[0];
    if (hAfter.length >= 4) {
      pbBar = hAfter.reduce((m, c) => (c.low < m.low ? c : m), hAfter[0]);
      const pbIdx = H.indexOf(pbBar);
      const confirmed = pbIdx <= H.length - 4;
      const rNow = last(hr) ?? 0;
      const crossed = rNow > 50 && hr.slice(-6, -1).some((v) => v !== null && v < 50);
      triggered = confirmed && last(H).close > pbBar.high && crossed;
    }
    const zoneLo = p.deep / 100;
    const inZone = retrace >= 0.382 && retrace <= zoneLo;
    const extended = retrace < 0.236;
    const invalid = retrace > 0.786 || close < baseLow;

    // Trigger only on a turn inside the buy zone with drying-up volume; a turn on heavy volume stays "pass".
    const status = !pumped || invalid ? "fail" : triggered && retrace >= 0.3 && retrace <= zoneLo && dryUp ? "trigger" : inZone || triggered ? "pass" : "near";
    const stop = pbBar ? pbBar.low - 0.25 * atr(H) : close - 2 * atr(D);
    const entry = triggered ? close : Math.max(pbBar?.high ?? close, close);
    const levels: Level[] =
      pumped && !invalid
        ? [
            { price: entry, label: triggered ? "Entry" : "Buy above", kind: "entry" },
            { price: stop, label: "Stop", kind: "stop" },
            { price: peak, label: "T1 peak retest", kind: "target" },
            { price: (pbBar?.low ?? close) + height, label: "T2 measured", kind: "target" },
            { price: fib(0.382), label: "38.2%", kind: "level" },
            { price: fib(0.618), label: "61.8%", kind: "level" },
          ].filter((l) => !(l.kind === "target" && l.price <= entry)) as Level[]
        : [];
    const score = pumped
      ? clamp(Math.min(pump * 100, 150) / 3 + Math.min(spike, 6) * 4 + (1 - Math.abs(retrace - 0.5) * 2) * 15 + (dryUp ? 10 : 0) + (triggered ? 15 : 0))
      : 0;
    const stage = invalid
      ? "pullback too deep"
      : pk === n - 1
        ? "at new highs"
        : extended
          ? "still extended"
          : triggered
            ? "turned up"
            : inZone
              ? "in the buy zone"
              : "pulling back";

    return {
      symbol: asset.symbol,
      status,
      direction: pumped && !invalid ? "bullish" : "neutral",
      score,
      headline: pumped ? `+${(pump * 100).toFixed(0)}% pump · gave back ${(retrace * 100).toFixed(0)}% · ${stage}` : "No recent pump",
      reason: pumped
        ? `Pumped +${(pump * 100).toFixed(0)}% into ${new Date(peakTime * 1000).toISOString().slice(5, 10)} on ${fmtX(spike)} volume, and has since given back ${(retrace * 100).toFixed(0)}% of the move` +
          (dryUp ? " on drying-up volume (healthy profit-taking). " : " — volume hasn't dried up yet. ") +
          (invalid
            ? "The pullback is too deep — setup invalidated."
            : extended
              ? "It hasn't pulled back enough yet — chasing here means a wide stop. Wait for the 38–62% zone."
              : triggered
                ? `The ${tf.lowerLabel} chart has turned back up — entry with a stop under the pullback low (${fmtPct((stop / close - 1) * 100)}).`
                : `Watching for the entry-timeframe turn: a close above ${(pbBar?.high ?? close).toPrecision(5)} with RSI back over 50.`)
        : "No pump of the minimum size with a volume spike in the lookback window.",
      metrics: [
        { label: "Pump", value: pumped ? `+${(pump * 100).toFixed(0)}%` : "–" },
        { label: "Gave back", value: `${(retrace * 100).toFixed(0)}%` },
        { label: "Volume spike", value: fmtX(spike) },
        { label: "Volume since peak", value: dryUp ? "Drying up" : "Still heavy" },
      ],
      levels,
      chart: {
        timeframe: "daily",
        overlays: [{ label: "EMA 20", values: e20 }],
        markers: pumped ? [{ time: peakTime, text: "PEAK" }] : undefined,
      },
    };
  },
};
