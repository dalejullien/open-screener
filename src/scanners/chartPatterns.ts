import { atr, clamp, closes, last, mean } from "../lib/indicators";
import { fmtDate, fmtPct } from "../lib/format";
import type { Candle, Direction, Level, Marker, Overlay, Scanner, Status } from "../lib/types";

interface Pivot {
  i: number;
  price: number;
  type: "H" | "L";
  conf: number; // bar index on which this pivot became confirmed (first knowable)
}

/**
 * Confirmed swing points on closes: a high is confirmed once price falls `thr` below it, a low once
 * price rises `thr` above it. The final, still-moving leg is not a pivot (no look-ahead).
 */
export function zigzag(c: number[], thr: number): Pivot[] {
  const piv: Pivot[] = [];
  let hiI = 0;
  let loI = 0;
  for (let i = 1; i < c.length; i++) {
    if (c[i] > c[hiI]) hiI = i;
    if (c[i] < c[loI]) loI = i;
    const lastType = piv.length ? piv[piv.length - 1].type : null;
    if (lastType !== "H" && hiI > (piv[piv.length - 1]?.i ?? -1) && c[i] <= c[hiI] * (1 - thr)) {
      piv.push({ i: hiI, price: c[hiI], type: "H", conf: i });
      loI = i;
      for (let j = hiI; j <= i; j++) if (c[j] < c[loI]) loI = j;
    } else if (lastType !== "L" && loI > (piv[piv.length - 1]?.i ?? -1) && c[i] >= c[loI] * (1 + thr)) {
      piv.push({ i: loI, price: c[loI], type: "L", conf: i });
      hiI = i;
      for (let j = loI; j <= i; j++) if (c[j] > c[hiI]) hiI = j;
    }
  }
  return piv;
}

interface Pattern {
  name: string;
  direction: Direction; // bullish / bearish / neutral (undecided until it breaks)
  state: "forming" | "confirmed" | "failed";
  stateIdx: number; // bar index where the state was decided (or last pivot while forming)
  quality: number; // 0–100 shape fit — NOT a win probability
  points: { p: Pivot; label: string }[];
  bounds: { label: string; at: (i: number) => number; from: number }[];
  trigger: number; // breakout level at the current bar
  invalidation: number;
  stop?: number; // structural stop if tighter than the invalidation level (e.g. under a flag's low)
  height: number; // for the measured-move target
}

const line = (a: Pivot, b: Pivot) => (i: number) => a.price + ((b.price - a.price) * (i - a.i)) / (b.i - a.i);
const near = (a: number, b: number, tol: number) => Math.abs(a / b - 1) <= tol;

/** Resolve state by walking closes after the last pivot: breakout confirms, invalidation fails. */
function resolve(c: number[], from: number, up: (i: number) => number, down: (i: number) => number, bias: Direction) {
  for (let i = from + 1; i < c.length; i++) {
    if (c[i] > up(i)) return bias === "bearish" ? { state: "failed" as const, i, dir: bias } : { state: "confirmed" as const, i, dir: "bullish" as const };
    if (c[i] < down(i)) return bias === "bullish" ? { state: "failed" as const, i, dir: bias } : { state: "confirmed" as const, i, dir: "bearish" as const };
  }
  return { state: "forming" as const, i: from, dir: bias };
}

