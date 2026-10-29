import type { ForwardRecord } from "../lib/useForwardJournal";
import { fmtDate, fmtPct, fmtPrice } from "../lib/format";

function csv(records: ForwardRecord[]) {
  const cols: (keyof ForwardRecord)[] = ["detectedAt", "rank", "symbol", "toolName", "action", "btcRegime", "liquidity", "entry", "stop", "target", "initialPrice", "latestPrice", "mfePct", "maePct", "outcome", "resultR"];
  const rows = [cols.join(","), ...records.map((r) => cols.map((k) => JSON.stringify(r[k] ?? "")).join(","))];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = `open-screener-forward-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ForwardJournalView({ records }: { records: ForwardRecord[] }) {
  const closed = records.filter((r) => r.outcome !== "open");
  const wins = closed.filter((r) => (r.resultR ?? 0) > 0);
  const avgR = closed.length ? closed.reduce((s, r) => s + (r.resultR ?? 0), 0) / closed.length : 0;
  return (
    <div className="page-body wide">
      <div className="kpis">
        <div className="kpi"><span>Recorded</span><b>{records.length}</b><small>first-seen ideas</small></div>
        <div className="kpi"><span>Resolved</span><b>{closed.length}</b><small>{closed.length ? `${Math.round(wins.length / closed.length * 100)}% positive` : "collecting"}</small></div>
        <div className="kpi"><span>Average result</span><b className={avgR >= 0 ? "good" : "bad"}>{avgR >= 0 ? "+" : ""}{avgR.toFixed(2)}R</b><small>resolved signals</small></div>
        <button className="btn" onClick={() => csv(records)} disabled={!records.length}>⇪ Export CSV</button>
      </div>
      <p className="muted small">Append-only evidence from this browser. A signal keeps its original rank, action, regime, liquidity group and levels. Stop-first is assumed when a completed candle touches both stop and target.</p>
      <table className="bt-table trades">
        <thead><tr><th>Date</th><th>Rank</th><th>Coin</th><th>Strategy</th><th>Action</th><th>BTC</th><th>Liquidity</th><th>Entry</th><th>Stop</th><th>MFE</th><th>MAE</th><th>Outcome</th><th>R</th></tr></thead>
        <tbody>{records.slice(0, 250).map((r) => (
          <tr key={r.id}>
            <td>{fmtDate(r.detectedAt)}</td><td>{r.rank || "–"}</td><td>{r.symbol.replace(/USDT$/, "")}</td><td>{r.toolName}</td><td>{r.action}</td><td>{r.btcRegime}</td><td>{r.liquidity}</td><td>{fmtPrice(r.entry)}</td><td>{fmtPrice(r.stop)}</td><td className="good">{fmtPct(r.mfePct)}</td><td className="bad">{fmtPct(r.maePct)}</td><td>{r.outcome}</td><td>{r.resultR === undefined ? "–" : `${r.resultR >= 0 ? "+" : ""}${r.resultR.toFixed(2)}R`}</td>
          </tr>
        ))}</tbody>
      </table>
      {!records.length && <p className="empty">The first completed scan will create the journal. Leave Open Screener running through future bar closes to build an unbiased record.</p>}
    </div>
  );
}
