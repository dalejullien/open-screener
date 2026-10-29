import { useRef, useState } from "react";
import { parseWatchlist } from "../data/universe";
import { SCANNERS } from "../scanners";
import { patternMatchTool } from "../scanners/patternMatch";

export function WatchlistView({ watchlist, setWatchlist, missing, onUse }: { watchlist: string[]; setWatchlist: (w: string[]) => void; missing: string[]; onUse: () => void }) {
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const importText = (t: string) => {
    const list = parseWatchlist(t);
    if (list.length) setWatchlist([...new Set([...watchlist, ...list])]);
  };

  return (
    <div className="page-body prose">
      <h3>Your favourites · {watchlist.length}</h3>
      <p className="muted">
        Tap <b className="fav-demo">☆</b> next to any coin (in Research Setups, any tool, Movers or a coin page) to add it here. Then pick{" "}
        <b>★ Favourites</b> in the second dropdown at the top to scan only these coins.
      </p>
      {watchlist.length ? (
        <div className="chips fav-chips">
          {watchlist.map((s) => (
            <span key={s} className={`chip ${missing.includes(s) ? "fail" : "pass"}`}>
              {s.replace(/USDT$/, "")}
              <button className="chip-x" title="Remove" onClick={() => setWatchlist(watchlist.filter((x) => x !== s))}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small">No favourites yet.</p>
      )}
      <div className="row-actions">
        {watchlist.length > 0 && (
          <>
            <button className="btn primary" onClick={onUse}>Scan my favourites</button>
            <button className="btn" onClick={() => setWatchlist([])}>Clear all</button>
          </>
        )}
      </div>
      {missing.length > 0 && <p className="muted small">Grey = not found on Binance, skipped in scans.</p>}

      <details className="ins-all">
        <summary>Import a list from TradingView (optional)</summary>
        <ol>
          <li>In TradingView, open your watchlist menu (⋯ next to its name) → <b>Export list…</b></li>
          <li>Pick the downloaded <code>.txt</code> file, or paste its contents. Imported coins are added to your favourites.</li>
        </ol>
        <div className="row-actions">
          <button className="btn" onClick={() => file.current?.click()}>Choose file…</button>
          <input ref={file} type="file" accept=".txt,.csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) importText(await f.text()); e.target.value = ""; }} />
        </div>
        <textarea placeholder="BINANCE:BTCUSDT,BINANCE:ETHUSDT,BYBIT:SOLUSDT.P,…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={!text.trim()} onClick={() => importText(text)}>Import pasted list</button>
      </details>
    </div>
  );
}

/** Plain-English tour of the app, linked from the Library section. */
export function GuideView({ go }: { go: (page: string) => void }) {
  const L = ({ to, children }: { to: string; children: string }) => (
    <button className="link" onClick={() => go(to)}>
      {children}
    </button>
  );
  return (
    <div className="page-body prose guide">
      <p>
        Open Screener scans Binance markets with transparent, testable rules and ranks setups for further research. It does not tell you what to buy or sell.
      </p>

      <h3>A simple daily routine (5 minutes)</h3>
      <ol>
        <li>
          <b>Check the market.</b> Open <L to="performance">Performance</L>: is BTC rising or falling? Are most coins up (green) or down? If BTC is
          breaking down, be extra careful: most altcoins follow it.
        </li>
        <li>
          <b>Open <L to="ideas">Research Setups</L>.</b> It is the shortlist from every tool, best evidence first. Use the <b>Triggered</b> filter.
        </li>
        <li>
          <b>Click a coin.</b> Read the reason, inspect the chart, then review the invalidation and example risk model.
        </li>
        <li>
          <b>Classify.</b> ● Triggered = confirmed near its reference level. ◔ Forming = trigger pending. ▲ Extended = already moved too far. ○ Invalidated = the setup failed.
        </li>
        <li>
          <b>Tap ☆</b> on anything you want to follow. Your <L to="watchlist">Favourites</L> can be scanned on their own.
        </li>
      </ol>

      <h3>The labels</h3>
      <ul>
        <li><b>● Triggered</b>: the setup's trigger fired and price remains near its reference level.</li>
        <li><b>◔ Forming</b>: the setup is incomplete. The chart shows the level that would confirm it.</li>
        <li><b>▲ Extended</b>: it triggered but already moved too far from the original level.</li>
        <li><b>○ Invalidated</b>: price is below the stop. The idea is wrong for now.</li>
        <li><b>R</b>: the amount you risk. +2R means you made twice what you risked. At 1% risk, +2R ≈ +2% of your account.</li>
        <li><b>Score</b>: ranks setups within a tool. It is not a win probability.</li>
      </ul>

      <h3>The pages</h3>
      <ul>
        <li><L to="ideas">Research Setups</L>: ranked setups from every tool, one per coin.</li>
        <li><L to="movers">Movers</L>: coins with unusual volume or climbing the volume ranking. Attention often comes before price.</li>
        <li><L to="performance">Performance</L>: every coin from the same starting line. Find the leaders and laggards; drag the window under the chart to change the period.</li>
        <li><b>Workspace tools</b> (S-Tier, Trend, Second Chance, …): each one is a single strategy. Use them when you want to dig into one style.</li>
        <li><L to="backtests">Backtests</L>: how each strategy would have done on past data, ranked. Use it to decide which tools to trust.</li>
        <li><L to="methodology">Methodology</L>: the exact rules behind every tool.</li>
      </ul>

      <h3>Controls at the top</h3>
      <ul>
        <li><b>Timeframe</b> (1-hour … Weekly): shorter = faster, noisier signals. Daily is the default for swing trades.</li>
        <li><b>Crypto / Stocks / ★ Favourites</b>: what to scan.</li>
        <li><b>Market cap</b>: e.g. "&lt; $50M" for small caps only.</li>
        <li><b>⚙ Settings</b> (on tool pages): change a strategy's numbers.</li>
      </ul>

      <h3>Good habits</h3>
      <ul>
        <li>Put the stop where your reason for the trade is proven wrong, then size down so you still only risk 1%.</li>
        <li>Don't buy right under resistance. Wait for the breakout to hold, or buy near support.</li>
        <li>When several tools agree on a coin (shown as "2 tools agree"), the setup is stronger.</li>
        <li>Log what you do. Over time your own results matter more than any backtest.</li>
      </ul>

      <h3>Privacy and data</h3>
      <p>
        Open Screener runs in your browser. Settings, favourites, cached candles and the Forward Journal stay in local browser storage. No account or API key is required. Market-data requests go directly to Binance and CoinGecko, and research links open third-party sites under their own privacy policies.
      </p>
    </div>
  );
}

export function MethodologyView() {
  return (
    <div className="page-body prose">
      <p>
        Every tool runs on <b>completed bars only</b> (the still-forming candle is dropped), so a signal never repaints. Data comes from Binance's public
        market-data API, fetched directly by your browser. Scores rank setups within a tool; they are <b>not win probabilities</b>.
      </p>
      {[...SCANNERS, patternMatchTool].map((s) => (
        <section key={s.id} className="method">
          <h3>
            {s.icon} {s.name}
          </h3>
          <p className="muted">{s.tagline}</p>
          <pre>{s.methodology}</pre>
          <p className="muted small">{s.id === "pmatch" ? "Not backtested yet." : "Backtest results: see the Backtests page."}</p>
        </section>
      ))}
      <section className="method">
        <h3>Signal Confluence</h3>
        <pre>{`Per coin: trigger = 2 points, pass = 1 point, summed across all strategies.
Filter by how many strategies agree. Equal weights until backtests justify different ones.`}</pre>
      </section>
      <p className="muted small">Research only. Not financial advice. Past patterns do not guarantee future results.</p>
    </div>
  );
}
