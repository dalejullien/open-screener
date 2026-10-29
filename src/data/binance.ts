import type { AssetClass, Candle, Market } from "../lib/types";

// Binance public market data: no API key, CORS-enabled, fetched directly by the user's browser.
const BASE: Record<Market, string> = {
  spot: "https://data-api.binance.vision/api/v3",
  perp: "https://fapi.binance.com/fapi/v1",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with automatic back-off when Binance rate-limits (429) or temporarily bans (418). */
async function getJSON<T>(market: Market, path: string, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await fetch(`${BASE[market]}/${path}`);
    if (r.ok) return r.json() as Promise<T>;
    if ((r.status === 429 || r.status === 418) && i < tries - 1) {
      const wait = Number(r.headers.get("retry-after")) || 2 ** i * 5;
      await sleep(wait * 1000);
      continue;
    }
    throw new Error(`Binance ${market} ${r.status} on ${path.split("?")[0]}`);
  }
}

export interface Ticker {
  symbol: string;
  base: string;
  market: Market;
  assetClass: AssetClass;
  price: number;
  change24h: number;
  quoteVolume: number;
  high: number;
  low: number;
}

interface RawTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  count: number;
  closeTime: number;
}

const toTicker = (t: RawTicker, market: Market, assetClass: AssetClass): Ticker => ({
  symbol: t.symbol,
  base: t.symbol.slice(0, -4),
  market,
  assetClass,
  price: +t.lastPrice,
  change24h: +t.priceChangePercent,
  quoteVolume: +t.quoteVolume,
  high: +t.highPrice,
  low: +t.lowPrice,
});

interface SpotInfo {
  symbols: { symbol: string; baseAsset: string; quoteAsset: string; filters: { filterType: string; bidMultiplierDown?: string; askMultiplierUp?: string }[] }[];
}
let spotMeta: Promise<Map<string, AssetClass>> | null = null;

/**
 * Live spot USDT pairs → asset class. Binance spot also lists tokenized stocks ("NVDAB", "SPYB").
 * They carry no explicit flag; they're identified by their tighter ±20% price band plus the "B" suffix.
 */
function loadSpotMeta() {
  return (spotMeta ??= getJSON<SpotInfo>("spot", "exchangeInfo?symbolStatus=TRADING&showPermissionSets=false").then((info) => {
    const m = new Map<string, AssetClass>();
    for (const s of info.symbols) {
      if (s.quoteAsset !== "USDT") continue;
      const band = s.filters.find((f) => f.filterType === "PERCENT_PRICE_BY_SIDE");
      const tokenizedStock = band?.bidMultiplierDown === "0.8" && band.askMultiplierUp === "1.2" && /.B$/.test(s.baseAsset);
      m.set(s.symbol, tokenizedStock ? "stock" : "crypto");
    }
    return m;
  }));
}

async function spotTickers(): Promise<Ticker[]> {
  const [meta, all] = await Promise.all([loadSpotMeta(), getJSON<RawTicker[]>("spot", "ticker/24hr")]);
  return all.flatMap((t) => {
    const cls = meta.get(t.symbol);
    return cls && t.count > 0 ? [toTicker(t, "spot", cls)] : [];
  });
}

interface PerpInfo {
  symbols: { symbol: string; quoteAsset: string; contractType: string; status: string; underlyingType?: string }[];
}
let perpMeta: Promise<Map<string, AssetClass>> | null = null;

// Binance "TradFi" perps: equities (US/HK/KR/CN), pre-IPO companies and commodities.
const TRADFI_CLASS: Record<string, AssetClass> = {
  EQUITY: "stock",
  HK_EQUITY: "stock",
  KR_EQUITY: "stock",
  CN_EQUITY: "stock",
  PREMARKET: "stock",
  COMMODITY: "commodity",
};

/** Live USDT perpetuals → asset class. Index perps (BTCDOM…), FX and dated futures are left out. */
function loadPerpMeta() {
  return (perpMeta ??= getJSON<PerpInfo>("perp", "exchangeInfo").then((info) => {
    const m = new Map<string, AssetClass>();
    for (const s of info.symbols) {
      if (s.quoteAsset !== "USDT" || s.status !== "TRADING") continue;
      if (s.contractType === "PERPETUAL" && s.underlyingType === "COIN") m.set(s.symbol, "crypto");
      else if (s.contractType === "TRADIFI_PERPETUAL" && s.underlyingType && TRADFI_CLASS[s.underlyingType]) m.set(s.symbol, TRADFI_CLASS[s.underlyingType]);
    }
    return m;
  }));
}

async function perpTickers(): Promise<Ticker[]> {
  const [meta, all] = await Promise.all([loadPerpMeta(), getJSON<RawTicker[]>("perp", "ticker/24hr")]);
  return all.flatMap((t) => {
    const cls = meta.get(t.symbol);
    return cls && t.count > 0 ? [toTicker(t, "perp", cls)] : [];
  });
}

/** Both markets; if futures is unreachable the spot list still works. */
export async function fetchAllTickers(): Promise<{ spot: Ticker[]; perp: Ticker[]; perpError?: string }> {
  const [spot, perp] = await Promise.allSettled([spotTickers(), perpTickers()]);
  if (spot.status === "rejected") {
    spotMeta = null;
    throw spot.reason;
  }
  if (perp.status === "rejected") {
    perpMeta = null;
    return { spot: spot.value, perp: [], perpError: (perp.reason as Error).message };
  }
  return { spot: spot.value, perp: perp.value };
}

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];
export type Interval = "15m" | "1h" | "4h" | "1d" | "3d" | "1w";
export const INTERVAL_SEC: Record<Interval, number> = { "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400, "3d": 259_200, "1w": 604_800 };

const parseKlines = (rows: RawKline[], now = Date.now()): Candle[] =>
  rows.filter((k) => k[6] < now).map((k) => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));

