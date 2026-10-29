import { useEffect, useMemo, useState, type ReactNode } from "react";
import { APP_NAME, APP_VERSION, REPO_URL } from "./config";
import { TIMEFRAMES, nextBarClose, useMarket } from "./data/useMarket";
import { CLASS_FILTERS, MARKET_FILTERS, type ClassFilter, type MarketFilter, type UniverseMode } from "./data/universe";
import { usePersisted } from "./lib/usePersisted";
import { useHistory } from "./lib/useHistory";
import type { History } from "./lib/replay";
import { fmtDate, fmtPct } from "./lib/format";
import type { MarketData, Params, Signal, TimeframeId } from "./lib/types";
import { SCANNERS, confluence, defaultParams, runScanner } from "./scanners";
import { DetailPanel } from "./components/DetailPanel";
import { ToolView, exportCsv } from "./components/ToolView";
import { ConfluenceView } from "./components/ConfluenceView";
import { GuideView, MethodologyView, WatchlistView } from "./components/LibraryViews";
import { FavoritesContext } from "./components/Favorites";
import { BacktestLine, BacktestView } from "./components/BacktestView";
import { DEFAULT_BT, useBacktest } from "./lib/useBacktest";
import { usePatternMatch } from "./lib/usePatternMatch";
import { CAP_BANDS, useMarketCaps, type CapBand } from "./data/marketCaps";
import { patternMatchTool } from "./scanners/patternMatch";
import { buildIdeas, tradeIdeasTool } from "./lib/tradeIdeas";
import { MoversView } from "./components/MoversView";
import { PerformanceView } from "./components/PerformanceView";
import { BENCHMARK } from "./data/universe";
import { Pills } from "./components/ui";
import { useForwardJournal } from "./lib/useForwardJournal";
import { ForwardJournalView } from "./components/ForwardJournalView";

type Theme = "system" | "light" | "dark";
type Page = string; // scanner id | "confluence" | "watchlist" | "methodology"

const sharedTool = new URLSearchParams(location.search).get("tool");
const sharedCoin = new URLSearchParams(location.search).get("coin");


