import type { Asset } from "../lib/types";
import { normalizeCoin } from "./universe";

// CoinGecko (free, CORS-enabled) maps a ticker to the project's official X account and website.
// Looked up on demand, cached a week.
const CG = "https://api.coingecko.com/api/v3";
const TTL = 7 * 86_400_000;

export interface Research {
  name?: string;
  rank?: number;
  twitter?: string;
  homepage?: string;
}

const memo = new Map<string, Promise<Research>>();

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}

interface CgSearch {
  coins: { id: string; name: string; symbol: string; market_cap_rank: number | null }[];
}
interface CgCoin {
  name: string;
  market_cap_rank: number | null;
  links: { homepage: string[]; twitter_screen_name: string };
}

async function lookup(symbol: string, knownId?: string): Promise<Research> {
  // Prefer the exact CoinGecko id (mapped from Binance's own listing); fall back to ticker search.
  let match: { id: string } | undefined = knownId ? { id: knownId } : undefined;
  if (!match) {
    const { coins } = await getJSON<CgSearch>(`${CG}/search?query=${encodeURIComponent(symbol)}`);
    // Exact ticker match, most valuable project first — tickers are not unique across crypto.
    match = coins
      .filter((c) => c.symbol.toUpperCase() === symbol)
      .sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0];
  }
  if (!match) return {};
  const coin = await getJSON<CgCoin>(
    `${CG}/coins/${match.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
  );
  const res: Research = {
    name: coin.name,
    rank: coin.market_cap_rank ?? undefined,
    twitter: coin.links?.twitter_screen_name || undefined,
    homepage: coin.links?.homepage?.find(Boolean),
  };
  return res;
}

/** Cached research lookup for a crypto asset. Never throws; returns {} when nothing matches. */
export function getResearch(asset: Asset): Promise<Research> {
  if (asset.assetClass !== "crypto") return Promise.resolve({});
  const symbol = normalizeCoin(asset.base).toUpperCase();
  const key = `os.research3.${asset.coingeckoId ?? symbol}`;
  const cached = localStorage.getItem(key);
  if (cached) {
    const { at, data } = JSON.parse(cached) as { at: number; data: Research };
    if (Date.now() - at < TTL) return Promise.resolve(data);
  }
  let p = memo.get(key);
  if (!p) {
    p = lookup(symbol, asset.coingeckoId)
      .then((data) => {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
        return data;
      })
      .catch(() => {
        memo.delete(key); // rate-limited or offline: allow a retry later
        return {} as Research;
      });
    memo.set(key, p);
  }
  return p;
}

export interface ResearchLink {
  label: string;
  href: string;
  title: string;
}

/**
 * Outbound research links that go to an exact destination — no search pages that could land on a
 * look-alike token. Official X and website come from the matched CoinGecko project (name shown in the UI).
 */
export function researchLinks(asset: Asset, r: Research): ResearchLink[] {
  const sym = asset.assetClass === "crypto" ? normalizeCoin(asset.base) : asset.base;
  const links: ResearchLink[] = [];
  if (r.twitter) links.push({ label: `𝕏 @${r.twitter}`, href: `https://x.com/${r.twitter}`, title: "Official X account" });
  links.push({ label: `𝕏 $${sym} posts`, href: `https://x.com/search?q=${encodeURIComponent(`$${sym}`)}&f=live`, title: "Latest posts mentioning the cashtag" });
  if (r.homepage) links.push({ label: "Website", href: r.homepage, title: r.homepage });
  const tv = asset.spotSymbol ? `BINANCE:${asset.spotSymbol}` : `BINANCE:${asset.perpSymbol}.P`;
  links.push({ label: "TradingView", href: `https://www.tradingview.com/chart/?symbol=${tv}`, title: "Open the chart in TradingView" });
  links.push({
    label: "Binance",
    href: asset.spotSymbol
      ? `https://www.binance.com/en/trade/${asset.spotSymbol.replace(/USDT$/, "")}_USDT?type=spot`
      : `https://www.binance.com/en/futures/${asset.perpSymbol}`,
    title: asset.spotSymbol ? "Binance spot market" : "Binance perpetual market",
  });
  return links;
}
