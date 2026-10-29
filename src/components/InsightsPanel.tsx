import { useMemo, useState } from "react";
import { SCANNERS } from "../scanners";
import type { BacktestResult } from "../lib/backtest";
import { analyze, MIN_N, type BucketResult, type Group, type TradeWithConf } from "../lib/insights";

const pct = (v: number) => `${v.toFixed(0)}%`;
const r = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
const delta = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)} pts`;

function Finding({ b, good }: { b: BucketResult; good: boolean }) {
  return (
    <li>
      <b>{b.label}</b> ({b.factor.name.toLowerCase()}): wins <b className={good ? "good" : "bad"}>{pct(b.winRate)}</b> ({delta(b.dWin)}), avg{" "}
      <span className={b.avgR >= 0 ? "good" : "bad"}>{r(b.avgR)}</span> · {b.n} trades
    </li>
  );
}

const line = (g: Group) => `${g.n} trades · ${pct(g.winRate)} win · ${r(g.avgR)} avg`;

/** What separates winning trades from losing ones, across all tools or one tool. */
export function InsightsPanel({ results }: { results: Record<string, BacktestResult> }) {
  const [scope, setScope] = useState("all");

  const trades = useMemo(() => {
    const out: TradeWithConf[] = [];
    for (const s of SCANNERS) for (const t of results[s.id]?.trades ?? []) out.push({ ...t, conf: 0, tool: s.id });
    // Confluence: other tools with a trade on the same coin within a day of this signal.
    const bySym = new Map<string, TradeWithConf[]>();
    for (const t of out) bySym.set(t.symbol, [...(bySym.get(t.symbol) ?? []), t]);
    for (const t of out) {
      const others = new Set((bySym.get(t.symbol) ?? []).filter((o) => o.tool !== t.tool && Math.abs(o.signalTime - t.signalTime) <= 86_400).map((o) => o.tool));
      t.conf = others.size;
    }
    return out;
  }, [results]);

  const scoped = scope === "all" ? trades : trades.filter((t) => t.tool === scope);
  const ins = useMemo(() => analyze(scoped), [scoped]);
  const withF = scoped.filter((t) => t.f).length;

  if (!withF) {
    return (
      <section className="insights">
        <h3>Patterns: what separates winners from losers</h3>
        <p className="muted">Run a backtest to analyse it. (Backtests from before this version have no entry conditions recorded.)</p>
      </section>
    );
  }

  return (
    <section className="insights">
      <div className="ins-head">
        <h3>Patterns: what separates winners from losers</h3>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All strategies combined</option>
          {SCANNERS.filter((s) => results[s.id]).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Baseline: <b>{line(ins.all)}</b>. Each trade's conditions were recorded at the moment it signalled. A pattern is listed only if it has at least{" "}
        {MIN_N} trades <b>and</b> points the same way in both the earlier and the later half of the period (so it's less likely to be luck).
      </p>

      <div className="ins-cards">
        <div className="ins-card good-card">
          <h4>✓ Trade more when</h4>
          {ins.best.length ? <ul>{ins.best.map((b) => <Finding key={b.factor.key + b.label} b={b} good />)}</ul> : <p className="muted small">No reliable edge found.</p>}
        </div>
        <div className="ins-card bad-card">
          <h4>✕ Avoid when</h4>
          {ins.worst.length ? <ul>{ins.worst.map((b) => <Finding key={b.factor.key + b.label} b={b} good={false} />)}</ul> : <p className="muted small">No reliable weak spot found.</p>}
        </div>
      </div>

      {ins.combo && (
        <div className="ins-rule">
          <b>Test the rule:</b> {ins.combo.rule}.
          <div>
            All trades: {line(ins.all)} → with the rule: <b>{line(ins.combo.kept)}</b> ({ins.combo.skipped} trades skipped)
          </div>
          <div className="muted small">
            Check it held over time: earlier half {line(ins.combo.early)} · later half {line(ins.combo.late)}
          </div>
        </div>
      )}

      <details className="ins-all">
        <summary>All conditions, ranked by how much they change the win rate</summary>
        <div className="ins-grid">
          {ins.factors.map(({ factor, buckets }) => (
            <table key={factor.key} className="bt-table ins-table">
              <thead>
                <tr>
                  <th>{factor.name}</th>
                  <th>Trades</th>
                  <th>Win</th>
                  <th>Avg R</th>
                  <th title="Same direction in both halves of the period">Holds</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.label} className={b.n < MIN_N ? "thin" : ""}>
                    <td>{b.label}</td>
                    <td>{b.n}</td>
                    <td className={b.n >= MIN_N ? (b.dWin >= 4 ? "good" : b.dWin <= -4 ? "bad" : "") : ""}>{b.n ? pct(b.winRate) : "–"}</td>
                    <td className={b.avgR >= 0 ? "good" : "bad"}>{b.n ? r(b.avgR) : "–"}</td>
                    <td>{b.n >= MIN_N ? (b.consistent ? "✓" : "–") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </details>
    </section>
  );
}
