import { useMemo, useState, type ReactNode } from "react";
import { fmtCap } from "../data/marketCaps";
import { fmtPct, fmtPrice, fmtVol, fmtX } from "../lib/format";
import { mean } from "../lib/indicators";
import type { MarketData } from "../lib/types";
import { Avatar, MarketTags } from "./ui";
import { FavStar } from "./Favorites";

interface Row {
  d: MarketData;
  chg24: number;
  chg7: number;
  rvol: number; // last completed bar's volume vs the prior 30-bar average
  volRankNow: number;
  volRankChange: number; // places gained in the volume ranking vs 7 bars ago
  fromHigh: number; // % below the 30-bar high
  newHigh: boolean;
}

type Key = "rvol" | "volRankChange" | "chg24" | "chg7" | "vol" | "mcap" | "fromHigh";

const quoteVol = (d: MarketData, k: number) => {
  const c = d.daily[d.daily.length - 1 - k];
  return c ? c.close * c.volume : 0;
};

/** Where the attention is: unusual volume, climbing volume rank, momentum and fresh highs. */
export function MoversView({ data, universeControl, onOpen }: { data: MarketData[]; universeControl: ReactNode; onOpen: (symbol: string) => void }) {
  const [sort, setSort] = useState<Key>("rvol");
  const rows = useMemo(() => {
    const rankBy = (k: number) => {
      const r = new Map<string, number>();
      [...data].sort((a, b) => quoteVol(b, k) - quoteVol(a, k)).forEach((d, i) => r.set(d.asset.symbol, i + 1));
      return r;
    };
    const now = rankBy(0);
    const ago = rankBy(7);
    return data.map((d): Row => {
      const c = d.daily;
      const n = c.length;
      const prior = c.slice(Math.max(0, n - 31), n - 1).map((x) => x.volume);
      const hi30 = Math.max(...c.slice(-30).map((x) => x.high));
      return {
        d,
        chg24: d.asset.change24h,
        chg7: n > 8 ? (d.asset.price / c[n - 8].close - 1) * 100 : NaN,
        rvol: mean(prior) ? c[n - 1].volume / mean(prior) : NaN,
        volRankNow: now.get(d.asset.symbol) ?? 0,
        volRankChange: (ago.get(d.asset.symbol) ?? 0) - (now.get(d.asset.symbol) ?? 0),
        fromHigh: (d.asset.price / hi30 - 1) * 100,
        newHigh: c[n - 1].high >= hi30,
      };
    });
  }, [data]);

  const val = (r: Row): number =>
    sort === "vol" ? r.d.asset.quoteVolume : sort === "mcap" ? -(r.d.asset.mcap || r.d.asset.fdv || Infinity) : (r[sort] as number);
  const sorted = [...rows].sort((a, b) => (isFinite(val(b)) ? val(b) : -1e18) - (isFinite(val(a)) ? val(a) : -1e18)).slice(0, 200);
  const th = (k: Key, label: string, title: string) => (
    <th className={sort === k ? "on" : ""} onClick={() => setSort(k)} title={title}>
      {label}
      {sort === k ? " ▾" : ""}
    </th>
  );

  return (
    <>
      <div className="filters">{universeControl}</div>
      <div className="page-body wide">
        <p className="muted small">
          Unusual activity first. Rel. volume = the last completed bar's volume vs its 30-bar average. Volume rank Δ = places climbed in the 24h-volume
          ranking over 7 bars. Click a coin to open its chart.
        </p>
        <table className="bt-table movers">
          <thead>
            <tr>
              <th>Coin</th>
              {th("mcap", "MCap", "CoinGecko market cap (FDV if circulating supply unknown)")}
              <th>Price</th>
              {th("chg24", "24h", "24h change")}
              {th("chg7", "7 bars", "Change over the last 7 bars")}
              {th("rvol", "Rel. volume", "Last bar volume vs 30-bar average")}
              {th("volRankChange", "Vol rank Δ", "Places climbed in the volume ranking vs 7 bars ago")}
              {th("vol", "24h volume", "Spot + perp, USDT")}
              {th("fromHigh", "vs 30-bar high", "Distance from the 30-bar high")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.d.asset.symbol} className="click" onClick={() => onOpen(r.d.asset.symbol)}>
                <td>
                  <span className="coin-cell">
                    <FavStar symbol={r.d.asset.symbol} />
                    <Avatar base={r.d.asset.base} src={r.d.asset.logo} /> <b>{r.d.asset.base}</b> <MarketTags markets={r.d.asset.markets} />
                    {r.newHigh && <span className="new-badge">NEW HIGH</span>}
                  </span>
                </td>
                <td>{fmtCap(r.d.asset.mcap || r.d.asset.fdv)}</td>
                <td>{fmtPrice(r.d.asset.price)}</td>
                <td className={r.chg24 >= 0 ? "good" : "bad"}>{fmtPct(r.chg24)}</td>
                <td className={r.chg7 >= 0 ? "good" : "bad"}>{fmtPct(r.chg7)}</td>
                <td className={r.rvol >= 2 ? "good" : ""}>{fmtX(r.rvol)}</td>
                <td className={r.volRankChange > 0 ? "good" : r.volRankChange < 0 ? "bad" : ""}>
                  {r.volRankChange > 0 ? "▲" : r.volRankChange < 0 ? "▼" : ""}
                  {Math.abs(r.volRankChange) || "–"} <span className="muted small">#{r.volRankNow}</span>
                </td>
                <td>{fmtVol(r.d.asset.quoteVolume)}</td>
                <td>{fmtPct(r.fromHigh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
