export const fmtPrice = (p: number) =>
  !isFinite(p) ? "–" : p >= 100 ? p.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p >= 1 ? p.toFixed(3) : p.toPrecision(4);

export const fmtPct = (v: number, digits = 1) => (!isFinite(v) ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`);

export const fmtVol = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${(v / 1e3).toFixed(0)}K`;

export const fmtX = (v: number) => (!isFinite(v) ? "–" : `${v.toFixed(2)}×`);

export const fmtDate = (t: number) =>
  new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Date for daily+ bars, date and hour for intraday bars. */
export const fmtBarTime = (t: number, barSec: number) =>
  barSec >= 86_400
    ? fmtDate(t)
    : new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
