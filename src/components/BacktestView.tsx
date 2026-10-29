import { Fragment, useState } from "react";
import { SCANNERS } from "../scanners";
import { InsightsPanel } from "./InsightsPanel";
import type { BacktestResult, Stats } from "../lib/backtest";
import type { BacktestProgress } from "../lib/useBacktest";
import { fmtDate, fmtPrice } from "../lib/format";

const GATE_LABEL: Record<string, string> = {
  gate_trend: "Trend (close > EMA50 > rising SMA200)",
  gate_liquidity: "Liquidity ≥ minimum",
  gate_stop: "Tight stop (≤ 1 ATR / 0.6 ADR / cap)",
  gate_room: "≥ 3R room to resistance",
  gate_regime: "Market regime (benchmark > EMA50)",
  gate_score: "Score ≥ S threshold",
};

/** Why graded setups did or didn't reach the top tier: share of fresh triggers failing each gate. */
function GateBreakdown({ name, gates }: { name: string; gates: NonNullable<BacktestResult["gates"]> }) {
  const rows = Object.keys(GATE_LABEL)
    .map((k) => ({ k, n: gates.fails[k] ?? 0 }))
    .sort((a, b) => b.n - a.n);
  return (
    <div className="gates">
      <h3>
        Why {name} triggers did or didn't reach S-tier
      </h3>
      <p className="muted small">
        Over the backtest, {gates.total} setups triggered. S-tier needs every rule below to pass: {gates.allPass} did (
        {((gates.allPass / gates.total) * 100).toFixed(0)}%). Each bar shows how often one rule blocked a setup; a setup can fail several.
      </p>
      {rows.map(({ k, n }) => (
        <div key={k} className="gate-row">
          <span>{GATE_LABEL[k]}</span>
          <div className="gate-bar">
            <div style={{ width: `${(n / gates.total) * 100}%` }} />
          </div>
          <span className="muted small">
            failed {n} · {((n / gates.total) * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

const fmtR = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
const pf = (v: number) => (isFinite(v) ? v.toFixed(2) : "∞");

/** One-line summary for a tool page header. */
export function BacktestLine({ result, onOpen }: { result?: BacktestResult; onOpen: () => void }) {
  if (!result) {
    return (
      <button className="bt-line muted" onClick={onOpen}>
        Backtest: not run yet — open Backtests ›
      </button>
    );
  }
  const s = result.stats;
  return (
    <button className="bt-line" onClick={onOpen} title="Open the backtest details">
      <b>Backtest</b> {result.days}d · {result.coins} coins: {s.trades} trades · {s.winRate.toFixed(0)}% win ·{" "}
      <span className={s.avgR >= 0 ? "good" : "bad"}>{fmtR(s.avgR)} avg</span> · PF {pf(s.profitFactor)} · max DD −{s.maxDrawdownR.toFixed(1)}R ›
    </button>
  );
}

function Equity({ stats }: { stats: Stats }) {
  const pts = stats.equity;
  if (pts.length < 2) return <span className="muted small">–</span>;
  const W = 220;
  const H = 44;
  const ys = pts.map((p) => p.r);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  return (
    <svg className="equity" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Equity curve ending at ${fmtR(stats.totalR)}`}>
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="eq-zero" />
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.r)}`).join(" ")} className={stats.totalR >= 0 ? "eq-up" : "eq-down"} />
    </svg>
  );
}

function RowCells({ name, s }: { name: string; s: Stats }) {
  return (
    <>
      <td>{name}</td>
      <td>{s.trades}</td>
      <td>{s.winRate.toFixed(0)}%</td>
      <td className="good">{(s.targetRate ?? 0).toFixed(0)}%</td>
      <td className="bad">{(s.stopRate ?? 0).toFixed(0)}%</td>
      <td className="muted">{(s.timeRate ?? 0).toFixed(0)}%</td>
      <td className={s.avgR >= 0 ? "good" : "bad"}>{fmtR(s.avgR)}</td>
      <td>{pf(s.profitFactor)}</td>
      <td>−{s.maxDrawdownR.toFixed(1)}R</td>
      <td>{s.avgBars.toFixed(1)}d</td>
      <td className={s.totalR >= 0 ? "good" : "bad"}>{fmtR(s.totalR)}</td>
      <td>
        <Equity stats={s} />
      </td>
    </>
  );
}

interface Props {
  results: Record<string, BacktestResult>;
  progress: BacktestProgress;
  onRun: (coins: number, days: number) => void;
  universeLabel: string;
}

export function BacktestView({ results, progress, onRun, universeLabel }: Props) {
  const [coins, setCoins] = useState(100);
  const [days, setDays] = useState(240);
  const [show, setShow] = useState(SCANNERS[0].id);
  const busy = progress.phase === "download" || progress.phase === "run";
  const sel = results[show];

  return (
    <div className="page-body wide">
      <div className="bt-controls">
        <label>
          Coins
          <select value={coins} onChange={(e) => setCoins(+e.target.value)}>
            {[50, 100, 200].map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={days} onChange={(e) => setDays(+e.target.value)}>
            {[120, 240, 365].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" disabled={busy} onClick={() => onRun(coins, days)}>
          {busy ? "Running…" : "Run backtest"}
        </button>
        <span className="muted small">
          {busy ? `${progress.label} ${progress.done}/${progress.total}` : progress.phase === "done" ? progress.label : progress.error ?? `Universe: ${universeLabel}, daily timeframe`}
        </span>
      </div>
      {busy && (
        <div className="progress static">
          <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </div>
      )}

      <h3>Which strategy performs best</h3>
      <p className="muted small">
        Ranked by average result per trade (R = multiples of the amount risked; +1R = won what you risked). <b>Hit target</b> = trades that reached
        the first target, <b>Stopped</b> = hit the stop, <b>Timed out</b> = neither within 20 days (closed at market). Click a row for details.
      </p>
      <table className="bt-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Strategy</th>
            <th>Trades</th>
            <th>Win rate</th>
            <th>Hit target</th>
            <th>Stopped</th>
            <th>Timed out</th>
            <th>Avg R</th>
            <th>Profit factor</th>
            <th>Max drawdown</th>
            <th>Avg hold</th>
            <th>Total</th>
            <th>Equity (R)</th>
          </tr>
        </thead>
        <tbody>
          {[...SCANNERS]
            .sort((a, b) => (results[b.id]?.stats.avgR ?? -99) - (results[a.id]?.stats.avgR ?? -99))
            .map((s, i) => {
              const r = results[s.id];
              return r ? (
                <Fragment key={s.id}>
                  <tr className={`click ${show === s.id ? "sel" : ""}`} onClick={() => setShow(s.id)}>
                    <td className="rank">{i === 0 && r.stats.avgR > 0 ? "🏆" : i + 1}</td>
                    <RowCells name={`${s.icon} ${s.name}`} s={r.stats} />
                  </tr>
                  {r.byTier &&
                    Object.entries(r.byTier).map(([tier, st]) => (
                      <tr key={`${s.id}-${tier}`} className="sub">
                        <td />
                        <RowCells name={`${tier}-tier`} s={st} />
                      </tr>
                    ))}
                </Fragment>
              ) : (
                <tr key={s.id}>
                  <td />
                  <td>
                    {s.icon} {s.name}
                  </td>
                  <td colSpan={11} className="muted">
                    Not run yet
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {(() => {
        const tool = SCANNERS.find((x) => x.id === show) ?? SCANNERS[0];
        const g = results[tool.id]?.gates;
        return (
          <section className="bt-detail">
            <h3>
              {tool.icon} {tool.name}: what this backtest searched for
            </h3>
            <p className="muted">{tool.tagline}</p>
            <pre>{tool.methodology}</pre>
            {g && <GateBreakdown name={tool.name} gates={g} />}
          </section>
        );
      })()}

      <InsightsPanel results={results} />

      <h3>Recent trades</h3>
      <div className="pills">
        {SCANNERS.map((s) => (
          <button key={s.id} className={show === s.id ? "on" : ""} onClick={() => setShow(s.id)}>
            {s.name}
          </button>
        ))}
      </div>
      {sel ? (
        <table className="bt-table trades">
          <thead>
            <tr>
              <th>Coin</th>
              <th>Tier</th>
              <th>Entry</th>
              <th>Entry price</th>
              <th>Stop</th>
              <th>Target</th>
              <th>Exit</th>
              <th>Outcome</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {sel.trades.slice(0, 60).map((t) => (
              <tr key={`${t.symbol}-${t.entryTime}`}>
                <td>{t.symbol.replace(/USDT$/, "")}</td>
                <td>{t.tier ?? "–"}</td>
                <td>{fmtDate(t.entryTime)}</td>
                <td>{fmtPrice(t.entry)}</td>
                <td>{fmtPrice(t.stop)}</td>
                <td>{fmtPrice(t.target)}</td>
                <td>{fmtDate(t.exitTime)}</td>
                <td>{t.outcome}</td>
                <td className={t.r >= 0 ? "good" : "bad"}>{fmtR(t.r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Run a backtest to see trades.</p>
      )}

      <section className="method">
        <h3>How the backtest works</h3>
        <pre>{`Each strategy is replayed one daily close at a time over the chosen period, using exactly the
code that runs live and only data available at that close (no look-ahead).
Entry: a fresh trigger (S-Tier: any triggered setup, graded by tier) fills at the NEXT day's open.
Exit: the strategy's own stop or first target; if a day touches both, the stop is assumed first.
Otherwise exit at the close after 20 days. Fees: 0.1% per side. One open trade per coin per tool.
R = (exit − entry − fees) / (entry − stop). Results in R are independent of position size.

Limits: today's top coins by volume (survivorship bias — delisted coins are missing), daily bars
only (intraday stop/target order is unknown, hence the conservative rule), no slippage beyond fees.
Past results do not guarantee future results.`}</pre>
      </section>
    </div>
  );
}
