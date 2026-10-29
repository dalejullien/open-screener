import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Level, Marker, Overlay, Projection } from "../lib/types";
import { readTheme } from "../lib/chartTheme";

const LEVEL_STYLE = {
  entry: { key: "ink2", style: LineStyle.Dashed },
  stop: { key: "bad", style: LineStyle.Solid },
  target: { key: "good", style: LineStyle.Dashed },
  level: { key: "ink2", style: LineStyle.Dotted },
} as const;

interface Props {
  candles: Candle[];
  overlays: Overlay[];
  levels: Level[];
  markers?: Marker[];
  projections?: Projection[];
  visibleBars?: number;
  logScale?: boolean;
  themeKey: string; // changes when light/dark flips, so the chart redraws with new colors
  onReady?: (chart: IChartApi | null) => void;
}

/** Candlestick chart of completed bars with volume, strategy overlays, levels and markers. */
export function PriceChart({ candles, overlays, levels, markers, projections, visibleBars, logScale, themeKey, onReady }: Props) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || !candles.length) return;
    const t = readTheme();
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: t.surface }, textColor: t.ink2, fontFamily: "inherit", attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
      rightPriceScale: { borderVisible: false, mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderVisible: false },
      crosshair: { horzLine: { labelBackgroundColor: t.ink2 }, vertLine: { labelBackgroundColor: t.ink2 } },
    });
    const time = (c: Candle) => c.time as UTCTimestamp;
    // Enough decimals for sub-cent coins (0.06977 → 5 dp), 2 dp for large prices.
    const lastClose = candles[candles.length - 1].close;
    const precision = lastClose >= 100 ? 2 : Math.min(8, Math.max(2, 3 - Math.floor(Math.log10(lastClose))));
    const priceFormat = { type: "price" as const, precision, minMove: 10 ** -precision };

    const price = chart.addSeries(CandlestickSeries, {
      priceFormat,
      upColor: t.good,
      downColor: t.bad,
      borderUpColor: t.good,
      borderDownColor: t.bad,
      wickUpColor: t.good,
      wickDownColor: t.bad,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    price.setData(candles.map((c) => ({ time: time(c), open: c.open, high: c.high, low: c.low, close: c.close })));

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(candles.map((c) => ({
      time: time(c),
      value: c.volume,
      color: c.close >= c.open ? `${t.good}66` : `${t.bad}66`,
    })));

    const named = { good: t.good, bad: t.bad, s1: t.series[0], s2: t.series[1], ink2: t.ink2 };
    overlays.forEach((o, i) => {
      const dashed = o.style ? o.style === "dashed" : o.label.toLowerCase().includes("band") || o.label.includes("high");
      const s = chart.addSeries(LineSeries, {
        priceFormat,
        color: o.color ? named[o.color] : t.series[i % t.series.length],
        lineWidth: 2,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: "",
      });
      s.setData(
        candles.flatMap((c, j) => (o.values[j] == null ? [] : [{ time: time(c), value: o.values[j] as number }])),
      );
    });

    projections?.forEach((pr, i) => {
      const s = chart.addSeries(LineSeries, {
        priceFormat,
        color: pr.main ? t.good : t.series[i % t.series.length],
        lineWidth: pr.main ? 3 : 1,
        lineStyle: pr.main ? LineStyle.Solid : LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: !!pr.main,
        crosshairMarkerVisible: false,
      });
      s.setData(pr.points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    });

    for (const l of levels) {
      if (!isFinite(l.price)) continue;
      const st = LEVEL_STYLE[l.kind];
      price.createPriceLine({ price: l.price, color: t[st.key], lineStyle: st.style, lineWidth: 1, axisLabelVisible: true, title: l.label });
    }

    if (markers?.length) {
      createSeriesMarkers(
        price,
        markers.map((m) =>
          m.position
            ? { time: m.time as UTCTimestamp, position: m.position === "above" ? ("aboveBar" as const) : ("belowBar" as const), shape: "circle" as const, color: t.series[0], text: m.text, size: 0.6 }
            : { time: m.time as UTCTimestamp, position: "aboveBar" as const, shape: "arrowDown" as const, color: t.good, text: m.text },
        ),
      );
    }

    // Show roughly the last 6 months (or 30 days of 4h bars); scroll/zoom to see more.
    const future = projections?.length ? Math.max(...projections.map((p) => p.points.filter((x) => x.time > candles[candles.length - 1].time).length)) : 0;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - (visibleBars ?? 180)), to: candles.length + future + 2 });
    onReady?.(chart);
    return () => {
      onReady?.(null);
      chart.remove();
    };
  }, [candles, overlays, levels, markers, projections, visibleBars, logScale, themeKey, onReady]);

  return <div ref={el} className="chart" />;
}
