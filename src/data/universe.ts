import type { Asset, AssetClass, Market } from "../lib/types";
import type { Ticker } from "./binance";

const STABLES = new Set(
  "USDT USDC FDUSD TUSD DAI USDE USDP BUSD PYUSD USD1 XUSD RLUSD USDS BFUSD EUR EURI AEUR PAXG XAUT KGST".split(" "),
);
const WRAPPED = new Set("WBTC WBETH BETH WBNB STETH WSTETH".split(" "));

/** Perps quote some coins per 1000 units ("1000PEPE"). Strip the multiplier to match spot "PEPE". */
const MULTIPLIER = /^(1000000|100000|10000|1000|1M)(?=[A-Z])/;
export const normalizeCoin = (base: string) => base.replace(MULTIPLIER, "");

/** Name shared by every market of the same instrument: "1000PEPE"→"PEPE", tokenized "NVDAB"→"NVDA". */
function instrumentName(t: Ticker) {
  if (t.assetClass === "stock" && t.market === "spot") return t.base.slice(0, -1);
  return t.assetClass === "crypto" ? normalizeCoin(t.base) : t.base;
}

function isExcluded(t: Ticker): boolean {
  if (t.assetClass !== "crypto") return false;
  const coin = normalizeCoin(t.base);
  if (STABLES.has(coin) || WRAPPED.has(coin) || /(UP|DOWN|BULL|BEAR)$/.test(t.base)) return true;
  return t.price > 0.97 && t.price < 1.03 && t.low > 0 && t.high / t.low < 1.01; // unlisted stablecoins
}

/** Merge spot + perp tickers into one Asset per instrument. Candles come from spot when it exists. */
export function mergeMarkets(spot: Ticker[], perp: Ticker[]): Asset[] {
  const byKey = new Map<string, { name: string; spot?: Ticker; perp?: Ticker }>();
  const keyOf = (t: Ticker) => `${t.assetClass}:${instrumentName(t)}`;
  for (const t of spot) if (!isExcluded(t)) byKey.set(keyOf(t), { name: instrumentName(t), spot: t });
  for (const t of perp) {
    if (isExcluded(t)) continue;
    const entry = byKey.get(keyOf(t)) ?? { name: instrumentName(t) };
    // If an instrument has both a plain and a 1000× perp, keep the more liquid one.
    if (!entry.perp || t.quoteVolume > entry.perp.quoteVolume) entry.perp = t;
    byKey.set(keyOf(t), entry);
  }
  return [...byKey.values()].map(({ name, spot: s, perp: p }) => {
    const main = (s ?? p)!;
    const markets: Market[] = [...(s ? ["spot" as const] : []), ...(p ? ["perp" as const] : [])];
    return {
      symbol: main.symbol,
      base: main.assetClass === "crypto" ? main.base : name,
      assetClass: main.assetClass,
      markets,
      source: main.market,
      spotSymbol: s?.symbol,
      perpSymbol: p?.symbol,
      price: main.price,
      change24h: main.change24h,
      quoteVolume: (s?.quoteVolume ?? 0) + (p?.quoteVolume ?? 0),
      spotVolume: s?.quoteVolume ?? 0,
      perpVolume: p?.quoteVolume ?? 0,
    };
  });
}

/** Benchmark per class (relative strength is measured against these). */
export const BENCHMARK: Record<AssetClass, string> = { crypto: "BTC", stock: "SPY", commodity: "XAU" };

export type UniverseMode = "top" | "watchlist";
export type MarketFilter = "all" | "spot" | "perp" | "perpOnly";
export type ClassFilter = AssetClass | "all";

export const MARKET_FILTERS: { value: MarketFilter; label: string }[] = [
  { value: "all", label: "All markets" },
  { value: "spot", label: "Spot" },
  { value: "perp", label: "Perpetual" },
  { value: "perpOnly", label: "Perp only" },
];

export const CLASS_FILTERS: { value: ClassFilter; label: string }[] = [
  { value: "crypto", label: "Crypto" },
  { value: "stock", label: "Stocks" },
  { value: "commodity", label: "Commodities" },
  { value: "all", label: "All assets" },
];

export function matchesMarket(a: Asset, f: MarketFilter) {
  if (f === "spot") return a.markets.includes("spot");
  if (f === "perp") return a.markets.includes("perp");
  if (f === "perpOnly") return a.markets.length === 1 && a.markets[0] === "perp";
  return true;
}

/** `top` = 0 means everything that matches. */
export function selectUniverse(assets: Asset[], mode: UniverseMode, top: number, watchlist: string[], market: MarketFilter, cls: ClassFilter) {
  const byVolume = [...assets].sort((a, b) => b.quoteVolume - a.quoteVolume);
  if (mode === "watchlist" && watchlist.length) {
    const wanted = new Map(watchlist.map((s) => [normalizeCoin(s.replace(/USDT$/, "")), s]));
    const found = byVolume.filter((a) => wanted.has(normalizeCoin(a.base)));
    const have = new Set(found.map((a) => normalizeCoin(a.base)));
    return { assets: found, missing: [...wanted].filter(([c]) => !have.has(c)).map(([, s]) => s) };
  }
  const inScope = byVolume.filter((a) => matchesMarket(a, market) && (cls === "all" || a.assetClass === cls));
  return { assets: top > 0 ? inScope.slice(0, top) : inScope, missing: [] as string[] };
}

/**
 * Parse a TradingView watchlist export ("BINANCE:BTCUSDT,BYBIT:SOLUSDT.P,###SECTION,...")
 * or any comma/newline-separated list of tickers into USDT symbols.
 */
export function parseWatchlist(text: string): string[] {
  const out = new Set<string>();
  for (let raw of text.split(/[,\n\r\t]+/)) {
    raw = raw.trim().toUpperCase();
    if (!raw || raw.startsWith("###")) continue;
    const s = (raw.includes(":") ? raw.split(":").pop()! : raw).replace(/\.P$|PERP$/, "");
    const m = s.match(/^([A-Z0-9]+?)(USDT|USDC|FDUSD|USD|BUSD)?$/);
    if (!m || STABLES.has(normalizeCoin(m[1]))) continue;
    out.add(`${m[1]}USDT`);
  }
  return [...out];
}
