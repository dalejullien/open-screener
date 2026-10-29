import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readTheme } from "../lib/chartTheme";
import { fmtBarTime, fmtPct } from "../lib/format";
import type { MarketData } from "../lib/types";

interface Line {
  symbol: string;
  base: string;
  logo?: string;
  vals: number[]; // ln(price / price at start), one per bar
  ret: number; // % over the window
  role: "top" | "bottom" | "btc" | "eth" | "other";
}

// Brand colours so the two benchmarks never blend with the green/red outliers.
const BTC_COLOR = "#F7931A";
const ETH_COLOR = "#7B8CF0";
const Y_TICKS = [-90, -75, -50, -30, -20, -10, -5, 0, 5, 10, 20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const PAD = { l: 58, r: 168, t: 14, b: 30 };
const LABEL_GAP = 15;

const H = 3600;
const D = 86_400;
// Window presets per timeframe (seconds) and which one is the default.
const PRESETS: Record<string, number[]> = {
  "1H": [2 * H, 4 * H, 12 * H, 24 * H, 3 * D],
  "4H": [4 * H, 12 * H, 24 * H, 3 * D, 7 * D, 30 * D],
  D: [1 * D, 3 * D, 7 * D, 30 * D, 90 * D, 180 * D],
  "3D": [7 * D, 30 * D, 90 * D, 180 * D, 365 * D],
  W: [30 * D, 90 * D, 180 * D, 365 * D, 730 * D],
};
const DEFAULT_PRESET: Record<string, number> = { "1H": 1, "4H": 1, D: 1, "3D": 2, W: 2 };
const spanLabel = (s: number) => (s < D ? `${s / H}h` : s % (365 * D) === 0 ? `${s / (365 * D)}y` : `${s / D}d`);

/**
 * Every coin's return from a common start, on a log scale, with the outliers labelled.
 * Canvas keeps hundreds of lines smooth. Scroll to zoom, drag to pan, double-click to reset;
 * zooming in labels every line that fits. Nothing is downloaded beyond the scan's candles.
 */
export function PerformanceView({
  data,
  dark,
  universeControl,
  onOpen,
  onScanLeaders,
}: {
  data: MarketData[];
  dark: boolean;
  universeControl: ReactNode;
  onOpen: (symbol: string) => void;
  onScanLeaders: (symbols: string[]) => void;
}) {
  const tfId = data[0]?.tf.id ?? "D";
  const presets = PRESETS[tfId];
  // Time window: either "last N seconds up to now" (follows live data) or a fixed span the user dragged to.
  const [win, setWin] = useState<{ span: number; end: number | null }>({ span: presets[DEFAULT_PRESET[tfId]], end: null });
  const [topN, setTopN] = useState(7);
  const [hover, setHover] = useState<{ line: Line; idx: number; x: number; y: number } | null>(null);
  const [view, setView] = useState<{ lo: number; hi: number } | null>(null); // zoomed y-range (log units)
  const [imgTick, setImgTick] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const drag = useRef<{ y: number; view: { lo: number; hi: number } } | null>(null);
  const [size, setSize] = useState({ w: 900, h: 460 });

  // New timeframe → its default window.
  useEffect(() => setWin({ span: PRESETS[tfId][DEFAULT_PRESET[tfId]], end: null }), [tfId]);

  // Full time range available for the brush: oldest primary bar → newest entry-timeframe bar.
  const range = useMemo(() => {
    const ref = data.find((d) => d.asset.base === "BTC") ?? data[0];
    if (!ref) return null;
    const lastLower = ref.h4.length ? ref.h4[ref.h4.length - 1].time + ref.tf.lowerSec : 0;
    const lastPrimary = ref.daily[ref.daily.length - 1].time + ref.tf.primarySec;
    return { ref, from: ref.daily[0].time, to: Math.max(lastLower, lastPrimary), overview: ref.daily.map((c) => ({ t: c.time, v: c.close })) };
  }, [data]);

  const t1 = range ? Math.min(win.end ?? range.to, range.to) : 0;
  const t0 = range ? Math.max(range.from, t1 - win.span) : 0;

  const model = useMemo(() => {
    if (!range) return null;
    const { ref } = range;
    // Finest series that covers the window with enough points: the entry timeframe for short windows.
    const lowerOk = ref.h4.length > 1 && ref.h4[0].time <= t0 && (t1 - t0) / ref.tf.lowerSec <= 600;
    const pick = (d: MarketData) => (lowerOk ? d.h4 : d.daily);
    const barSec = lowerOk ? ref.tf.lowerSec : ref.tf.primarySec;
    // Bars are stamped at their open; a bar belongs to the window if it closed inside it.
    const grid = pick(ref).filter((c) => c.time + barSec > t0 && c.time + barSec <= t1).map((c) => c.time);
    if (grid.length < 2) return null;
    const lines: Line[] = [];
    let skipped = 0;
    for (const d of data) {
      const bars = pick(d);
      const before = [...bars].reverse().find((c) => c.time + barSec <= t0 + barSec / 2);
      if (!before) {
        skipped++;
        continue;
      }
      const byTime = new Map(bars.map((c) => [c.time, c.close]));
      let lastClose = before.close;
      // Re-baseline: every coin starts at 0% on the window's left edge.
      const vals = grid.map((t) => {
        const c = byTime.get(t);
        if (c !== undefined) lastClose = c;
        return Math.log(lastClose / before.close);
      });
      vals.unshift(0);
      lines.push({ symbol: d.asset.symbol, base: d.asset.base, logo: d.asset.logo, vals, ret: (Math.exp(vals[vals.length - 1]) - 1) * 100, role: "other" });
    }
    if (!lines.length) return null;
    const times = [grid[0] - barSec, ...grid].map((t) => t + barSec); // label each point by its close time
    const ranked = [...lines].sort((a, b) => b.ret - a.ret);
    const n = Math.min(topN, Math.floor(ranked.length / 2));
    ranked.slice(0, n).forEach((l) => (l.role = "top"));
    ranked.slice(-n).forEach((l) => (l.role = "bottom"));
    for (const l of lines) {
      if (l.base === "BTC") l.role = "btc";
      if (l.base === "ETH") l.role = "eth";
    }
    const median = times.map((_, i) => {
      const v = lines.map((l) => l.vals[i]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    });
    const medRet = (Math.exp(median[median.length - 1]) - 1) * 100;
    const btc = lines.find((l) => l.base === "BTC");
    const eth = lines.find((l) => l.base === "ETH");
    const beat = (r?: number) => (r === undefined ? null : lines.filter((l) => l.ret > r && l.base !== "BTC" && l.base !== "ETH").length);
    const all = lines.flatMap((l) => l.vals);
    return {
      barSec,
      lines,
      times,
      median,
      medRet,
      min: Math.min(...all),
      max: Math.max(...all),
      skipped,
      leaders: ranked.slice(0, n),
      beats: { btc: beat(btc?.ret), eth: beat(eth?.ret), median: beat(medRet), up: lines.filter((l) => l.ret > 0).length },
    };
  }, [data, range, t0, t1, topN]);

  // Reset the y-zoom whenever the window changes.
  useEffect(() => setView(null), [t0, t1, data.length]);

  // Logos (CoinGecko URLs already loaded with market caps); redraw as each arrives.
  useEffect(() => {
    if (!model) return;
    for (const l of model.lines) {
      if (!l.logo || images.current.has(l.logo)) continue;
      const img = new Image();
      img.onload = () => setImgTick((t) => t + 1);
      img.src = l.logo;
      images.current.set(l.logo, img);
    }
  }, [model]);

  useEffect(() => {
    if (!wrap.current) return;
    // Fill the visible space: everything between the chart's top and the bottom of the scroll area,
    // minus room for the time slider (~80px).
    const el = wrap.current;
    // Measured against the browser window (fixed), never the scroll area (which grows with the chart).
    const measure = () => {
      const content = el.closest(".content") as HTMLElement | null;
      const top = el.getBoundingClientRect().top + (content?.scrollTop ?? 0);
      const footer = (document.querySelector(".footer") as HTMLElement | null)?.offsetHeight ?? 40;
      const h = Math.round(Math.max(380, window.innerHeight - top - footer - 84));
      const w = Math.round(Math.max(480, el.clientWidth - 64));
      setSize((cur) => (cur.w === w && cur.h === h ? cur : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const geom = useMemo(() => {
    if (!model) return null;
    const pad = (model.max - model.min) * 0.04 || 0.1;
    const full = { lo: model.min - pad, hi: model.max + pad };
    const { lo, hi } = view ?? full;
    const x = (i: number) => PAD.l + (i / (model.times.length - 1)) * (size.w - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (size.h - PAD.t - PAD.b);
    const inv = (py: number) => lo + (1 - (py - PAD.t) / (size.h - PAD.t - PAD.b)) * (hi - lo);
    return { x, y, inv, lo, hi, full };
  }, [model, size, view]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !geom) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const at = geom.inv(e.clientY - r.top);
      const k = e.deltaY < 0 ? 0.8 : 1.25;
      let lo = at - (at - geom.lo) * k;
      let hi = at + (geom.hi - at) * k;
      if (hi - lo >= geom.full.hi - geom.full.lo) return setView(null);
      lo = Math.max(lo, geom.full.lo);
      hi = Math.min(hi, geom.full.hi);
      setView({ lo, hi });
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [geom]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !model || !geom) return;
    const t = readTheme();
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    g.font = "11px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
    const plotTop = PAD.t;
    const plotBottom = size.h - PAD.b;

    // Grid + axis labels (recessive); keep 0% and drop ticks that would crowd each other.
    g.textAlign = "right";
    const drawn: number[] = [];
    for (const p of [0, ...Y_TICKS.filter((x) => x !== 0)]) {
      const v = Math.log(1 + p / 100);
      if (v < geom.lo || v > geom.hi) continue;
      const yy = geom.y(v);
      if (drawn.some((d) => Math.abs(d - yy) < 16)) continue;
      drawn.push(yy);
      g.strokeStyle = p === 0 ? t.ink2 : t.grid;
      g.globalAlpha = p === 0 ? 0.5 : 1;
      g.beginPath();
      g.moveTo(PAD.l, yy);
      g.lineTo(size.w - PAD.r, yy);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = t.ink2;
      g.fillText(`${p > 0 ? "+" : ""}${p}%`, PAD.l - 8, yy + 4);
    }
    g.textAlign = "center";
    for (let s = 0; s <= 6; s++) {
      const i = Math.round((s / 6) * (model.times.length - 1));
      g.fillText(fmtBarTime(model.times[i], model.barSec), geom.x(i), size.h - 10);
    }

    // Clip lines to the plot so zoomed-out-of-view parts don't spill over the axes.
    g.save();
    g.beginPath();
    g.rect(PAD.l, plotTop, size.w - PAD.l - PAD.r, plotBottom - plotTop);
    g.clip();
    const path = (vals: number[]) => {
      g.beginPath();
      vals.forEach((v, i) => (i ? g.lineTo(geom.x(i), geom.y(v)) : g.moveTo(geom.x(i), geom.y(v))));
      g.stroke();
    };
    const color = (l: Line) => (l.role === "top" ? t.good : l.role === "bottom" ? t.bad : l.role === "btc" ? BTC_COLOR : l.role === "eth" ? ETH_COLOR : t.ink2);

    g.lineWidth = 1;
    g.globalAlpha = view ? (dark ? 0.3 : 0.35) : dark ? 0.13 : 0.16;
    g.strokeStyle = t.ink2;
    for (const l of model.lines) if (l.role === "other") path(l.vals);
    g.globalAlpha = 1;
    g.setLineDash([5, 4]);
    g.lineWidth = 1.5;
    g.strokeStyle = t.ink;
    path(model.median);
    g.setLineDash([]);
    const hl = model.lines.filter((l) => l.role !== "other");
    for (const l of hl) {
      g.lineWidth = l.role === "btc" || l.role === "eth" ? 2.5 : 1.8;
      g.strokeStyle = color(l);
      path(l.vals);
    }
    if (hover) {
      g.lineWidth = 3;
      g.strokeStyle = t.ink;
      path(hover.line.vals);
    }
    g.restore();

    // Labels: highlighted lines always; when zoomed, every other line whose end is in view (as space allows).
    const endY = (l: Line) => geom.y(l.vals[l.vals.length - 1]);
    const inView = (yy: number) => yy >= plotTop && yy <= plotBottom;
    // Zoomed: add unlabelled lines wherever there's room, so each name sits next to its own line.
    const extra: Line[] = [];
    if (view) {
      const taken = [...hl.map(endY), geom.y(model.median[model.median.length - 1])].filter(inView);
      const cands = model.lines.filter((l) => l.role === "other" && inView(endY(l))).sort((a, b) => b.ret - a.ret);
      for (const l of cands) {
        const yy = endY(l);
        if (taken.every((t) => Math.abs(t - yy) >= LABEL_GAP)) {
          extra.push(l);
          taken.push(yy);
        }
      }
    }
    const labels = [
      ...[...hl, ...extra]
        .filter((l) => inView(endY(l)))
        .map((l) => ({ text: `${l.base} ${fmtPct(l.ret)}`, y: endY(l), color: l.role === "other" ? t.ink2 : color(l), logo: l.logo })),
      ...(inView(geom.y(model.median[model.median.length - 1]))
        ? [{ text: `Median ${fmtPct(model.medRet)}`, y: geom.y(model.median[model.median.length - 1]), color: t.ink, logo: undefined as string | undefined }]
        : []),
    ].sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + LABEL_GAP);
    const overflow = labels.length ? labels[labels.length - 1].y - plotBottom : 0;
    if (overflow > 0) labels.forEach((l) => (l.y -= overflow));
    for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - LABEL_GAP);
    g.textAlign = "left";
    g.font = "600 11px -apple-system, BlinkMacSystemFont, Inter, sans-serif";
    const lx = size.w - PAD.r + 12;
    for (const l of labels) {
      const img = l.logo ? images.current.get(l.logo) : undefined;
      if (img?.complete && img.naturalWidth) {
        g.save();
        g.beginPath();
        g.arc(lx, l.y, 6.5, 0, Math.PI * 2);
        g.clip();
        g.drawImage(img, lx - 6.5, l.y - 6.5, 13, 13);
        g.restore();
      } else {
        g.fillStyle = l.color;
        g.beginPath();
        g.arc(lx, l.y, 3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = l.color;
      g.fillText(l.text, lx + 11, l.y + 4);
    }
  }, [model, geom, size, dark, hover, view, imgTick]);

  const onMove = (e: React.MouseEvent) => {
    if (!model || !geom) return;
    const r = canvas.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    if (drag.current) {
      const dv = geom.inv(my) - geom.inv(drag.current.y);
      const span = drag.current.view.hi - drag.current.view.lo;
      const lo = Math.min(Math.max(drag.current.view.lo - dv, geom.full.lo), geom.full.hi - span);
      setView({ lo, hi: lo + span });
      return;
    }
    const idx = Math.round(((mx - PAD.l) / (size.w - PAD.l - PAD.r)) * (model.times.length - 1));
    if (idx < 0 || idx >= model.times.length) return setHover(null);
    let best: Line | null = null;
    let bestD = 10;
    for (const l of model.lines) {
      const d = Math.abs(geom.y(l.vals[idx]) - my);
      if (d < bestD || (d === bestD && l.role !== "other")) [best, bestD] = [l, d];
    }
    setHover(best ? { line: best, idx, x: mx, y: my } : null);
  };

  if (!model) return <div className="loading">Loading…</div>;
  const total = model.lines.length;
  return (
    <>
      <div className="toolbar">
        {universeControl}
        <span className="spacer" />
        <div className="pills" title="Time window — every coin is re-measured from the window's start">
          {presets.map((p) => (
            <button key={p} className={win.end === null && win.span === p ? "on" : ""} onClick={() => setWin({ span: p, end: null })}>
              {spanLabel(p)}
            </button>
          ))}
        </div>
        <select value={topN} onChange={(e) => setTopN(+e.target.value)} title="How many outliers to highlight at each end">
          {[5, 7, 10, 20].map((n) => (
            <option key={n} value={n}>
              Highlight top/bottom {n}
            </option>
          ))}
        </select>
        <button className="btn primary" onClick={() => onScanLeaders(model.leaders.map((l) => l.symbol))} title="Make the leaders your watchlist and scan only them">
          Scan the leaders
        </button>
      </div>
      <div className="perf-stats">
        <span>
          <b>{model.beats.btc ?? "–"}</b> of {total} beat <b style={{ color: BTC_COLOR }}>BTC</b>
        </span>
        <span>
          <b>{model.beats.eth ?? "–"}</b> beat <b style={{ color: ETH_COLOR }}>ETH</b>
        </span>
        <span>
          <b>{model.beats.median}</b> beat the median ({fmtPct(model.medRet)})
        </span>
        <span>
          <b>{model.beats.up}</b> are up · <b>{total - model.beats.up}</b> down
        </span>
      </div>
      <div className="perf-legend">
        <span><i className="sw c-good" /> Top {model.leaders.length}</span>
        <span><i className="sw c-bad" /> Bottom {model.leaders.length}</span>
        <span><i className="sw" style={{ background: BTC_COLOR }} /> BTC</span>
        <span><i className="sw" style={{ background: ETH_COLOR }} /> ETH</span>
        <span><i className="sw dash-ink" /> Median</span>
        <span><i className="sw c-ink2" /> Others</span>
        <span className="muted small">
          Log scale · since {fmtBarTime(model.times[0], model.barSec)}
          {model.skipped ? ` · ${model.skipped} newer listings excluded` : ""} · scroll to zoom, drag to pan, double-click to reset · click a line to open it
        </span>
        {view && (
          <button className="btn" onClick={() => setView(null)}>
            Reset zoom
          </button>
        )}
      </div>
      <div className="perf-wrap" ref={wrap}>
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h, cursor: drag.current ? "grabbing" : hover ? "pointer" : view ? "grab" : "crosshair" }}
          onMouseMove={onMove}
          onMouseDown={(e) => {
            if (view) drag.current = { y: e.clientY - canvas.current!.getBoundingClientRect().top, view };
          }}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => {
            drag.current = null;
            setHover(null);
          }}
          onDoubleClick={() => setView(null)}
          onClick={() => hover && !drag.current && onOpen(hover.line.symbol)}
          role="img"
          aria-label={`Returns of ${total} assets over the selected window; leaders: ${model.leaders.map((l) => `${l.base} ${fmtPct(l.ret)}`).join(", ")}`}
        />
        {range && (
          <TimeBrush
            width={size.w}
            from={range.from}
            to={range.to}
            t0={t0}
            t1={t1}
            overview={range.overview}
            onChange={(a, b) => setWin({ span: Math.max(b - a, 2 * (model?.barSec ?? H)), end: b >= range.to - (model?.barSec ?? H) ? null : b })}
          />
        )}
        {hover && (
          <div className="perf-tip" style={{ left: Math.min(hover.x + 14, size.w - 180), top: hover.y + 14 }}>
            <b>{hover.line.base}</b>
            <div>
              {fmtBarTime(model.times[hover.idx], model.barSec)}: {fmtPct((Math.exp(hover.line.vals[hover.idx]) - 1) * 100)}
            </div>
            <div className="muted small">Period: {fmtPct(hover.line.ret)}</div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Overview strip of the full history with a draggable window: drag the window to move it, drag an
 * edge to stretch or shrink it. Aligned with the main chart's plot area.
 */
function TimeBrush({
  width,
  from,
  to,
  t0,
  t1,
  overview,
  onChange,
}: {
  width: number;
  from: number;
  to: number;
  t0: number;
  t1: number;
  overview: { t: number; v: number }[];
  onChange: (t0: number, t1: number) => void;
}) {
  const H_PX = 44;
  const w = width - PAD.l - PAD.r;
  const x = (t: number) => ((t - from) / (to - from)) * w;
  const tAt = (px: number) => from + (px / w) * (to - from);
  const dragging = useRef<{ mode: "move" | "l" | "r"; startX: number; t0: number; t1: number } | null>(null);
  const logs = overview.map((p) => Math.log(p.v));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const pts = overview.map((p, i) => `${x(p.t)},${H_PX - 4 - ((logs[i] - lo) / (hi - lo || 1)) * (H_PX - 8)}`).join(" ");

  const onDown = (mode: "move" | "l" | "r") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragging.current = { mode, startX: e.clientX, t0, t1 };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const dt = ((e.clientX - d.startX) / w) * (to - from);
    if (d.mode === "move") {
      const span = d.t1 - d.t0;
      const a = Math.min(Math.max(d.t0 + dt, from), to - span);
      onChange(a, a + span);
    } else if (d.mode === "l") onChange(Math.min(Math.max(d.t0 + dt, from), d.t1 - 1), d.t1);
    else onChange(d.t0, Math.max(Math.min(d.t1 + dt, to), d.t0 + 1));
  };
  const onUp = () => (dragging.current = null);

  return (
    <div className="brush" style={{ marginLeft: PAD.l, width: w }} onPointerMove={onMove} onPointerUp={onUp}>
      <svg width={w} height={H_PX} aria-hidden="true" onPointerDown={(e) => {
        // Click outside the window: jump the window there, keeping its length.
        const r = (e.currentTarget as SVGElement).getBoundingClientRect();
        const c = tAt(e.clientX - r.left);
        const span = t1 - t0;
        const a = Math.min(Math.max(c - span / 2, from), to - span);
        onChange(a, a + span);
      }}>
        <polyline points={pts} className="brush-line" />
      </svg>
      <div className="brush-win" style={{ left: x(t0), width: Math.max(6, x(t1) - x(t0)) }} onPointerDown={onDown("move")}>
        <span className="brush-handle l" onPointerDown={onDown("l")} />
        <span className="brush-handle r" onPointerDown={onDown("r")} />
      </div>
      <div className="brush-labels">
        <span>{fmtBarTime(from, 86_400)}</span>
        <span className="muted">BTC · drag the window to move it, its edges to resize</span>
        <span>{fmtBarTime(to, 86_400)}</span>
      </div>
    </div>
  );
}
