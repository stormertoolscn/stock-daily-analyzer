import type { KlineTheme } from "./types";
import { THS_MA_LINES_12, THS_VOL_MA_LINES } from "./maDefaults";

export { THS_MA_LINES, THS_MA_LINES_12, THS_VOL_MA_LINES } from "./maDefaults";

/**
 * 读取当前页面 CSS 变量（--color-up / --color-down 等），使 K线配色
 * 自动跟随 MainLayout 的主题切换，而不是在引擎里写死颜色。
 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** A股标准主题：红涨绿跌、实心柱体 + 同花顺远航版均线/量能线。 */
export function getAShareTheme(): KlineTheme {
  const up = cssVar("--color-up", "#f5222d");
  const down = cssVar("--color-down", "#16a34a");
  return {
    upColor: up,
    downColor: down,
    upBorderColor: up,
    downBorderColor: down,
    volumeUpColor: up,
    volumeDownColor: down,
    candleStyle: "solid",
    maLines: THS_MA_LINES_12.map((line) => ({ ...line })),
    volMaLines: THS_VOL_MA_LINES.map((line) => ({ ...line })),
    macdDifColor: "#b06cf0",
    macdDeaColor: "#6b7a99",
    axisPointerBg: "#3d4450",
    textColor: cssVar("--color-text", "#1f2329"),
    mutedTextColor: cssVar("--color-text-muted", "#6b7280"),
    splitLineColor: cssVar("--color-border", "#e8ebf0"),
    backgroundColor: "transparent",
  };
}
