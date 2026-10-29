import { useEffect, useState } from "react";
import { closes, ema, last } from "./indicators";
import type { MarketData, Signal } from "./types";

export type JournalOutcome = "open" | "target" | "stop" | "invalid";
export type LiquidityGroup = "Liquid Core" | "Emerging" | "Low Cap / High Risk";

export interface ForwardRecord {
  id: string;
  symbol: string;
  toolId: string;
  toolName: string;
  detectedAt: number;
  rank: number;
  action: string;
  score: number;
  btcRegime: string;
  liquidity: LiquidityGroup;
  marketCap?: number;
  quoteVolume: number;
  entry: number;
  stop: number;
  target?: number;
  initialPrice: number;
  latestPrice: number;
  mfePct: number;
  maePct: number;
  outcome: JournalOutcome;
  resultR?: number;
  updatedAt: number;
}

const KEY = "os.forwardJournal.v1";

function read(): ForwardRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as ForwardRecord[];
  } catch {
    return [];
  }
}

function liquidity(d: MarketData): LiquidityGroup {
  const cap = d.asset.mcap ?? d.asset.fdv;
  if ((cap ?? 0) >= 300_000_000 && d.asset.quoteVolume >= 20_000_000) return "Liquid Core";
  if ((cap ?? 0) >= 50_000_000 && d.asset.quoteVolume >= 5_000_000) return "Emerging";
  return "Low Cap / High Risk";
}

function btcRegime(btc?: MarketData) {
  if (!btc) return "Unknown";
  const c = closes(btc.daily);
  const e50 = last(ema(c, 50));
  if (e50 === null || c.length < 8) return "Unknown";
  const ret7 = (last(c) / c[c.length - 8] - 1) * 100;
  if (last(c) > e50 && ret7 > 2) return "Trending up";
  if (last(c) < e50 && ret7 < -2) return "Risk-off";
  return "Uncertain / range";
}

function updateOutcome(r: ForwardRecord, d: MarketData): ForwardRecord {
  const future = d.h4.filter((c) => c.time >= r.detectedAt);
  let high = r.initialPrice;
  let low = r.initialPrice;
  let outcome = r.outcome;
  let resultR = r.resultR;
  const risk = r.entry - r.stop;
  if (outcome === "open" && risk > 0) {
    for (const bar of future) {
      high = Math.max(high, bar.high);
      low = Math.min(low, bar.low);
      if (bar.low <= r.stop) {
        outcome = "stop";
        resultR = -1;
        break;
      }
      if (r.target && bar.high >= r.target) {
        outcome = "target";
        resultR = (r.target - r.entry) / risk;
        break;
      }
    }
  } else {
    for (const bar of future) {
      high = Math.max(high, bar.high);
      low = Math.min(low, bar.low);
    }
  }
  const latestPrice = d.asset.price;
  high = Math.max(high, latestPrice);
  low = Math.min(low, latestPrice);
  return {
    ...r,
    latestPrice,
    mfePct: (high / r.initialPrice - 1) * 100,
    maePct: (low / r.initialPrice - 1) * 100,
    outcome,
    resultR,
    updatedAt: Date.now(),
  };
}

/** Persistent, append-only snapshots of first-seen Research Setups. Data stays in this browser. */
export function useForwardJournal(ideas: Signal[], bySymbol: Map<string, MarketData>) {
  const [records, setRecords] = useState<ForwardRecord[]>(read);

  useEffect(() => {
    if (!ideas.length || !bySymbol.size) return;
    const btc = [...bySymbol.values()].find((d) => d.asset.base === "BTC");
    const regime = btcRegime(btc);
    setRecords((previous) => {
      const next = previous.map((r) => {
        const d = bySymbol.get(r.symbol);
        return d ? updateOutcome(r, d) : r;
      });
      const ids = new Set(next.map((r) => r.id));
      for (const sig of ideas) {
        const d = bySymbol.get(sig.symbol);
        const bar = d && last(d.daily);
        const entry = sig.levels.find((l) => l.kind === "entry")?.price;
        const stop = sig.levels.find((l) => l.kind === "stop")?.price;
        const target = sig.levels.find((l) => l.kind === "target")?.price;
        const toolId = String(sig.meta?.toolId ?? "unknown");
        if (!d || !bar || entry === undefined || stop === undefined || !(entry > stop)) continue;
        const detectedAt = bar.time + d.tf.primarySec;
        const id = `${toolId}:${sig.symbol}:${detectedAt}`;
        if (ids.has(id)) continue;
        next.push({
          id,
          symbol: sig.symbol,
          toolId,
          toolName: String(sig.meta?.toolName ?? toolId),
          detectedAt,
          rank: Number(sig.meta?.ideaRank ?? 0),
          action: String(sig.meta?.ideaAction ?? sig.status),
          score: sig.score,
          btcRegime: regime,
          liquidity: liquidity(d),
          marketCap: d.asset.mcap ?? d.asset.fdv ?? undefined,
          quoteVolume: d.asset.quoteVolume,
          entry,
          stop,
          target,
          initialPrice: d.asset.price,
          latestPrice: d.asset.price,
          mfePct: 0,
          maePct: 0,
          outcome: "open",
          updatedAt: Date.now(),
        });
        ids.add(id);
      }
      const trimmed = next.sort((a, b) => b.detectedAt - a.detectedAt).slice(0, 5000);
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      return trimmed;
    });
  }, [ideas, bySymbol]);

  return records;
}
