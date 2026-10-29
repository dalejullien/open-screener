import { atr } from "./indicators";
import type { Candle, Level } from "./types";

/**
 * Structure-based stop: just under the most recent confirmed 4h swing low (with a 0.25× 4h ATR
 * buffer against wicks), used when it's tighter than the fallback of 2× daily ATR below the close.
 * The 3 most recent 4h bars are excluded so the low is a confirmed pivot, not the current bar.
 */
export function structureStop(daily: Candle[], h4: Candle[]): number {
  const close = daily[daily.length - 1].close;
  const atrStop = close - 2 * atr(daily);
  const window = h4.slice(-33, -3);
  if (!window.length) return atrStop;
  const swing = Math.min(...window.map((c) => c.low)) - 0.25 * atr(h4);
  return swing < close && swing > atrStop ? swing : atrStop;
}

/** Example long levels: entry, stop, and targets at fixed R multiples. */
export function longPlan(entry: number, stop: number, rMultiples = [1.5, 3]): Level[] {
  if (!(stop < entry)) return [];
  const r = entry - stop;
  return [
    { price: entry, label: "Entry", kind: "entry" },
    { price: stop, label: "Stop", kind: "stop" },
    ...rMultiples.map((m, i) => ({ price: entry + m * r, label: `T${i + 1} ${m}R`, kind: "target" as const })),
  ];
}

/** Position size for a fixed % of account risked between entry and stop. */
export function positionSize(account: number, riskPct: number, entry: number, stop: number) {
  const riskAmount = (account * riskPct) / 100;
  const perUnit = entry - stop;
  if (!(perUnit > 0) || !(account > 0)) return null;
  const units = riskAmount / perUnit;
  return { riskAmount, units, notional: units * entry, pctOfAccount: ((units * entry) / account) * 100 };
}
