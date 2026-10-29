import { fmtPct, fmtPrice } from "./format";
import type { Signal } from "./types";

export type Action = "enter" | "wait" | "extended" | "invalid";

export const ACTION_LABEL: Record<Action, string> = {
  enter: "Triggered",
  wait: "Forming",
  extended: "Extended",
  invalid: "Invalidated",
};

/**
 * Research state derived from the setup's own levels and the live price:
 * Triggered — trigger fired, price is close to the reference level and risk is bounded.
 * Forming — setup forming / trigger pending.
 * Extended — triggered but price already ran too far from the reference level.
 * Invalidated — price is at or below the stop.
 * Long setups only; returns null when a signal has no entry/stop.
 */
export function actionFor(sig: Signal, price: number, detectPrice?: number): { action: Action; text: string } | null {
  const entry = sig.levels.find((l) => l.kind === "entry");
  const stop = sig.levels.find((l) => l.kind === "stop");
  if (!entry || !stop || sig.direction === "bearish" || sig.status === "fail") return null;
  if (price <= stop.price) return { action: "invalid", text: `Price is below the stop (${fmtPrice(stop.price)})` };
  const risk = entry.price - stop.price;
  if (!(risk > 0)) return null;
  const pending = entry.label === "Buy above";
  if (sig.status === "trigger" && !pending) {
    const retestPrice = typeof sig.meta?.retestPrice === "number" ? sig.meta.retestPrice : undefined;
    const maxEntryPrice = typeof sig.meta?.maxEntryPrice === "number" ? sig.meta.maxEntryPrice : undefined;
    if (maxEntryPrice && price > maxEntryPrice) {
      const extension = retestPrice ? (price / retestPrice - 1) * 100 : (price / entry.price - 1) * 100;
      return {
        action: "extended",
        text: retestPrice
          ? `Breakout is ${fmtPct(extension)} above the level — wait for a retest near ${fmtPrice(retestPrice)}`
          : `Price is ${fmtPct(extension)} beyond the acceptable entry — wait for a pullback`,
      };
    }
    // Measure the run from where the setup first fired (if known), not just from the last close.
    const ref = detectPrice && detectPrice < entry.price ? detectPrice : entry.price;
    const run = (price - ref) / risk;
    const stopPct = (1 - stop.price / price) * 100;
    const priceExtensionPct = (price / entry.price - 1) * 100;
    if (run > 0.5 || priceExtensionPct > 3) {
      return { action: "extended", text: `Already ${fmtPct(priceExtensionPct)} above the planned entry — wait for a pullback` };
    }
    if (stopPct > 12) {
      return { action: "extended", text: `Stop is ${fmtPct(stopPct)} below market — wait for a tighter entry` };
    }
    return {
      action: "enter",
      text: `Trigger ~${fmtPrice(entry.price)} · invalidation ${fmtPrice(stop.price)} (${fmtPct(-stopPct)})`,
    };
  }
  if (pending) {
    return price >= entry.price
      ? { action: "wait", text: `Trigger pending — needs a close above ${fmtPrice(entry.price)}` }
      : { action: "wait", text: `Set an alert at ${fmtPrice(entry.price)} (${fmtPct((entry.price / price - 1) * 100)} away)` };
  }
  return { action: "wait", text: "Setup in place — waiting for the trigger" };
}