export default function App() {
  const [page, setPage] = usePersisted<Page>("page", sharedTool || "ideas");
  const [theme, setTheme] = usePersisted<Theme>("theme", "light");
  const [mode, setMode] = usePersisted<UniverseMode>("universe", "top");
  const [top, setTop] = usePersisted("topN", 0); // 0 = every coin
  const [market, setMarket] = usePersisted<MarketFilter>("market", "all");
  const [cls, setCls] = usePersisted<ClassFilter>("assetClass", "crypto");
  const [tfId, setTfId] = usePersisted<TimeframeId>("timeframe", "D");
  const [watchlist, setWatchlist] = usePersisted<string[]>("watchlist", []);
  const [allParams, setAllParams] = usePersisted<Record<string, Params>>("params", {});
  const [account, setAccount] = usePersisted("account", 10000);
  const [riskPct, setRiskPct] = usePersisted("riskPct", 1);
  const [selected, setSelected] = useState<string | null>(sharedCoin ? `${sharedCoin.toUpperCase().replace(/USDT$/, "")}USDT` : null);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);

  const effectiveMode: UniverseMode = mode === "watchlist" && watchlist.length ? "watchlist" : "top";
  const { data: rawData, state, reload, candleVersion } = useMarket(effectiveMode, top, watchlist, market, cls, tfId);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("tool", page);
    if (selected) url.searchParams.set("coin", selected.replace(/USDT$/, ""));
    else url.searchParams.delete("coin");
    window.history.replaceState(null, "", url);
  }, [page, selected]);


  // Market caps arrive in the background and are merged onto each asset.
  const caps = useMarketCaps(rawData, candleVersion);
  const data = useMemo(
    () =>
      caps.size
        ? rawData.map((d) => {
            const c = caps.get(d.asset.symbol);
            return c ? { ...d, asset: { ...d.asset, mcap: c.mcap, fdv: c.fdv, mcapRank: c.rank, coingeckoId: c.id, logo: c.image } } : d;
          })
        : rawData,
    [rawData, caps],
  );
  const [capBand, setCapBand] = usePersisted<CapBand>("capBand", "all");
  const bySymbol = useMemo(() => new Map(data.map((d) => [d.asset.symbol, d])), [data]);
  // Favourites are the watchlist, stored as USDT symbols (matched by coin, so spot/perp names both work).
  const favs = useMemo(() => {
    const set = new Set(watchlist);
    return {
      isFav: (sym: string) => set.has(sym),
      toggle: (sym: string) => setWatchlist(set.has(sym) ? watchlist.filter((x) => x !== sym) : [...watchlist, sym]),
    };
  }, [watchlist, setWatchlist]);
  // Benchmarks (BTC/SPY/XAU) are always loaded for relative strength; only list what the user picked.
  const band = CAP_BANDS.find((b) => b.value === capBand)!;
  const universe = useMemo(() => {
    if (capBand === "all") return state.universe;
    const keep = new Set<string>();
    for (const sym of state.universe) {
      const a = bySymbol.get(sym)?.asset;
      const v = a?.mcap || a?.fdv;
      if (v && v >= band.min && v < band.max) keep.add(sym);
    }
    return keep;
  }, [state.universe, capBand, band, bySymbol]);
  const scanned = useMemo(() => data.filter((d) => universe.has(d.asset.symbol)), [data, universe]);
  const results = useMemo(() => {
    const m = new Map<string, Signal[]>();
    for (const s of SCANNERS) {
      const sigs = runScanner(s, data, { ...defaultParams(s), ...allParams[s.id] });
      m.set(s.id, sigs.filter((x) => universe.has(x.symbol)));
    }
    return m;
  }, [data, allParams, universe]);
  const conf = useMemo(() => confluence(results), [results]);
  const history = useHistory(data, candleVersion, results, allParams);
  const bt = useBacktest();
  const pmParams = useMemo(() => ({ ...defaultParams(patternMatchTool), ...allParams.pmatch }), [allParams.pmatch]);
  const pm = usePatternMatch(data, candleVersion, universe, pmParams, page === "pmatch");
  const ideas = useMemo(() => buildIdeas(results, bySymbol, bt.results, history), [results, bySymbol, bt.results, history]);
  const forwardJournal = useForwardJournal(ideas, bySymbol);
  const ideasHistory = useMemo(() => {
    const m = new Map<string, History>();
    for (const sig of ideas) {
      const h = history.get(String(sig.meta?.toolId))?.get(sig.symbol);
      if (h) m.set(sig.symbol, h);
    }
    return m;
  }, [ideas, history]);

  const scanner = SCANNERS.find((s) => s.id === page) ?? (page === "pmatch" ? patternMatchTool : page === "ideas" ? tradeIdeasTool : undefined);
  const title =
    scanner?.name ??
    (page === "confluence"
      ? "Signal Confluence"
      : page === "movers"
        ? "Movers"
        : page === "performance"
          ? "Performers"
        : page === "watchlist"
          ? "Favourites"
          : page === "guide"
            ? "How to use"
          : page === "backtests"
            ? "Backtests"
            : page === "journal"
              ? "Forward Journal"
            : "Methodology");
  const tagline =
    scanner?.tagline ??
    (page === "confluence"
      ? "Where several strategies agree. Prioritise your research."
      : page === "movers"
        ? "Where the attention is: unusual volume, climbing volume rank, fresh highs."
        : page === "performance"
          ? "Every coin from the same starting line. Spot the outliers."
      : page === "watchlist"
        ? "Tap ☆ next to any coin to add it. Scan only your favourites."
        : page === "guide"
          ? "A 5-minute tour: what each page is for and a simple daily routine."
        : page === "backtests"
          ? "How each strategy would have done. Every trade, wins and losses."
          : page === "journal"
            ? "Every first-seen idea, preserved before the outcome is known."
        : "Every rule, in plain English. No black boxes.");

  // Scope: compact dropdowns (timeframe · assets · markets · market cap · how many).
  const universeControl = (
    <div className="scope">
      <select value={tfId} onChange={(e) => setTfId(e.target.value as TimeframeId)} title="Chart timeframe">
        <option value="1H">1-hour</option>
        <option value="4H">4-hour</option>
        <option value="D">Daily</option>
        <option value="3D">3-day</option>
        <option value="W">Weekly</option>
      </select>
      <select
        value={effectiveMode === "watchlist" ? "watchlist" : cls}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "watchlist") {
            if (watchlist.length) setMode("watchlist");
            else setPage("watchlist");
          } else {
            setMode("top");
            setCls(v as ClassFilter);
          }
        }}
        title="What to scan"
      >
        {CLASS_FILTERS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
        <option value="watchlist">★ Favourites{watchlist.length ? ` (${watchlist.length})` : ""}</option>
      </select>
      {effectiveMode === "top" && (
        <>
          <select value={market} onChange={(e) => setMarket(e.target.value as MarketFilter)} title="Spot or perpetual markets">
            {MARKET_FILTERS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={capBand} onChange={(e) => setCapBand(e.target.value as CapBand)} title="Market cap (CoinGecko; FDV when circulating supply is unknown)">
            {CAP_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.value === "all" ? "Any market cap" : `Cap ${b.label}`}
              </option>
            ))}
          </select>
          <select value={top} onChange={(e) => setTop(+e.target.value)} title="How many, by 24h volume">
            {[50, 100, 200, 0].map((n) => (
              <option key={n} value={n}>
                {n ? `Top ${n} by volume` : "All by volume"}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );

  const detail = (toolName: string, toolId?: string) => (d: MarketData, sig: Signal, extra?: ReactNode) => {
    const h = toolId ? history.get(toolId)?.get(sig.symbol) : undefined;
    const withHistory: Signal = h
      ? {
          ...sig,
          metrics: [
            ...(h.days >= 0
              ? [{ label: "Detected", value: `${h.atLeast ? "before " : ""}${fmtDate(h.since)} · ${fmtPct((d.asset.price / h.priceAtDetect - 1) * 100)} since` }]
              : []),
            ...(h.rankChange !== undefined ? [{ label: "Rank change 7d", value: `${h.rankChange > 0 ? "▲" : h.rankChange < 0 ? "▼" : ""}${Math.abs(h.rankChange)} places` }] : []),
            ...sig.metrics,
          ],
        }
      : sig;
    return (
    <DetailPanel
      key={`${toolName}-${sig.symbol}`}
      data={d}
      signal={withHistory}
      detectPrice={h && h.days >= 0 ? h.priceAtDetect : undefined}
      toolName={toolName}
      themeKey={dark ? "dark" : "light"}
      account={account}
      riskPct={riskPct}
      setAccount={setAccount}
      setRiskPct={setRiskPct}
    >
      {extra}
    </DetailPanel>
    );
  };

  const loading = state.phase === "loading";
  const tfInfo = TIMEFRAMES[tfId].info;
  const closeMs = Math.min(4 * 3600_000, tfInfo.lowerSec * 1000);
  const closeLabel = closeMs >= 4 * 3600_000 ? "4h" : tfInfo.lowerLabel;

  return (
    <FavoritesContext.Provider value={favs}>
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="logo">◢</span> {APP_NAME}
        </div>
        <div className="data-chip" title={`${state.listed.spot} spot pairs · ${state.listed.perp} perpetuals on Binance`}>
          <span>Binance</span>
          <span className="muted">
            {scanned.length}
            {state.listed.coins ? ` / ${state.listed.coins}` : ""} assets
          </span>
        </div>

        <div className="nav-group">Today</div>
        <button className={`nav ${page === "ideas" ? "on" : ""}`} onClick={() => setPage("ideas")}>
          <span className="nav-icon">{tradeIdeasTool.icon}</span> {tradeIdeasTool.name}
          <span className="nav-count">{ideas.filter((x) => x.status === "trigger").length || ""}</span>
        </button>
        <button className={`nav ${page === "movers" ? "on" : ""}`} onClick={() => setPage("movers")}>
          <span className="nav-icon">⚑</span> Movers
        </button>
        <button className={`nav ${page === "performance" ? "on" : ""}`} onClick={() => setPage("performance")}>
          <span className="nav-icon">≈</span> Performers
        </button>
        <div className="nav-group">Workspace</div>
        {SCANNERS.map((s) => (
          <button key={s.id} className={`nav ${page === s.id ? "on" : ""}`} onClick={() => setPage(s.id)}>
            <span className="nav-icon">{s.icon}</span> {s.name}
            <span className="nav-count">{results.get(s.id)?.filter((x) => x.status === "trigger").length || ""}</span>
          </button>
        ))}
        <button className={`nav ${page === "pmatch" ? "on" : ""}`} onClick={() => setPage("pmatch")}>
          <span className="nav-icon">{patternMatchTool.icon}</span> {patternMatchTool.name}
          <span className="nav-count">{pm.signals.filter((x) => x.status === "trigger").length || ""}</span>
        </button>
        <button className={`nav ${page === "confluence" ? "on" : ""}`} onClick={() => setPage("confluence")}>
          <span className="nav-icon">≋</span> Signal Confluence
          <span className="nav-count">{conf.filter((r) => r.hits.length >= 3).length || ""}</span>
        </button>

        <div className="nav-group">Library</div>
        <button className={`nav ${page === "watchlist" ? "on" : ""}`} onClick={() => setPage("watchlist")}>
          <span className="nav-icon">★</span> Favourites <span className="nav-count">{watchlist.length}</span>
        </button>
        <button className={`nav ${page === "guide" ? "on" : ""}`} onClick={() => setPage("guide")}>
          <span className="nav-icon">?</span> How to use
        </button>
        <button className={`nav ${page === "backtests" ? "on" : ""}`} onClick={() => setPage("backtests")}>
          <span className="nav-icon">◷</span> Backtests
        </button>
        <button className={`nav ${page === "journal" ? "on" : ""}`} onClick={() => setPage("journal")}>
          <span className="nav-icon">≣</span> Forward Journal <span className="nav-count">{forwardJournal.length || ""}</span>
        </button>
        <button className={`nav ${page === "methodology" ? "on" : ""}`} onClick={() => setPage("methodology")}>
          <span className="nav-icon">▤</span> Methodology
        </button>

        <div className="spacer" />
        <div className="nav-group">Appearance</div>
        <Pills<Theme>
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <div className="version">
          <span>{APP_NAME}</span>
          <span>v{APP_VERSION}</span>
        </div>
      </nav>

      <main className="main">
        <header className="page-head">
          <div>
            <h1>{title}</h1>
            <p className="muted">{tagline}</p>
          </div>
          <div className="spacer" />
          {scanner && (
            <button className="btn" onClick={() => exportCsv(scanner.id, scanner.id === "pmatch" ? pm.signals : results.get(scanner.id) ?? [], bySymbol)}>
              ⇪ Export
            </button>
          )}
          <button className="btn primary" onClick={reload} disabled={loading}>
            ↻ {loading ? "Scanning…" : "Run scan"}
          </button>
        </header>

        <div className="content">
          {state.phase === "error" && <div className="error">Couldn't load market data: {state.error}. Check your connection and press Run scan.</div>}
          {state.warning && <div className="error">{state.warning}</div>}
          {loading && data.length > 0 && (
            <div className="progress">
              <div style={{ width: `${(state.done / Math.max(1, state.total)) * 100}%` }} />
              <span>
                Loading {state.done}/{state.total} coins — results update as they arrive
              </span>
            </div>
          )}
          {!data.length && loading ? (
            <div className="loading">
              Scanning {state.done}/{state.total || "…"} coins…
            </div>
          ) : scanner ? (
            <ToolView
              scanner={scanner}
              signals={scanner.id === "pmatch" ? pm.signals : scanner.id === "ideas" ? ideas : results.get(scanner.id) ?? []}
              bySymbol={bySymbol}
              params={{ ...defaultParams(scanner), ...allParams[scanner.id] }}
              setParams={(p) => setAllParams({ ...allParams, [scanner.id]: p })}
              selected={selected}
              setSelected={setSelected}
              universeControl={universeControl}
              renderDetail={
                scanner.id === "ideas"
                  ? (d, sig) => detail(String(sig.meta?.toolName ?? scanner.name), String(sig.meta?.toolId ?? ""))(d, sig)
                  : detail(scanner.name, scanner.id)
              }
              history={scanner.id === "ideas" ? ideasHistory : history.get(scanner.id)}
              backtestLine={
                scanner.id === "ideas" ? (
                  <span className="muted small">
                    {Object.keys(bt.results).length ? "Ranked with your latest backtest" : "Run a backtest to rank ideas by evidence"}
                  </span>
                ) : scanner.id === "pmatch" ? (
                  <span className="muted small">{pm.busy ? "Matching shapes…" : pm.ms ? `Matched in ${(pm.ms / 1000).toFixed(1)}s` : ""}</span>
                ) : (
                  <BacktestLine result={bt.results[scanner.id]} onOpen={() => setPage("backtests")} />
                )
              }
            />
          ) : page === "confluence" ? (
            <ConfluenceView
              rows={conf}
              results={results}
              bySymbol={bySymbol}
              selected={selected}
              setSelected={setSelected}
              universeControl={universeControl}
              renderDetail={detail("Signal Confluence")}
            />
          ) : page === "movers" ? (
            <MoversView
              data={scanned}
              universeControl={universeControl}
              onOpen={(sym) => {
                setSelected(sym);
                setPage("trend");
              }}
            />
          ) : page === "performance" ? (
            <PerformanceView
              data={scanned}
              dark={dark}
              universeControl={universeControl}
              onOpen={(sym) => {
                setSelected(sym);
                setPage("trend");
              }}
              onScanLeaders={(syms) => {
                setWatchlist(syms);
                setMode("watchlist");
                setPage("ideas");
              }}
            />
          ) : page === "backtests" ? (
            <BacktestView
              results={bt.results}
              progress={bt.progress}
              universeLabel={effectiveMode === "watchlist" ? "your watchlist" : `${cls === "all" ? "all assets" : cls} by volume`}
              onRun={(coins, days) =>
                bt.run(
                  scanned.map((d) => d.asset),
                  data.filter((d) => d.asset.base === BENCHMARK[d.asset.assetClass]).map((d) => d.asset),
                  allParams,
                  { ...DEFAULT_BT, coins, days },
                )
              }
            />
          ) : page === "journal" ? (
            <ForwardJournalView records={forwardJournal} />
          ) : page === "guide" ? (
            <GuideView go={setPage} />
          ) : page === "watchlist" ? (
            <WatchlistView watchlist={watchlist} setWatchlist={setWatchlist} missing={state.missing} onUse={() => {
                setMode("watchlist");
                setPage("ideas");
              }} />
          ) : (
            <MethodologyView />
          )}
        </div>

        <footer className="footer">
          <span>
            <span className={`dot ${loading ? "near" : state.phase === "error" ? "fail" : "pass"}`} />{" "}
            {loading
              ? `Scanning ${state.done}/${state.total} coins…`
              : `${scanned.length} assets (${scanned.filter((d) => d.asset.markets.includes("spot")).length} spot · ${scanned.filter((d) => d.asset.markets.includes("perp")).length} perp) · scan ${(state.ms / 1000).toFixed(1)}s · prices live${state.pricesAt ? ` (${state.pricesAt.toLocaleTimeString()})` : ""} · next ${closeLabel} close in `}
            {!loading && <Countdown ms={closeMs} />}
            {state.skipped.length > 0 && (
              <span title={state.skipped.join(", ")}> · {state.skipped.length} skipped (not enough history yet)</span>
            )}
          </span>
          <span className="caps">
            Completed bars · Public market data · Research only · <button className="link" onClick={() => setPage("guide")}>Privacy</button>
            {REPO_URL && <> · <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a></>}
          </span>
        </footer>
      </main>
    </div>
    </FavoritesContext.Provider>
  );
}

/** Time to the next 4h/daily candle close — isolated so only this text re-renders each second. */
function Countdown({ ms: barMs }: { ms: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = nextBarClose(now, barMs) - now;
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return <>{h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s`}</>;
}
