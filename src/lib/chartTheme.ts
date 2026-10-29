/** Chart colors come from the CSS variables, so light/dark and future brand themes stay in one place. */
export interface ChartTheme {
  surface: string;
  ink: string;
  ink2: string;
  grid: string;
  good: string;
  bad: string;
  series: string[];
}

export function readTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    surface: v("--surface"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    grid: v("--grid"),
    good: v("--good"),
    bad: v("--bad"),
    series: [v("--series-1"), v("--series-2"), v("--series-3")],
  };
}