function detect(c: number[], piv: Pivot[], tol: number, thr: number): Pattern[] {
  const out: Pattern[] = [];
  const n = c.length;
  const P = (k: number) => piv[piv.length - k]; // k-th pivot from the end
  const recent = (p: Pivot) => n - 1 - p.i <= 40;

  // Double bottom / top: L H L or H L H with matching extremes.
  for (const k of [1, 2, 3]) {
    const [a, m, b] = [P(k + 2), P(k + 1), P(k)];
    if (!a || !m || !b || !recent(b)) continue;
    if (a.type === "L" && b.type === "L" && near(a.price, b.price, tol) && m.price >= Math.max(a.price, b.price) * (1 + thr)) {
      const low = Math.min(a.price, b.price);
      const r = resolve(c, b.i, () => m.price, () => low * (1 - tol), "bullish");
      out.push({
        name: "Double bottom", direction: r.dir, state: r.state, stateIdx: r.i,
        quality: clamp(95 - (Math.abs(a.price / b.price - 1) / tol) * 45 - Math.abs(Math.log((m.i - a.i) / (b.i - m.i))) * 25 - (b.i - a.i < 10 ? 20 : 0)),
        points: [{ p: a, label: "Bottom 1" }, { p: m, label: "Neckline" }, { p: b, label: "Bottom 2" }],
        bounds: [{ label: "Neckline", at: () => m.price, from: a.i }, { label: "Support", at: () => low, from: a.i }],
        trigger: m.price, invalidation: low * (1 - tol), height: m.price - low,
      });
    }
    if (a.type === "H" && b.type === "H" && near(a.price, b.price, tol) && m.price <= Math.min(a.price, b.price) * (1 - thr)) {
      const high = Math.max(a.price, b.price);
      const r = resolve(c, b.i, () => high * (1 + tol), () => m.price, "bearish");
      out.push({
        name: "Double top", direction: r.dir, state: r.state, stateIdx: r.i,
        quality: clamp(95 - (Math.abs(a.price / b.price - 1) / tol) * 45 - Math.abs(Math.log((m.i - a.i) / (b.i - m.i))) * 25 - (b.i - a.i < 10 ? 20 : 0)),
        points: [{ p: a, label: "Top 1" }, { p: m, label: "Neckline" }, { p: b, label: "Top 2" }],
        bounds: [{ label: "Neckline", at: () => m.price, from: a.i }, { label: "Resistance", at: () => high, from: a.i }],
        trigger: m.price, invalidation: high * (1 + tol), height: high - m.price,
      });
    }
  }

  // Triple bottom / top: L H L H L (or mirror) with three matching extremes.
  for (const k of [1, 2]) {
    const s5 = [P(k + 4), P(k + 3), P(k + 2), P(k + 1), P(k)];
    if (s5.some((x) => !x) || !recent(s5[4])) continue;
    const [e1, m1, e2, m2, e3] = s5;
    const ext = [e1.price, e2.price, e3.price];
    const spread = Math.max(...ext) / Math.min(...ext) - 1;
    if (spread > tol * 1.5) continue;
    if (e1.type === "L") {
      const neck = Math.max(m1.price, m2.price);
      const low = Math.min(...ext);
      if (neck < Math.max(...ext) * (1 + thr)) continue;
      const r = resolve(c, e3.i, () => neck, () => low * (1 - tol), "bullish");
      out.push({
        name: "Triple bottom", direction: r.dir, state: r.state, stateIdx: r.i,
        quality: clamp(100 - (spread / (tol * 1.5)) * 40 - Math.abs(m1.price / m2.price - 1) * 300),
        points: [{ p: e1, label: "Bottom 1" }, { p: m1, label: "Neckline" }, { p: e2, label: "Bottom 2" }, { p: m2, label: "Neckline" }, { p: e3, label: "Bottom 3" }],
        bounds: [{ label: "Neckline", at: () => neck, from: e1.i }, { label: "Support", at: () => low, from: e1.i }],
        trigger: neck, invalidation: low * (1 - tol), height: neck - low,
      });
    } else {
      const neck = Math.min(m1.price, m2.price);
      const high = Math.max(...ext);
      if (neck > Math.min(...ext) * (1 - thr)) continue;
      const r = resolve(c, e3.i, () => high * (1 + tol), () => neck, "bearish");
      out.push({
        name: "Triple top", direction: r.dir, state: r.state, stateIdx: r.i,
        quality: clamp(100 - (spread / (tol * 1.5)) * 40 - Math.abs(m1.price / m2.price - 1) * 300),
        points: [{ p: e1, label: "Top 1" }, { p: m1, label: "Neckline" }, { p: e2, label: "Top 2" }, { p: m2, label: "Neckline" }, { p: e3, label: "Top 3" }],
        bounds: [{ label: "Neckline", at: () => neck, from: e1.i }, { label: "Resistance", at: () => high, from: e1.i }],
        trigger: neck, invalidation: high * (1 + tol), height: high - neck,
      });
    }
  }

  // (Inverse) head and shoulders: 5 alternating pivots, head beyond both shoulders, shoulders similar.
  for (const k of [1, 2, 3]) {
    const s = [P(k + 4), P(k + 3), P(k + 2), P(k + 1), P(k)];
    if (s.some((x) => !x) || !recent(s[4])) continue;
    const [l1, h1, head, h2, l3] = s;
    if (l1.type === "L" && head.price < l1.price * (1 - tol) && head.price < l3.price * (1 - tol) && near(l1.price, l3.price, tol * 2)) {
      const neck = line(h1, h2);
      const r = resolve(c, l3.i, neck, () => head.price, "bullish");
      out.push({
        name: "Inverse head & shoulders", direction: r.dir, state: r.state, stateIdx: r.i,
        quality: clamp(95 - (Math.abs(l1.price / l3.price - 1) / (tol * 2)) * 40 - Math.abs(h1.price / h2.price - 1) * 400 - Math.abs(Math.log((head.i - l1.i) / (l3.i - head.i))) * 20),
        points: [{ p: l1, label: "Left shoulder" }, { p: h1, label: "Neckline" }, { p: head, label: "Head" }, { p: h2, label: "Neckline" }, { p: l3, label: "Right shoulder" }],
        bounds: [{ label: "Neckline", at: neck, from: l1.i }],
        trigger: neck(n - 1), invalidation: head.price, height: neck(head.i) - head.price,
      });
    }
    if (l1.type === "H" && head.price > l1.price * (1 + tol) && head.price > l3.price * (1 + tol) && near(l1.price, l3.price, tol * 2)) {
      const neck = line(h1, h2);
      const r = resolve(c, l3.i, () => head.price, neck, "bearish");
      out.push({
        name: "Head & shoulders", direction: r.dir, state: r.state, stateIdx: r.i,
        quality: clamp(95 - (Math.abs(l1.price / l3.price - 1) / (tol * 2)) * 40 - Math.abs(h1.price / h2.price - 1) * 400 - Math.abs(Math.log((head.i - l1.i) / (l3.i - head.i))) * 20),
        points: [{ p: l1, label: "Left shoulder" }, { p: h1, label: "Neckline" }, { p: head, label: "Head" }, { p: h2, label: "Neckline" }, { p: l3, label: "Right shoulder" }],
        bounds: [{ label: "Neckline", at: neck, from: l1.i }],
        trigger: neck(n - 1), invalidation: head.price, height: head.price - neck(head.i),
      });
    }
  }

  // Triangles and wedges from the last 4–5 pivots: two highs + two lows define converging boundaries.
  const windows = [0, 1, 2].flatMap((end) => [6, 5, 4].map((count) => ({ end, count })));
  for (const { end, count } of windows) {
    const seg = piv.slice(piv.length - end - count, piv.length - end);
    if (seg.length < count || !recent(seg[seg.length - 1]) || seg[seg.length - 1].i - seg[0].i < 15) continue;
    const hs = seg.filter((p) => p.type === "H");
    const ls = seg.filter((p) => p.type === "L");
    if (hs.length < 2 || ls.length < 2) continue;
    const upper = line(hs[0], hs[hs.length - 1]);
    const lower = line(ls[0], ls[ls.length - 1]);
    const span = seg[seg.length - 1].i - seg[0].i;
    const mid = (upper(seg[0].i) + lower(seg[0].i)) / 2;
    const slopeU = (upper(seg[0].i + span) - upper(seg[0].i)) / mid; // relative change across the pattern
    const slopeL = (lower(seg[0].i + span) - lower(seg[0].i)) / mid;
    const widthStart = upper(seg[0].i) - lower(seg[0].i);
    const widthEnd = upper(n - 1) - lower(n - 1);
    if (!(widthStart > 0) || !(widthEnd > 0) || widthEnd >= widthStart * 0.85) continue; // must converge, apex not passed
    const flat = (s: number) => Math.abs(s) <= tol;
    let name = "";
    let bias: Direction = "neutral";
    if (flat(slopeU) && slopeL > tol) [name, bias] = ["Ascending triangle", "bullish"];
    else if (slopeU < -tol && flat(slopeL)) [name, bias] = ["Descending triangle", "bearish"];
    else if (slopeU < -tol && slopeL > tol) [name, bias] = ["Symmetrical triangle", "neutral"];
    else if (slopeU > tol && slopeL > slopeU) [name, bias] = ["Rising wedge", "bearish"];
    else if (slopeL < -tol && slopeU < slopeL) [name, bias] = ["Falling wedge", "bullish"];
    if (!name) continue;
    // Touch quality: how closely the middle pivots respect the boundaries.
    const resid = seg.map((p) => Math.abs(p.price / (p.type === "H" ? upper(p.i) : lower(p.i)) - 1)).reduce((s, v) => s + v, 0) / seg.length;
    const r = resolve(c, seg[seg.length - 1].i, upper, lower, bias);
    out.push({
      name, direction: r.dir, state: r.state, stateIdx: r.i,
      quality: clamp(90 - (resid / tol) * 120 - (count === 4 ? 10 : 0) + (count === 6 ? 5 : 0) - (span < 25 ? 10 : 0)),
      points: seg.map((p) => ({ p, label: p.type === "H" ? "Resistance" : "Support" })),
      bounds: [{ label: "Upper", at: upper, from: seg[0].i }, { label: "Lower", at: lower, from: seg[0].i }],
      trigger: bias === "bearish" ? lower(n - 1) : upper(n - 1),
      invalidation: bias === "bearish" ? upper(n - 1) : lower(n - 1),
      height: widthStart,
    });
    break;
  }
  return out;
}

