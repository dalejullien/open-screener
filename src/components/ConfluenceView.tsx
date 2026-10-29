import { useMemo, useState, type ReactNode } from "react";
import { SCANNERS, type ConfluenceRow } from "../scanners";
import { fmtPct } from "../lib/format";
import type { MarketData, Signal } from "../lib/types";
import { FavStar } from "./Favorites";
import { Avatar, Kpi, MarketTags, StatusBadge } from "./ui";

interface Props {
  rows: ConfluenceRow[];
  results: Map<string, Signal[]>;
  bySymbol: Map<string, MarketData>;
  selected: string | null;
  setSelected: (s: string) => void;
  universeControl: ReactNode;
  renderDetail: (data: MarketData, signal: Signal, extra: ReactNode) => ReactNode;
}

export function ConfluenceView({ rows, results, bySymbol, selected, setSelected, universeControl, renderDetail }: Props) {
  const [min, setMin] = useState(2);
  const shown = useMemo(() => rows.filter((r) => r.hits.length >= min), [rows, min]);
  const current = shown.find((r) => r.symbol === selected) ?? shown[0];
  const data = current && bySymbol.get(current.symbol);

  // The detail chart uses the strongest firing tool's view, falling back to Trend.
  const lead = current && (current.hits.find((h) => h.signal.status === "trigger") ?? current.hits[0]);
  const leadSignal = lead?.signal ?? (current && results.get("trend")?.find((s) => s.symbol === current.symbol));

  const breakdown = current && (
    <div className="breakdown">
      <h3>What each strategy says</h3>
      {SCANNERS.map((s) => {
        const sig = results.get(s.id)?.find((x) => x.symbol === current.symbol);
        return (
          <div key={s.id} className="bd-row">
            <span className="bd-name">
              {s.icon} {s.name}
            </span>
            {sig ? <StatusBadge status={sig.status} /> : <span className="muted">–</span>}
            <span className="muted small">{sig?.headline}</span>
          </div>
        );
      })}
      <p className="muted small">Equal weights for now. Phase 2 weights each strategy by its backtested results.</p>
    </div>
  );

  return (
    <>
      <div className="kpis">
        <Kpi label="Universe" sub="Assets scanned" value={rows.length} />
        <Kpi label={`${SCANNERS.length} of ${SCANNERS.length} agree`} sub="Every strategy fires" value={rows.filter((r) => r.hits.length === SCANNERS.length).length} tone="good" />
        <Kpi label="3+ agree" sub="Strong confluence" value={rows.filter((r) => r.hits.length >= 3).length} tone="good" />
        <Kpi label="2+ agree" sub="Worth a look" value={rows.filter((r) => r.hits.length >= 2).length} tone="warn" />
      </div>
      <div className="filters">
        {universeControl}
        <label>
          Min strategies agreeing
          <select value={min} onChange={(e) => setMin(+e.target.value)}>
            {SCANNERS.map((_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">Score: trigger = 2, pass = 1 per strategy</span>
      </div>
      <div className="master-detail">
        <aside className="list">
          <div className="list-head">
            <span>Confluence</span>
            <span>Score</span>
          </div>
          <div className="list-body">
            {shown.map((r) => {
              const d = bySymbol.get(r.symbol);
              return (
                <button key={r.symbol} className={`row ${current?.symbol === r.symbol ? "sel" : ""}`} onClick={() => setSelected(r.symbol)}>
                  <div className="row-top">
                    <FavStar symbol={r.symbol} />
                    <Avatar base={d?.asset.base ?? r.symbol} src={d?.asset.logo} />
                    <b>{d?.asset.base ?? r.symbol}</b>
                    {d && <MarketTags markets={d.asset.markets} />}
                    <span className="score">{r.score}</span>
                  </div>
                  <div className="chips">
                    {r.hits.map((h) => (
                      <span key={h.scanner.id} className={`chip ${h.signal.status}`}>
                        {h.signal.status === "trigger" ? "⚡" : "✓"} {h.scanner.name}
                      </span>
                    ))}
                  </div>
                  {d && <div className={`small ${d.asset.change24h >= 0 ? "good" : "bad"}`}>{fmtPct(d.asset.change24h)} 24h</div>}
                </button>
              );
            })}
            {!shown.length && <p className="empty">No coin has {min}+ strategies agreeing right now.</p>}
          </div>
          <div className="list-foot">
            <span>{shown.length} coins</span>
            <span>{SCANNERS.length} strategies</span>
          </div>
        </aside>
        {current && data && leadSignal ? renderDetail(data, leadSignal, breakdown) : <section className="detail empty">Nothing to show</section>}
      </div>
    </>
  );
}
