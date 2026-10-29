import type { IChartApi } from "lightweight-charts";
import { readTheme } from "./chartTheme";
import { APP_NAME } from "../config";

interface CardInput {
  chart: IChartApi;
  ticker: string;
  title: string;
  status: string;
  price: string;
  change: string;
  metrics: { label: string; value: string }[];
}

/** Compose a 1600×900 share image (X's preferred 16:9) from the live chart + key numbers. */
export function renderShareCard(c: CardInput): HTMLCanvasElement {
  const t = readTheme();
  const W = 1600;
  const H = 900;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const font = (w: number, s: number) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Inter", sans-serif`;

  g.fillStyle = t.surface;
  g.fillRect(0, 0, W, H);

  g.fillStyle = t.ink;
  g.font = font(700, 56);
  g.fillText(c.ticker, 64, 104);
  g.font = font(500, 34);
  g.fillStyle = t.ink2;
  g.fillText(c.title, 64, 156);

  g.textAlign = "right";
  g.fillStyle = t.ink;
  g.font = font(600, 52);
  g.fillText(c.price, W - 64, 104);
  g.font = font(500, 28);
  g.fillStyle = c.change.startsWith("-") ? t.bad : t.good;
  g.fillText(`${c.change} 24h · ${c.status}`, W - 64, 150);
  g.textAlign = "left";

  const shot = c.chart.takeScreenshot();
  const chartTop = 196;
  const chartH = 560;
  const scale = Math.min((W - 128) / shot.width, chartH / shot.height);
  g.drawImage(shot, 64, chartTop, shot.width * scale, shot.height * scale);

  let x = 64;
  const y = 812;
  for (const m of c.metrics.slice(0, 4)) {
    g.font = font(500, 22);
    g.fillStyle = t.ink2;
    g.fillText(m.label.toUpperCase(), x, y);
    g.font = font(600, 30);
    g.fillStyle = t.ink;
    g.fillText(m.value, x, y + 38);
    x += 300;
  }

  g.textAlign = "right";
  g.font = font(600, 24);
  g.fillStyle = t.ink;
  g.fillText(APP_NAME, W - 64, y);
  g.font = font(500, 18);
  g.fillStyle = t.ink2;
  g.fillText("Daily closes · Research only · Not financial advice", W - 64, y + 36);
  return cv;
}