/** Least-squares line through (x, y). */
function regress(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  xs.forEach((x, j) => {
    num += (x - mx) * (ys[j] - my);
    den += (x - mx) ** 2;
  });
  const s = den ? num / den : 0;
  return { s, b: my - s * mx };
}

/**
 * Bull / bear flags and pennants: a sharp pole, then a short, tight pause that drifts against the pole
 * (flag) or converges (pennant). Boundaries are refitted bar by bar on the pause so far, so a breakout
 * is judged only against lines drawn before it (no look-ahead).
 */
function flags(D: Candle[], atrPct: number): Pattern[] {
  const out: Pattern[] = [];
  const c = D.map((x) => x.close);
  const n = c.length;
  const minPole = Math.max(0.15, 3 * atrPct);
  for (const bull of [true, false]) {
    let pe = -1;
    for (let i = Math.max(0, n - 25); i <= n - 4; i++) if (pe < 0 || (bull ? c[i] > c[pe] : c[i] < c[pe])) pe = i;
    if (pe < 0) continue;
    let ps = pe;
    for (let i = Math.max(0, pe - 12); i < pe; i++) if (bull ? c[i] < c[ps] : c[i] > c[ps]) ps = i;
    const pole = bull ? c[pe] / c[ps] - 1 : c[ps] / c[pe] - 1;
    if (pole < minPole || pe - ps < 2) continue;
    const poleH = Math.abs(c[pe] - c[ps]);

    const fit = (a: number, b: number) => {
      const xs: number[] = [];
      const hs: number[] = [];
      const ls: number[] = [];
      for (let i = a; i <= b; i++) {
        xs.push(i);
        hs.push(D[i].high);
        ls.push(D[i].low);
      }
      const rh = regress(xs, hs);
      const rl = regress(xs, ls);
      // Shift the regression lines out to envelope the pause.
      const offH = Math.max(...hs.map((y, j) => y - (rh.s * xs[j] + rh.b)));
      const offL = Math.min(...ls.map((y, j) => y - (rl.s * xs[j] + rl.b)));
      return { up: (i: number) => rh.s * i + rh.b + offH, lo: (i: number) => rl.s * i + rl.b + offL, sH: rh.s, sL: rl.s };
    };

    let state: Pattern["state"] = "forming";
    let stateIdx = n - 1;
    let end = n - 1;
    let f = fit(pe, n - 1);
    for (let i = pe + 3; i < n; i++) {
      const g = fit(pe, i - 1);
      const seg = D.slice(pe, i + 1);
      const retr = bull ? (c[pe] - Math.min(...seg.map((x) => x.low))) / poleH : (Math.max(...seg.map((x) => x.high)) - c[pe]) / poleH;
      if (retr > 0.618) {
        [state, stateIdx, end, f] = ["failed", i, i - 1, g];
        break;
      }
      if (bull ? c[i] > g.up(i) : c[i] < g.lo(i)) {
        [state, stateIdx, end, f] = ["confirmed", i, i - 1, g];
        break;
      }
    }
    const len = end - pe;
    if (len < 3 || len > 20) continue;
    const sH = (f.sH * len) / c[pe];
    const sL = (f.sL * len) / c[pe];
    const w0 = f.up(pe) - f.lo(pe);
    const w1 = f.up(end) - f.lo(end);
    const converging = w1 < w0 * 0.7 && ((bull && sH < 0 && sL > -0.02) || (!bull && sL > 0 && sH < 0.02));
    const counter = bull ? sH <= 0.02 && sL <= 0.02 : sH >= -0.02 && sL >= -0.02;
    if (!converging && !counter) continue;
    const tight = w0 / poleH;
    if (tight > 0.6) continue;
    const volPole = mean(D.slice(ps, pe + 1).map((x) => x.volume));
    const volFlag = mean(D.slice(pe + 1, end + 1).map((x) => x.volume));
    const dry = volFlag < volPole * 0.8;
    out.push({
      name: `${bull ? "Bull" : "Bear"} ${converging ? "pennant" : "flag"}`,
      direction: bull ? "bullish" : "bearish",
      state,
      stateIdx: state === "forming" ? end : stateIdx,
      quality: clamp(55 + Math.min(pole / minPole, 3) * 8 + (1 - tight / 0.6) * 15 + (dry ? 10 : 0) - Math.max(0, len - 12) * 2),
      points: [
        { p: { i: ps, price: c[ps], type: bull ? "L" : "H", conf: pe }, label: "Pole start" },
        { p: { i: pe, price: c[pe], type: bull ? "H" : "L", conf: Math.min(n - 1, pe + 3) }, label: bull ? "Pole top" : "Pole bottom" },
      ],
      bounds: [
        { label: "Flag top", at: f.up, from: pe },
        { label: "Flag bottom", at: f.lo, from: pe },
      ],
      trigger: bull ? f.up(n - 1) : f.lo(n - 1),
      invalidation: bull ? c[pe] - 0.618 * poleH : c[pe] + 0.618 * poleH,
      // Standard flag stop: just beyond the pause's own extreme, not the whole pole.
      stop: bull ? Math.min(...D.slice(pe, end + 1).map((x) => x.low)) : Math.max(...D.slice(pe, end + 1).map((x) => x.high)),
      height: poleH,
    });
  }
  return out;
}

