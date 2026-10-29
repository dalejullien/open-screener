import { useState, type ReactNode } from "react";
import type { Direction, Status } from "../lib/types";
import { ACTION_LABEL, type Action } from "../lib/action";

export const STATUS_LABEL: Record<Status, string> = {
  trigger: "Trigger",
  pass: "Pass",
  near: "Near miss",
  fail: "Fail",
};
const STATUS_ICON: Record<Status, string> = { trigger: "⚡", pass: "✓", near: "◐", fail: "✕" };
const DIR_LABEL: Record<Direction, string> = { bullish: "Bullish", bearish: "Bearish", neutral: "Undecided" };

/** Status always ships with icon + label, never color alone. */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      {STATUS_ICON[status]} {STATUS_LABEL[status]}
    </span>
  );
}

export function StateLine({ status, direction, right }: { status: Status; direction: Direction; right?: ReactNode }) {
  return (
    <div className="state-line">
      <span className={`dot ${status}`} />
      <span className={`st ${status}`}>{STATUS_LABEL[status]}</span>
      <span className={`dir ${direction}`}>· {DIR_LABEL[direction]}</span>
      {right && <span className="right">{right}</span>}
    </div>
  );
}

/** Where the coin trades: Spot, Perp, or both. */
export function MarketTags({ markets }: { markets: ("spot" | "perp")[] }) {
  return (
    <span className="mkts">
      {markets.map((m) => (
        <span key={m} className={`mkt ${m}`}>
          {m === "spot" ? "Spot" : "Perp"}
        </span>
      ))}
    </span>
  );
}

export function Avatar({ base, src }: { base: string; src?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img className="avatar logo" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="avatar" style={{ background: `hsl(${h} 45% 92%)`, color: `hsl(${h} 45% 32%)` }}>
      {base.slice(0, 1)}
    </span>
  );
}

export function Pills<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="pills">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, sub, value, tone }: { label: string; sub: string; value: number | string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="kpi">
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-sub">{sub}</div>
      </div>
      <div className={`kpi-value ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

const ACTION_ICON: Record<Action, string> = { enter: "●", wait: "◔", extended: "▲", invalid: "○" };

/** What to do now — always icon + label, never color alone. */
export function ActionBadge({ action, big }: { action: Action; big?: boolean }) {
  return (
    <span className={`act act-${action}${big ? " big" : ""}`}>
      {ACTION_ICON[action]} {ACTION_LABEL[action]}
    </span>
  );
}
