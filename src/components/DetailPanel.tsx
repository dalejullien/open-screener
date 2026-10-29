import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { IChartApi } from "lightweight-charts";
import { getResearch, researchLinks, type Research } from "../data/research";
import { normalizeCoin } from "../data/universe";
import { fmtPct, fmtPrice } from "../lib/format";
import { positionSize } from "../lib/plan";
import { renderShareCard } from "../lib/shareCard";
import { ShareDialog } from "./ShareDialog";
import { FavStar } from "./Favorites";
import { fmtCap } from "../data/marketCaps";
import { usePersisted } from "../lib/usePersisted";
import type { Level, MarketData, Signal } from "../lib/types";
import { PriceChart } from "./PriceChart";
import { ActionBadge, Avatar, MarketTags, STATUS_LABEL, StatusBadge } from "./ui";
import { actionFor } from "../lib/action";

interface Props {
  data: MarketData;
  signal: Signal;
  toolName: string;
  themeKey: string;
  account: number;
  riskPct: number;
  setAccount: (v: number) => void;
  setRiskPct: (v: number) => void;
  detectPrice?: number;
  children?: ReactNode;
}

export function DetailPanel({ data, signal, toolName, themeKey, account, riskPct, setAccount, setRiskPct, detectPrice, children }: Props) {
  const chartRef = useRef<IChartApi | null>(null);
  const [card, setCard] = useState<HTMLCanvasElement | null>(null);
  const [research, setResearch] = useState<Research>({});
  const [logScale, setLogScale] = usePersisted("logScale", false);
  const [chartTf, setChartTf] = useState<"daily" | "h4">(signal.chart.timeframe);
  const [chartFull, setChartFull] = useState(false);
  const onReady = useCallback((c: IChartApi | null) => (chartRef.current = c), []);
  const { asset } = data;
  const candles = chartTf === "daily" ? data.daily : data.h4;
  const lastBar = candles[candles.length - 1];
  const cashtag = `$${asset.assetClass === "crypto" ? normalizeCoin(asset.base) : asset.base}`;
  const currentAction = actionFor(signal, asset.price, detectPrice);

  useEffect(() => {
    let live = true;
    setResearch({});
    getResearch(asset).then((r) => live && setResearch(r));
    return () => {
      live = false;
    };
    // Keyed on identity, not the asset object (which changes with every live price tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.symbol, asset.coingeckoId]);

  useEffect(() => setChartTf(signal.chart.timeframe), [asset.symbol, signal.chart.timeframe]);

  useEffect(() => {
    if (!chartFull) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setChartFull(false);
    document.body.classList.add("chart-full-open");
    window.addEventListener("keydown", close);
    return () => {
      document.body.classList.remove("chart-full-open");
      window.removeEventListener("keydown", close);
    };
  }, [chartFull]);

  const share = () => {
    if (!chartRef.current) return;
    setCard(
      renderShareCard({
        chart: chartRef.current,
        ticker: `${asset.base} / USDT`,
        title: `${toolName} — ${signal.headline}`,
        status: STATUS_LABEL[signal.status],
        price: fmtPrice(asset.price),
        change: fmtPct(asset.change24h),
        metrics: signal.metrics,
      }),
    );
  };

  return (
    <section className="detail">
      <header className="detail-head">
        <FavStar symbol={asset.symbol} big />
        <Avatar base={asset.base} src={asset.logo} />
        <div>
          <div className="ticker">{asset.base}</div>
          <div className="muted sub-line" title={`Chart from ${asset.source === "spot" ? "spot" : "perpetual"}${asset.fdv ? ` · FDV ${fmtCap(asset.fdv)}` : ""}`}>
            {asset.mcap || asset.fdv ? (
              <span>
                MCap <b className="ink">{fmtCap(asset.mcap || asset.fdv)}</b>
                {asset.mcapRank ? ` · #${asset.mcapRank}` : ""}
              </span>
            ) : null}
            <MarketTags markets={asset.markets} />
          </div>
        </div>
        <div className="spacer" />
        <div className="price-block">
          <div className="big-price">{fmtPrice(asset.price)}</div>
          <div className="muted small">
            USDT · <span className={asset.change24h >= 0 ? "good" : "bad"}>{fmtPct(asset.change24h, 2)}</span> 24h · chart through{" "}
            {lastBar ? new Date(lastBar.time * 1000).toISOString().slice(0, 10) : "–"}
          </div>
        </div>
      </header>

      <div className="detail-title">
        <h2>{signal.headline}</h2>
        <div className="detail-actions">
          <StatusBadge status={signal.status} />
          <div className="pills small-pills">
            <button className={!logScale ? "on" : ""} onClick={() => setLogScale(false)}>Linear</button>
            <button className={logScale ? "on" : ""} onClick={() => setLogScale(true)}>Log</button>
          </div>
          <button className="btn" onClick={share} title="Preview the chart card and post it to X">
            ⇪ Share on X
          </button>
        </div>
      </div>

      {currentAction ? (
          <div className={`action-box act-bg-${currentAction.action}`}>
            <ActionBadge action={currentAction.action} big /> <span>{currentAction.text}</span>
          </div>
        ) : null}

      <div className="research">
        <span className="research-label">
          Research{research.name ? ` · ${research.name}${research.rank ? ` #${research.rank}` : ""}` : ""}
        </span>
        {researchLinks(asset, research).map((l) => (
          <a key={l.label} className="rlink" href={l.href} target="_blank" rel="noreferrer" title={l.title}>
            {l.label} ↗
          </a>
        ))}
      </div>

      {card && (
        <ShareDialog
          card={card}
          fileName={`${asset.base}-${signal.chart.timeframe}-${new Date().toISOString().slice(0, 10)}.png`}
          text={`${cashtag} — ${toolName}: ${signal.headline}\n\n${signal.reason}\n\nResearch only, not financial advice.`}
          onClose={() => setCard(null)}
        />
      )}

      <div className={`chart-shell ${chartFull ? "full" : ""}`}>
        <div className="chart-toolbar">
          <div className="pills small-pills" aria-label="Chart timeframe">
            <button className={chartTf === "daily" ? "on" : ""} onClick={() => setChartTf("daily")}>{data.tf.label}</button>
            <button className={chartTf === "h4" ? "on" : ""} onClick={() => setChartTf("h4")}>{data.tf.lowerLabel}</button>
          </div>
          <span className="muted small">Completed candles · volume</span>
          {chartTf !== signal.chart.timeframe && <span className="muted small">Strategy drawings are on {signal.chart.timeframe === "daily" ? data.tf.label : data.tf.lowerLabel}</span>}
          <span className="spacer" />
          <button className="btn chart-expand" onClick={() => setChartFull((v) => !v)} title={chartFull ? "Exit full screen (Esc)" : "Expand chart"}>
            {chartFull ? "✕ Close" : "⛶ Full screen"}
          </button>
        </div>
        <PriceChart
          candles={candles}
          overlays={chartTf === signal.chart.timeframe ? signal.chart.overlays : []}
          levels={signal.levels}
          markers={chartTf === signal.chart.timeframe ? signal.chart.markers : undefined}
          projections={chartTf === signal.chart.timeframe ? signal.chart.projections : undefined}
          visibleBars={chartTf === signal.chart.timeframe ? signal.chart.visibleBars : undefined}
          logScale={logScale}
          themeKey={`${themeKey}-${chartTf}-${chartFull}`}
          onReady={onReady}
        />
      </div>
      <div className="legend">
        <span>
          <i className="sw ink" /> Completed {(chartTf === "daily" ? data.tf.label : data.tf.lowerLabel).toLowerCase()} candles
        </span>
        {chartTf === signal.chart.timeframe && signal.chart.overlays.map((o, i) => (
          <span key={o.label}>
            <i className={`sw ${o.color ? `c-${o.color}` : `s${(i % 3) + 1}`}${o.style === "dashed" ? " dash" : ""}`} /> {o.label}
          </span>
        ))}
        {chartTf === signal.chart.timeframe && signal.chart.projections?.map((p, i) => (
          <span key={p.label}>
            <i className={`sw ${p.main ? "c-good" : `s${(i % 3) + 1} dash`}`} /> {p.label}
          </span>
        ))}
        {signal.levels.length > 0 && (
          <span>
            <i className="sw lvl" /> Levels
          </span>
        )}
      </div>

      <div className="stats">
        {signal.metrics.map((m) => (
          <div key={m.label}>
            <div className="stat-label">{m.label}</div>
            <div className="stat-value">{m.value}</div>
          </div>
        ))}
      </div>

      <p className="reason">{signal.reason}</p>
      {signal.checklist && (
        <div className="checklist">
          {signal.checklist.map((c) => (
            <div key={c.label} className={c.ok ? "ok" : "no"}>
              <span className="ck">{c.ok ? "✓" : "✕"}</span>
              <span>{c.label}</span>
              {c.detail && <span className="muted small">{c.detail}</span>}
            </div>
          ))}
        </div>
      )}
      {children}
      <TradePlan levels={signal.levels} action={currentAction?.action} account={account} riskPct={riskPct} setAccount={setAccount} setRiskPct={setRiskPct} />
    </section>
  );
}

function TradePlan({ levels, action, account, riskPct, setAccount, setRiskPct }: { levels: Level[]; action?: string; account: number; riskPct: number; setAccount: (v: number) => void; setRiskPct: (v: number) => void }) {
  const entry = levels.find((l) => l.kind === "entry");
  const stop = levels.find((l) => l.kind === "stop");
  const targets = levels.filter((l) => l.kind === "target");
  const size = entry && stop ? positionSize(account, riskPct, entry.price, stop.price) : null;

  return (
    <div className="plan">
      <div className="plan-head">
        <h3>{action === "extended" ? "Original risk model · setup is extended" : "Example risk model"}</h3>
        <label>
          Account <input type="number" value={account} min={0} onChange={(e) => setAccount(+e.target.value)} /> USDT
        </label>
        <label>
          Risk <input type="number" value={riskPct} step={0.25} min={0.1} max={5} onChange={(e) => setRiskPct(+e.target.value)} />%
        </label>
      </div>
      {entry && stop ? (
        <div className="plan-grid">
          <div><span>Trigger level</span><b>{fmtPrice(entry.price)}</b></div>
          <div><span>Invalidation</span><b className="bad">{fmtPrice(stop.price)} ({fmtPct((stop.price / entry.price - 1) * 100)})</b></div>
          {targets.map((t) => (
            <div key={t.label}><span>{t.label}</span><b className="good">{fmtPrice(t.price)} ({fmtPct((t.price / entry.price - 1) * 100)})</b></div>
          ))}
          {size && (
            <>
              <div><span>Example size</span><b>{size.units.toPrecision(4)} units · ${size.notional.toFixed(0)}</b></div>
              <div><span>At risk</span><b>${size.riskAmount.toFixed(0)} ({riskPct}%){size.pctOfAccount > 100 ? " — exceeds account, reduce" : ""}</b></div>
            </>
          )}
        </div>
      ) : (
        <p className="muted small">No long setup on this tool yet — levels appear once the setup passes.</p>
      )}
          <p className="muted small">
            {action === "extended" ? "Current state: extended. These are the original research levels, not a live recommendation. " : ""}
            Mechanical levels from the strategy rules (invalidation = ATR-based, targets 1.5R / 3R). Research only. Not financial advice.
          </p>
    </div>
  );
}