const STATE_STATUS: Record<Pattern["state"], Status> = { confirmed: "trigger", forming: "pass", failed: "fail" };

export const chartPatterns: Scanner = {
  id: "patterns",
  name: "Chart Patterns",
  tagline: "Recognise formations. Follow their breakouts.",
  icon: "⌁",
  params: [
    { key: "minQuality", label: "Min shape quality", default: 65, min: 0, max: 100, step: 5 },
    { key: "swing", label: "Swing size", default: 1.5, min: 0.5, max: 4, step: 0.25, suffix: "× ATR" },
  ],
  methodology: `Swing points: a zigzag on completed closes. A swing high is confirmed only after price falls by the swing size (default 1.5 × ATR%, at least 4%) from it, and vice versa — so pivots never use future data.
Detection runs at two swing sizes (≈1× and ≈2× ATR%), so both short and larger structures are found. Patterns found on recent pivots (last pivot within 40 bars):
• Double bottom / top — two matching extremes (within tolerance) around a neckline at least one swing away.
• Triple bottom / top — three matching extremes with two necklines between them.
• Bull / bear flag and pennant — a sharp pole (≥ 15% and ≥ 3 × ATR% within 12 bars), then a 3–20 bar pause no taller than 60% of the pole that drifts against it (flag) or converges (pennant); fails if it gives back more than 61.8% of the pole. Lines are refitted bar by bar, so a breakout is judged only against lines drawn before it.
• Inverse / head & shoulders — five alternating pivots, head beyond both shoulders, similar shoulders; sloped neckline through the two inner pivots.
• Triangles — ascending (flat top, rising lows), descending (falling highs, flat bottom), symmetrical (converging), and rising / falling wedges — from 4–6 recent pivots; boundaries must converge and the apex must not have passed.
States: Forming until a close breaks a boundary. Confirmed when a close breaks in the pattern's direction (symmetrical triangles take the direction of the break). Failed when price closes beyond the invalidation level first.
Shape quality (0–100) measures how cleanly the pivots fit the template — it is a fit score, not a win probability.
Levels for bullish setups: buy above the breakout level, stop under the invalidation level, target = measured move (pattern height added to the breakout).`,

  run({ asset, daily }, p) {
    const c = closes(daily);
    const close = last(c);
    const atrPct = atr(daily) / close;
    // Two swing sizes: small swings find short patterns, large swings find the bigger structures.
    const scales = [Math.max(0.03, p.swing * atrPct * 0.67), Math.max(0.05, p.swing * atrPct * 1.33)];
    const thr = scales[0];
    const all = [
      ...scales.flatMap((t) => detect(c, zigzag(c, t), Math.max(0.015, t * 0.35), t)),
      ...flags(daily, atrPct),
    ];
    // A confirmation/failure is only news for 10 bars; older ones are history, not a setup.
    const rank = { confirmed: 2, forming: 1, failed: 0 };
    const order = (a: Pattern, b: Pattern) => b.stateIdx - a.stateIdx || rank[b.state] - rank[a.state] || b.quality - a.quality;
    const fresh = all.filter((x) => x.quality >= p.minQuality && (x.state === "forming" || c.length - 1 - x.stateIdx <= 10)).sort(order);
    // One entry per pattern type (the best/most recent), so the same shape isn't listed twice.
    const found = fresh.filter((x, i) => fresh.findIndex((y) => y.name === x.name) === i);
    const best = found[0];
    const others = found.slice(1, 4);

    if (!best) {
      return {
        symbol: asset.symbol, status: "fail", direction: "neutral", score: 0, headline: "No formation",
        reason: "No pattern on the recent confirmed swing points meets the minimum shape quality.",
        metrics: [{ label: "Swing size", value: `${(thr * 100).toFixed(1)}%` }], levels: [], chart: { timeframe: "daily", overlays: [] },
      };
    }

    const n = c.length;
    const startIdx = Math.min(...best.points.map((x) => x.p.i));
    const formation: (number | null)[] = c.map(() => null);
    for (const { p: pt } of best.points) formation[pt.i] = pt.price;
    const overlays: Overlay[] = [
      { label: "Formation", values: formation, style: "solid", color: best.direction === "bearish" ? "bad" : best.direction === "bullish" ? "good" : "s1" },
      ...best.bounds.map((b) => ({ label: b.label, values: c.map((_, i) => (i >= b.from ? b.at(i) : null)), style: "dashed" as const, color: "s1" as const })),
    ];
    const markers: Marker[] = best.points
      .map(({ p: pt, label }) => ({ time: daily[pt.i].time, text: label, position: pt.type === "H" ? ("above" as const) : ("below" as const) }));
    if (best.state === "confirmed") markers.push({ time: daily[best.stateIdx].time, text: "BREAKOUT" });
    markers.sort((a, b) => a.time - b.time);

    const bullish = best.direction === "bullish";
    const a = atr(daily);
    let levels: Level[];
    if (bullish && best.state !== "failed") {
      const entry = best.state === "confirmed" ? close : best.trigger;
      const stop = (best.stop ?? best.invalidation) - 0.1 * a;
      levels = [
        { price: entry, label: best.state === "confirmed" ? "Entry" : "Buy above", kind: "entry" },
        { price: stop, label: "Stop", kind: "stop" },
        { price: best.trigger + best.height, label: "Measured move", kind: "target" },
      ];
      if (!(stop < entry)) levels = [];
    } else {
      levels = [
        { price: best.trigger, label: "Breakout level", kind: "level" },
        { price: best.invalidation, label: "Invalidation", kind: "level" },
      ];
    }

    const when = fmtDate((daily[best.stateIdx] ?? daily[n - 1]).time);
    const stateText = best.state === "confirmed" ? `Confirmed ${when}` : best.state === "failed" ? `Failed ${when}` : `Forming since ${fmtDate(daily[startIdx].time)}`;
    const dirLabel = best.direction === "bullish" ? "Bullish" : best.direction === "bearish" ? "Bearish" : "Undecided";

    return {
      symbol: asset.symbol,
      status: STATE_STATUS[best.state],
      direction: best.direction,
      score: best.quality,
      headline: `${best.name} · ${stateText}`,
      reason:
        `${best.name} (${dirLabel.toLowerCase()}) built from ${best.points.length} swing points over ${n - 1 - startIdx} bars. ` +
        (best.state === "confirmed"
          ? `A close broke the ${best.direction === "bearish" ? "lower" : "upper"} boundary on ${when}.`
          : best.state === "failed"
            ? `Price closed beyond the invalidation level on ${when}, so the pattern failed.`
            : `Watching for a close beyond ${best.trigger.toPrecision(5)} (${fmtPct((best.trigger / close - 1) * 100)} away).`) +
        ` Shape quality ${best.quality.toFixed(0)}/100 — a fit score, not a win probability.`,
      metrics: [
        { label: "Shape quality", value: `${best.quality.toFixed(0)}/100` },
        { label: "Direction", value: dirLabel },
        { label: "First detectable", value: fmtDate(daily[best.points[best.points.length - 1].p.conf].time) },
        { label: "Pattern height", value: fmtPct((best.height / close) * 100) },
        ...(others.length ? [{ label: "Also detected", value: others.map((o) => `${o.name} (${o.state})`).join(", ") }] : []),
      ],
      meta: { group: best.name },
      levels,
      chart: { timeframe: "daily", overlays, markers },
    };
  },
};
