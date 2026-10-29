import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fmtDate, fmtPct } from "../lib/format";
import type { History } from "../lib/replay";
import { fmtCap } from "../data/marketCaps";
import type { MarketData, Params, Scanner, Signal, Status } from "../lib/types";
import { ActionBadge, Avatar, Pills, StateLine } from "./ui";
import { FavStar } from "./Favorites";
import { actionFor } from "../lib/action";

const RANK: Record<Status, number> = { trigger: 0, pass: 1, near: 2, fail: 3 };
type Show = "hits" | "enter" | "new" | "near" | "all";

interface Props {
  scanner: Scanner;
  signals: Signal[];
  bySymbol: Map<string, MarketData>;
  params: Params;
  setParams: (p: Params) => void;
  selected: string | null;
  setSelected: (s: string) => void;
  universeControl: ReactNode;
  renderDetail: (data: MarketData, signal: Signal) => ReactNode;
  history?: Map<string, History>;
  backtestLine?: ReactNode;
}

export function ToolView({ scanner, signals, bySymbol, params, setParams, selected, setSelected, universeControl, renderDetail, history, backtestLine }: Props) {
  const [show, setShow] = useState<Show>("hits");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  // Tools that label their signals (e.g. pattern type) get a type filter with counts.
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of signals) if (s.meta?.group && s.status !== "fail") m.set(String(s.meta.group), (m.get(String(s.meta.group)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [signals]);

  const counts = useMemo(() => {
    const c = { trigger: 0, pass: 0, near: 0, fail: 0 };
    signals.forEach((s) => c[s.status]++);
    return c;
  }, [signals]);

  const rows = useMemo(
    () =>
      signals
        .filter((s) => {
          const hit = s.status === "trigger" || s.status === "pass";
          if (show === "all") return true;
          if (show === "hits") return hit;
          if (show === "new") return hit && (history?.get(s.symbol)?.days ?? 99) <= 1;
          if (show === "enter") {
            const price = bySymbol.get(s.symbol)?.asset.price;
            return price !== undefined && actionFor(s, price, history?.get(s.symbol)?.priceAtDetect)?.action === "enter";
          }
          return s.status === show;
        })
        .filter((s) => !q || s.symbol.includes(q.toUpperCase()))
        .filter((s) => group === "all" || s.meta?.group === group)
        .sort((a, b) =>
          scanner.id === "ideas"
            ? Number(a.meta?.ideaRank ?? 9999) - Number(b.meta?.ideaRank ?? 9999)
            : RANK[a.status] - RANK[b.status] || b.score - a.score,
        ),
    [signals, show, q, history, bySymbol, group, scanner.id],
  );

  const current = rows.find((r) => r.symbol === selected) ?? rows[0];
  const currentIndex = current ? rows.findIndex((r) => r.symbol === current.symbol) : -1;
  const currentData = current && bySymbol.get(current.symbol);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const live = useMemo(() => {
    let enter = 0;
    let fresh = 0;
    for (const s of signals) {
      const d = bySymbol.get(s.symbol);
      if (d && actionFor(s, d.asset.price, history?.get(s.symbol)?.priceAtDetect)?.action === "enter") enter++;
      if ((s.status === "trigger" || s.status === "pass") && (history?.get(s.symbol)?.days ?? 99) <= 1) fresh++;
    }
    return { enter, fresh };
  }, [signals, bySymbol, history]);

  const move = (delta: number) => {
    if (!rows.length) return;
    const next = Math.max(0, Math.min(rows.length - 1, (currentIndex < 0 ? 0 : currentIndex) + delta));
    setSelected(rows[next].symbol);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "j") { e.preventDefault(); move(1); }
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") { e.preventDefault(); move(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="toolbar">
        {universeControl}
        <span className="spacer" />
        <input className="search" placeholder="Find a coin" value={q} onChange={(e) => setQ(e.target.value)} />
        {scanner.params.length > 0 && (
          <button className={`btn ${settingsOpen ? "on" : ""}`} onClick={() => setSettingsOpen((o) => !o)} title="Strategy settings">
            ⚙ Settings
          </button>
        )}
      </div>

      <div className="toolbar sub">
        <Pills<Show>
          value={show}
          onChange={setShow}
          options={[
            { value: "hits", label: `Setups ${counts.trigger + counts.pass}` },
            { value: "enter", label: `Triggered ${live.enter}` },
            { value: "new", label: `New ${history ? live.fresh : "…"}` },
            { value: "near", label: `Almost ${counts.near}` },
            { value: "all", label: `All ${signals.length}` },
          ]}
        />
        {groups.length > 0 && (
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">All pattern types</option>
            {groups.map(([g, n]) => (
              <option key={g} value={g}>
                {g} ({n})
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        {backtestLine}
      </div>

      {settingsOpen && (
        <div className="settings">
          {scanner.params.map((d) => (
            <label key={d.key}>
              {d.label}
              <input
                type="number"
                value={params[d.key]}
                step={d.step ?? 1}
                min={d.min}
                max={d.max}
                onChange={(e) => e.target.value !== "" && setParams({ ...params, [d.key]: +e.target.value })}
              />
              {d.suffix}
            </label>
          ))}
          <span className="muted small">Score = rank within this tool, not a win probability. Full rules on the Methodology page.</span>
        </div>
      )}

      <div className="master-detail">
        <aside className="list">
          <div className="list-body">
            {rows.map((s, rowIndex) => {
              const d = bySymbol.get(s.symbol);
              const a = d && actionFor(s, d.asset.price, history?.get(s.symbol)?.priceAtDetect);
              const h = history?.get(s.symbol);
              const since = h && h.days >= 0 && d ? (d.asset.price / h.priceAtDetect - 1) * 100 : NaN;
              return (
                <button key={s.symbol} className={`row ${current?.symbol === s.symbol ? "sel" : ""}`} onClick={() => setSelected(s.symbol)}>
                  <div className="row-top">
                    {scanner.id === "ideas" && <span className="idea-rank">#{rowIndex + 1}</span>}
                    <FavStar symbol={s.symbol} />
                    <Avatar base={d?.asset.base ?? s.symbol} src={d?.asset.logo} />
                    <b>{d?.asset.base ?? s.symbol}</b>
                    {s.tier && <span className={`tier t${s.tier}`}>{s.tier}</span>}
                    {d && (d.asset.mcap || d.asset.fdv) ? <span className="cap">{fmtCap(d.asset.mcap || d.asset.fdv)}</span> : null}
                    <span className="spacer" />
                    {d && <span className={`small ${d.asset.change24h >= 0 ? "good" : "bad"}`}>{fmtPct(d.asset.change24h)}</span>}
                  </div>
                  <div className="row-head" title={s.headline}>
                    {s.headline}
                  </div>
                  <div className="row-foot">
                    {a ? <ActionBadge action={a.action} /> : <StateLine status={s.status} direction={s.direction} />}
                    {h?.days === 0 && <span className="new-badge">NEW</span>}
                    {h && h.days > 0 && (
                      <span className="muted small">
                        {h.atLeast ? "before " : "since "}
                        {fmtDate(h.since)} <span className={since >= 0 ? "good" : "bad"}>{fmtPct(since)}</span>
                      </span>
                    )}
                    {h?.rankChange ? (
                      <span className={`small ${h.rankChange > 0 ? "good" : "bad"}`}>
                        {h.rankChange > 0 ? "▲" : "▼"}
                        {Math.abs(h.rankChange)}
                      </span>
                    ) : null}
                    <span className="spacer" />
                    <span className="score" title="Score — rank within this tool, not a win probability">
                      {s.score.toFixed(0)}
                    </span>
                  </div>
                </button>
              );
            })}
            {!rows.length && <p className="empty">Nothing matches right now. Try “All” or loosen the settings.</p>}
          </div>
          <div className="list-foot">
            <button className="list-nav" onClick={() => move(-1)} disabled={currentIndex <= 0} title="Previous coin (↑ or K)">↑</button>
            <span>{currentIndex >= 0 ? `${currentIndex + 1} / ${rows.length}` : `${rows.length} shown`}</span>
            <button className="list-nav" onClick={() => move(1)} disabled={currentIndex < 0 || currentIndex >= rows.length - 1} title="Next coin (↓ or J)">↓</button>
            <span className="spacer" />
            <span>{signals.length} scanned</span>
          </div>
        </aside>
        {current && currentData ? renderDetail(currentData, current) : <section className="detail empty">Select a coin</section>}
      </div>
    </>
  );
}

export function exportCsv(name: string, signals: Signal[], bySymbol: Map<string, MarketData>) {
  const head = ["symbol", "markets", "status", "direction", "score", "price", "change24h", "volume24h", "headline"];
  const lines = signals.map((s) => {
    const a = bySymbol.get(s.symbol)?.asset;
    return [
      s.symbol, a?.markets.join("+") ?? "", s.status, s.direction, s.score.toFixed(1),
      a?.price ?? "", a?.change24h ?? "", a?.quoteVolume.toFixed(0) ?? "", `"${s.headline.replace(/"/g, "'")}"`,
    ].join(",");
  });
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
