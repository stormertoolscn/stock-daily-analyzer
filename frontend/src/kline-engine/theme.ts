import type { KlineTheme } from "./types";

/**
 * 读取当前页面 CSS 变量（--color-up / --color-down 等），使 K线配色
 * 自动跟随 MainLayout 的 5 套主题切换，而不是在引擎里写死颜色。
 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** A股标准主题：红涨绿跌、实心柱体。 */
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
  };
}
