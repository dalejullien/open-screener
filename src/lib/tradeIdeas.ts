import { SCANNERS } from "../scanners";
import { actionFor } from "./action";
import type { BacktestResult } from "./backtest";
import type { History } from "./replay";
import type { MarketData, Scanner, Signal } from "./types";

/** Page descriptor so Research Setups reuses the standard list/detail view. */
export const tradeIdeasTool: Scanner = {
  id: "ideas",
  name: "Research Setups",
  tagline: "Ranked market setups from every tool, strongest evidence first.",
  icon: "◎",
  params: [],
  methodology: `Collects every long setup across all tools whose state is Triggered (trigger fired, price no more than 3% beyond the reference level, invalidation no wider than 12%, and within the strategy's zone) or Forming with a concrete trigger price.
One setup per coin: Triggered ranks ahead of Forming; ties go to the tool with the better backtest (average R per trade).
Rank = state (Triggered first) + the tool's backtested average R + 5 points for each other tool also firing on that coin (confluence).
Run a backtest to make the ranking evidence-based; without one, tools are treated equally.`,
  run() {
    throw new Error("Research Setups is assembled from the other tools");
  },
};

export function buildIdeas(
  results: Map<string, Signal[]>,
  bySymbol: Map<string, MarketData>,
  backtests: Record<string, BacktestResult>,
  history: Map<string, Map<string, History>>,
): Signal[] {
  const best = new Map<string, { sig: Signal; tool: Scanner; rank: number; hits: number; edge: number; action: "enter" | "wait" }>();
  const hits = new Map<string, number>();
  for (const s of SCANNERS) for (const sig of results.get(s.id) ?? []) {
    if ((sig.status === "trigger" || sig.status === "pass") && sig.direction !== "bearish") hits.set(sig.symbol, (hits.get(sig.symbol) ?? 0) + 1);
  }
  for (const tool of SCANNERS) {
    const edge = backtests[tool.id]?.stats.avgR ?? 0;
    for (const sig of results.get(tool.id) ?? []) {
      const d = bySymbol.get(sig.symbol);
      const a = d && actionFor(sig, d.asset.price, history.get(tool.id)?.get(sig.symbol)?.priceAtDetect);
      if (!a || (a.action !== "enter" && a.action !== "wait")) continue;
      // Only waits with a concrete trigger price to set an alert at — not vague "setup in place".
      if (a.action === "wait" && sig.levels.find((l) => l.kind === "entry")?.label !== "Buy above") continue;
      const h = hits.get(sig.symbol) ?? 1;
      const rank = (a.action === "enter" ? 100 : 50) + edge * 20 + (h - 1) * 5 + sig.score / 20;
      const cur = best.get(sig.symbol);
      if (!cur || rank > cur.rank) best.set(sig.symbol, { sig, tool, rank, hits: h, edge, action: a.action });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.rank - a.rank || b.sig.score - a.sig.score || a.sig.symbol.localeCompare(b.sig.symbol))
    .map(({ sig, tool, rank, hits: h, edge, action }, index) => ({
      ...sig,
      score: Math.min(100, rank / 1.6),
      headline: `${tool.icon} ${tool.name} · ${sig.headline}${h > 1 ? ` · ${h} tools agree` : ""}`,
      meta: {
        ...sig.meta,
        toolId: tool.id,
        toolName: tool.name,
        ideaRank: index + 1,
        ideaRankScore: rank,
        ideaAction: action,
        ideaEdge: edge,
        ideaConfluence: h,
      },
    }));
}
