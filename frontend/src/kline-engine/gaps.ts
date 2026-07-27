import type { KlineBar } from "./types";

export type GapDirection = "up" | "down";

/** 相邻两根 K 线之间的价格缺口 */
export interface PriceGap {
  /** 缺口右侧 K 线下标（当前根） */
  index: number;
  /** 缺口下沿价 */
  low: number;
  /** 缺口上沿价 */
  high: number;
  direction: GapDirection;
}

/**
 * 检测跳空缺口（同花顺「显示缺口」）：
 * - 向上跳空：今日最低 > 昨最高
 * - 向下跳空：今日最高 < 昨最低
 */
export function detectPriceGaps(bars: KlineBar[]): PriceGap[] {
  const gaps: PriceGap[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (cur.low > prev.high) {
      gaps.push({
        index: i,
        low: prev.high,
        high: cur.low,
        direction: "up",
      });
    } else if (cur.high < prev.low) {
      gaps.push({
        index: i,
        low: cur.high,
        high: prev.low,
        direction: "down",
      });
    }
  }
  return gaps;
}
