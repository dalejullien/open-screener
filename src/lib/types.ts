/** One OHLCV bar. `time` is the bar's open time in UTC seconds. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Market = "spot" | "perp";
export type AssetClass = "crypto" | "stock" | "commodity";

/** One instrument, merged across Binance spot and USDⓈ-M perpetual markets. */
export interface Asset {
  symbol: string; // unique id + the symbol candles are loaded from, e.g. "SOLUSDT" or "1000RATSUSDT"
  base: string; // display name, e.g. "SOL", "NVDA"
  assetClass: AssetClass;
  markets: Market[]; // where it trades
  source: Market; // which market the candles come from (spot when available)
  spotSymbol?: string;
  perpSymbol?: string; // may differ from spot, e.g. "1000PEPEUSDT" vs "PEPEUSDT"
  price: number;
  change24h: number; // percent
  quoteVolume: number; // 24h USDT volume, spot + perp combined
  spotVolume: number;
  perpVolume: number;
  /** From CoinGecko (filled in after load; crypto only). */
  mcap?: number | null;
  fdv?: number | null;
  mcapRank?: number | null;
  coingeckoId?: string;
  logo?: string;
}

export type TimeframeId = "1H" | "4H" | "D" | "3D" | "W";

export interface TimeframeInfo {
  id: TimeframeId;
  label: string; // "Daily", "3-day", "Weekly"
  lowerLabel: string; // timeframe used for entries: "4h" or "daily"
  primarySec: number;
  lowerSec: number;
}

/**
 * Everything a scanner gets for one asset. Only completed bars are included.
 * `daily` is the primary (trend) timeframe and `h4` the lower (entry) timeframe: daily + 4h by
 * default, 3-day + daily or weekly + daily when the user switches timeframe.
 */
export interface MarketData {
  asset: Asset;
  daily: Candle[];
  h4: Candle[];
  tf: TimeframeInfo;
}

export type Status = "trigger" | "pass" | "near" | "fail";
export type Direction = "bullish" | "bearish" | "neutral";
export type Timeframe = "daily" | "h4";

export interface Level {
  price: number;
  label: string;
  kind: "entry" | "stop" | "target" | "level";
}

/** A line drawn over the price chart, aligned index-for-index with that timeframe's candles. */
export interface Overlay {
  label: string;
  values: (number | null)[];
  style?: "solid" | "dashed";
  /** Theme color; defaults to the categorical series order. */
  color?: "good" | "bad" | "s1" | "s2" | "ink2";
}

/** A path with its own timestamps — may extend past the last candle (e.g. Pattern Match scenarios). */
export interface Projection {
  label: string;
  points: { time: number; value: number }[];
  main?: boolean; // the weighted estimate (drawn solid and thicker)
}

export interface Marker {
  time: number;
  text: string;
  position?: "above" | "below";
}

/** The common output every scanner produces — this is what makes strategies combinable. */
export interface Signal {
  symbol: string;
  status: Status;
  direction: Direction;
  score: number; // 0–100, ranking strength within this scanner (not a probability)
  headline: string; // short one-liner for the list row
  reason: string; // plain-English explanation
  metrics: { label: string; value: string }[];
  levels: Level[];
  chart: { timeframe: Timeframe; overlays: Overlay[]; markers?: Marker[]; projections?: Projection[]; visibleBars?: number };
  /** Scanner-specific raw value used by `finalize` for cross-sectional ranking. */
  raw?: number;
  /** Quality tier for setup scanners (S = best). */
  tier?: "S" | "A" | "B";
  /** Transparent rule-by-rule breakdown shown on the coin page. */
  checklist?: { label: string; ok: boolean; detail?: string }[];
  /** Scanner-private values carried from `run` to `finalize`. */
  meta?: Record<string, number | boolean | string>;
}

export interface ParamDef {
  key: string;
  label: string;
  default: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}

export type Params = Record<string, number>;

export interface ScanContext {
  /** Per-class benchmark: BTC for crypto, SPY for stocks, gold for commodities. */
  benchmarks: Partial<Record<AssetClass, MarketData>>;
}

/**
 * A strategy plug-in. To add a strategy: create a file in src/scanners/, export a Scanner,
 * and register it in src/scanners/index.ts.
 */
export interface Scanner {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  params: ParamDef[];
  /** Markdown-ish plain text shown on the Methodology page. */
  methodology: string;
  run(data: MarketData, params: Params, ctx: ScanContext): Signal;
  /** Optional cross-sectional pass after every asset has been scanned (e.g. percentile ranks). */
  finalize?(signals: Signal[], params: Params): void;
}
