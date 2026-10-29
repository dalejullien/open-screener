import { describe, expect, it } from "vitest";
import { actionFor } from "./action";
import type { Signal } from "./types";

const signal = (status: Signal["status"] = "trigger", entry = 100, stop = 92): Signal => ({
  symbol: "TESTUSDT",
  status,
  direction: "bullish",
  score: 80,
  headline: "Test setup",
  reason: "Deterministic fixture",
  metrics: [],
  chart: { timeframe: "daily", overlays: [] },
  levels: [
    { price: entry, label: status === "pass" ? "Buy above" : "Entry", kind: "entry" },
    { price: stop, label: "Stop", kind: "stop" },
  ],
});

describe("actionFor", () => {
  it("marks a confirmed nearby setup as triggered", () => {
    expect(actionFor(signal(), 101)?.action).toBe("enter");
  });

  it("marks a late move as extended", () => {
    expect(actionFor(signal(), 105)?.action).toBe("extended");
  });

  it("marks a wide invalidation distance as extended", () => {
    expect(actionFor(signal("trigger", 100, 80), 100)?.action).toBe("extended");
  });

  it("keeps incomplete setups forming", () => {
    expect(actionFor(signal("pass"), 98)?.action).toBe("wait");
  });

  it("marks a broken setup invalid", () => {
    expect(actionFor(signal(), 91)?.action).toBe("invalid");
  });
});
