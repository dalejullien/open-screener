import { useEffect, useState } from "react";
import type { MarketData } from "../lib/types";
import { idbGet, idbSet } from "./binance";
import { normalizeCoin } from "./universe";

// CoinGecko (free, CORS-enabled). The free tier allows only a handful of calls a minute, so we pull
// the top coins by market cap in a few spaced calls (cached 30 min) and match Binance coins by ticker,
// taking the largest coin with that ticker — Binance-listed coins are almost always that one.
const CG = "https://api.coingecko.com/api/v3";
const CAPS_TTL = 30 * 60_000;
const PAGES = 5; // top 1,250 coins
const SPACING_MS = 6_000;

export interface CapInfo {
  id: string;
  mcap: number | null;
  fdv: number | null;
  rank: number | null;
  image?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Patient GET: a rate-limited response can surface as a network error (no CORS headers), so retry both. */
async function cg<T>(path: string): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${CG}/${path}`);
      if (r.ok) return (await r.json()) as T;
      if (r.status !== 429) throw new Error(`CoinGecko ${r.status}`);
    } catch (e) {
      if (i >= 3) throw e;
    }
    if (i >= 3) throw new Error("CoinGecko rate limit");
    await sleep(60_000);
  }
}

interface CgMarket {
  id: string;
  symbol: string;
  market_cap: number | null;
  fully_diluted_valuation: number | null;
  market_cap_rank: number | null;
  image?: string;
}

async function loadCaps(data: MarketData[]): Promise<Map<string, CapInfo>> {
  let top = (await idbGet<{ at: number; top: CgMarket[] }>("cg:top")) ?? null;
  if (!top || Date.now() - top.at > CAPS_TTL) {
    const list: CgMarket[] = [];
    for (let p = 1; p <= PAGES; p++) {
      list.push(...(await cg<CgMarket[]>(`coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}`)));
      if (p < PAGES) await sleep(SPACING_MS);
    }
    top = { at: Date.now(), top: list };
    await idbSet("cg:top", top);
  }
  const bySymbol = new Map<string, CgMarket>();
  for (const m of top.top) {
    const s = m.symbol.toUpperCase();
    const cur = bySymbol.get(s);
    if (!cur || (m.market_cap ?? 0) > (cur.market_cap ?? 0)) bySymbol.set(s, m);
  }
  const caps = new Map<string, CapInfo>();
  for (const d of data) {
    if (d.asset.assetClass !== "crypto") continue;
    const m = bySymbol.get(normalizeCoin(d.asset.base).toUpperCase());
    if (m) caps.set(d.asset.symbol, { id: m.id, mcap: m.market_cap || null, fdv: m.fully_diluted_valuation || null, rank: m.market_cap_rank, image: m.image });
  }
  return caps;
}

/** Market caps for loaded crypto assets; fills in quietly in the background, never blocks scanning. */
export function useMarketCaps(data: MarketData[], candleVersion: number) {
  const [caps, setCaps] = useState<Map<string, CapInfo>>(new Map());
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!data.length) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout>;
    loadCaps(data)
      .then((c) => live && setCaps(c))
      .catch(() => {
        // Rate-limited or offline: try again in two minutes.
        if (live) retry = setTimeout(() => setAttempt((a) => a + 1), 120_000);
      });
    return () => {
      live = false;
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleVersion, attempt]);
  return caps;
}

export type CapBand = "all" | "micro" | "small" | "mid" | "large";
export const CAP_BANDS: { value: CapBand; label: string; min: number; max: number }[] = [
  { value: "all", label: "All caps", min: 0, max: Infinity },
  { value: "micro", label: "< $50M", min: 0, max: 50e6 },
  { value: "small", label: "$50–300M", min: 50e6, max: 300e6 },
  { value: "mid", label: "$300M–2B", min: 300e6, max: 2e9 },
  { value: "large", label: "> $2B", min: 2e9, max: Infinity },
];

export const fmtCap = (v: number | null | undefined) =>
  !v ? "–" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${(v / 1e3).toFixed(0)}K`;