// Session cache: candles are only re-fetched once a new bar has actually closed.
const cache = new Map<string, Candle[]>();

/** Completed candles only — the still-forming bar is dropped so signals never repaint. */
export async function fetchCandles(market: Market, symbol: string, interval: Interval, limit: number): Promise<Candle[]> {
  const key = `${market}:${symbol}:${interval}`;
  // Memory first, then the browser's IndexedDB (survives reloads), then the network.
  let hit = cache.get(key);
  if (!hit) {
    hit = (await idbGet<Candle[]>(`c:${key}`)) ?? undefined;
    if (hit?.length) cache.set(key, hit);
  }
  const sec = INTERVAL_SEC[interval];
  if (hit?.length) {
    const lastOpen = hit[hit.length - 1].time;
    if (Date.now() < (lastOpen + 2 * sec) * 1000) return hit;
    // Incremental: only fetch bars that closed since the cached ones (a few KB instead of the whole history).
    const missing = Math.ceil((Date.now() / 1000 - lastOpen) / sec);
    if (missing <= 100) {
      const rows = await getJSON<RawKline[]>(market, `klines?symbol=${symbol}&interval=${interval}&startTime=${(lastOpen + sec) * 1000}&limit=${missing + 1}`);
      const merged = [...hit, ...parseKlines(rows)].slice(-limit);
      cache.set(key, merged);
      void idbSet(`c:${key}`, merged);
      return merged;
    }
  }
  const candles = parseKlines(await getJSON<RawKline[]>(market, `klines?symbol=${symbol}&interval=${interval}&limit=${limit}`));
  cache.set(key, candles);
  void idbSet(`c:${key}`, candles);
  return candles;
}

/**
 * Deep history for backtests: pages backwards up to `bars` completed candles (1000 per request).
 * Cached in IndexedDB for a day so re-running a backtest doesn't re-download.
 */
export async function fetchDeepCandles(market: Market, symbol: string, interval: Interval, bars: number): Promise<Candle[]> {
  const key = `${market}:${symbol}:${interval}:${bars}`;
  const cached = await idbGet<{ at: number; candles: Candle[] }>(key);
  if (cached && Date.now() - cached.at < 86_400_000) return cached.candles;
  let out: Candle[] = [];
  let endTime: number | undefined;
  while (out.length < bars) {
    const n = Math.min(1000, bars - out.length) + 1;
    // Futures charge more weight above 499 bars per request; spot is flat.
    const limit = market === "perp" ? Math.min(n, 499) : n;
    const rows = await getJSON<RawKline[]>(market, `klines?symbol=${symbol}&interval=${interval}&limit=${limit}${endTime ? `&endTime=${endTime}` : ""}`);
    const page = parseKlines(rows);
    if (!page.length) break;
    out = [...page.filter((c) => !out.length || c.time < out[0].time), ...out];
    if (rows.length < limit) break;
    endTime = rows[0][0] - 1;
  }
  out = out.slice(-bars);
  await idbSet(key, { at: Date.now(), candles: out });
  return out;
}

/** Live last prices for every symbol on both markets (~36 KB vs ~350 KB for full 24h tickers). */
export async function fetchPrices(): Promise<Record<Market, Map<string, number>>> {
  const [spot, perp] = await Promise.allSettled([
    getJSON<{ symbol: string; price: string }[]>("spot", "ticker/price"),
    getJSON<{ symbol: string; price: string }[]>("perp", "ticker/price"),
  ]);
  const toMap = (r: typeof spot) => new Map(r.status === "fulfilled" ? r.value.map((t) => [t.symbol, +t.price] as const) : []);
  return { spot: toMap(spot), perp: toMap(perp) };
}

// Minimal IndexedDB key-value store (no dependency) for large cached histories.
let dbPromise: Promise<IDBDatabase> | null = null;
const idb = () =>
  (dbPromise ??= new Promise<IDBDatabase>((ok, fail) => {
    const req = indexedDB.open("open-screener", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  }));
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await idb();
    return await new Promise<T | undefined>((ok) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => ok(r.result as T | undefined);
      r.onerror = () => ok(undefined);
    });
  } catch {
    return undefined;
  }
}
export async function idbSet(key: string, value: unknown) {
  try {
    const db = await idb();
    db.transaction("kv", "readwrite").objectStore("kv").put(value, key);
  } catch {
    // cache is best-effort
  }
}

export type PoolResult<T, R> = { ok: true; item: T; value: R } | { ok: false; item: T; error: string };

/** Run `fn` over `items` with at most `n` in flight, reporting each result as it lands. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>, onResult?: (r: PoolResult<T, R>) => void) {
  const out: PoolResult<T, R>[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        let r: PoolResult<T, R>;
        try {
          r = { ok: true, item, value: await fn(item) };
        } catch (e) {
          r = { ok: false, item, error: (e as Error).message };
        }
        out.push(r);
        onResult?.(r);
      }
    }),
  );
  return out;
}
