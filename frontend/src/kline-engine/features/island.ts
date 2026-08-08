/**
 * 岛型反转 / 大岛型反转（检测已按 O(n) 优化，避免缩放/重绘卡顿）
 *
 * —— 岛型反转（短岛）——
 * 两反向缺口价格带真实重合，且孤岛极值不进入重合带。
 *
 * —— 大岛型反转（瑜雅主图 §7）——
 * 向下跳空启动 → 孤岛未回补 → 向上跳空脱离；天数可达 1500。
 */
import type { KlineBar } from "../types";
import { detectPriceGaps, type PriceGap } from "../gaps";

export type IslandKind = "bottom" | "top";
export type IslandVariant = "island" | "bigIsland";

export interface IslandReversalMatch {
  kind: IslandKind;
  variant: IslandVariant;
  startIndex: number;
  endIndex: number;
  yLow: number;
  yHigh: number;
  gap1Index: number;
  gap2Index: number;
  days: number;
  overlapLow?: number;
  overlapHigh?: number;
}

export interface DetectIslandOptions {
  maxIslandBars?: number;
  requirePriorTrend?: boolean;
  trendLookback?: number;
}

export interface DetectBigIslandOptions {
  minDays?: number;
  maxDays?: number;
  maxMatches?: number;
}

function gapOverlapZone(
  a: PriceGap,
  b: PriceGap,
): { low: number; high: number } | null {
  const low = Math.max(a.low, b.low);
  const high = Math.min(a.high, b.high);
  if (!(high > low)) return null;
  return { low, high };
}

function rangeHighLow(
  bars: KlineBar[],
  start: number,
  end: number,
): { yLow: number; yHigh: number } {
  let yLow = Infinity;
  let yHigh = -Infinity;
  for (let i = start; i <= end; i += 1) {
    yLow = Math.min(yLow, bars[i].low);
    yHigh = Math.max(yHigh, bars[i].high);
  }
  return { yLow, yHigh };
}

function rangeOverlaps(
  a: IslandReversalMatch,
  b: IslandReversalMatch,
): boolean {
  return !(a.endIndex < b.startIndex || b.endIndex < a.startIndex);
}

function priorDownTrend(bars: KlineBar[], beforeIndex: number, lookback: number) {
  const end = beforeIndex - 1;
  const start = Math.max(0, end - lookback + 1);
  if (end - start < 3) return true;
  return bars[end].close <= bars[start].close * 1.01;
}

function priorUpTrend(bars: KlineBar[], beforeIndex: number, lookback: number) {
  const end = beforeIndex - 1;
  const start = Math.max(0, end - lookback + 1);
  if (end - start < 3) return true;
  return bars[end].close >= bars[start].close * 0.99;
}

/** 严格短岛；缺口对扫描，单段校验 O(岛长) */
export function detectIslandReversals(
  bars: KlineBar[],
  options?: DetectIslandOptions,
): IslandReversalMatch[] {
  if (bars.length < 5) return [];

  const maxIsland = options?.maxIslandBars ?? 40;
  const requireTrend = options?.requirePriorTrend !== false;
  const trendLb = options?.trendLookback ?? 8;
  const gaps = detectPriceGaps(bars);
  if (gaps.length < 2) return [];

  const found: IslandReversalMatch[] = [];

  for (let gi = 0; gi < gaps.length; gi += 1) {
    const g1 = gaps[gi];
    for (let gj = gi + 1; gj < gaps.length; gj += 1) {
      const g2 = gaps[gj];
      const islandLen = g2.index - g1.index;
      if (islandLen < 1) continue;
      if (islandLen > maxIsland) break; // 后续更远

      const overlap = gapOverlapZone(g1, g2);
      if (!overlap) continue;

      const islandEnd = g2.index - 1;
      let kind: IslandKind | null = null;
      if (g1.direction === "down" && g2.direction === "up") {
        if (!requireTrend || priorDownTrend(bars, g1.index, trendLb)) kind = "bottom";
      } else if (g1.direction === "up" && g2.direction === "down") {
        if (!requireTrend || priorUpTrend(bars, g1.index, trendLb)) kind = "top";
      }
      if (!kind) continue;

      let ok = true;
      for (let i = g1.index; i <= islandEnd; i += 1) {
        if (kind === "bottom") {
          if (bars[i].high > overlap.low) {
            ok = false;
            break;
          }
        } else if (bars[i].low < overlap.high) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const startIndex = Math.max(0, g1.index - 1);
      const endIndex = g2.index;
      const { yLow, yHigh } = rangeHighLow(bars, startIndex, endIndex);
      if (!(yHigh > yLow)) continue;

      found.push({
        kind,
        variant: "island",
        startIndex,
        endIndex,
        yLow,
        yHigh,
        gap1Index: g1.index,
        gap2Index: g2.index,
        days: endIndex - startIndex + 1,
        overlapLow: overlap.low,
        overlapHigh: overlap.high,
      });
    }
  }

  found.sort((a, b) => b.days - a.days || a.startIndex - b.startIndex);
  const kept: IslandReversalMatch[] = [];
  for (const m of found) {
    if (kept.some((k) => rangeOverlaps(k, m))) continue;
    kept.push(m);
  }
  return kept.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * 大岛型反转 — O(n)：对每个向下缺口递推维护孤岛 HHV/LLV，
 * 填补后立即放弃该缺口（不再二次扫描全岛）。
 */
export function detectBigIslandReversals(
  bars: KlineBar[],
  options?: DetectBigIslandOptions,
): IslandReversalMatch[] {
  const n = bars.length;
  if (n < 5) return [];

  const minDays = options?.minDays ?? 2;
  const maxDays = options?.maxDays ?? 1500;
  const maxMatches = options?.maxMatches ?? 8;

  const downGapDays: number[] = [];
  for (let i = 1; i < n; i += 1) {
    if (bars[i].high < bars[i - 1].low) downGapDays.push(i);
  }
  if (!downGapDays.length) return [];

  const found: IslandReversalMatch[] = [];

  for (const g1 of downGapDays) {
    if (g1 < 1) continue;
    const gapPrevLow = bars[g1 - 1].low;
    let islandHhv = bars[g1].high;
    let islandLlv = bars[g1].low;
    // 缺口当日已破缺口前低则不可能成岛
    if (!(islandHhv < gapPrevLow)) continue;

    const iMax = Math.min(n - 1, g1 + maxDays);
    for (let i = g1 + 1; i <= iMax; i += 1) {
      const tka = i - g1;
      // 用「截至 i-1」的孤岛极值做脱离判定
      if (tka >= minDays && bars[i].low > islandHhv && bars[i].low > bars[i - 1].high) {
        const startIndex = g1;
        const endIndex = i;
        const days = tka + 1;
        const yHigh = Math.max(islandHhv, bars[i].high);
        const yLow = Math.min(islandLlv, bars[i].low);
        found.push({
          kind: "bottom",
          variant: "bigIsland",
          startIndex,
          endIndex,
          yLow,
          yHigh,
          gap1Index: g1,
          gap2Index: i,
          days,
        });
        break;
      }

      // 把第 i 根并入孤岛，供下一根判定
      islandHhv = Math.max(islandHhv, bars[i].high);
      islandLlv = Math.min(islandLlv, bars[i].low);
      if (!(islandHhv < gapPrevLow)) break; // 已回补，该向下缺口作废
    }
  }

  found.sort((a, b) => b.days - a.days || a.startIndex - b.startIndex);
  const kept: IslandReversalMatch[] = [];
  for (const m of found) {
    if (kept.some((k) => rangeOverlaps(k, m))) continue;
    kept.push(m);
    if (kept.length >= maxMatches) break;
  }
  return kept.sort((a, b) => a.startIndex - b.startIndex);
}

export function detectAllIslandReversals(
  bars: KlineBar[],
): IslandReversalMatch[] {
  const big = detectBigIslandReversals(bars);
  const small = detectIslandReversals(bars);
  const kept = [...big];
  for (const m of small) {
    if (kept.some((k) => rangeOverlaps(k, m))) continue;
    kept.push(m);
  }
  return kept.sort((a, b) => a.startIndex - b.startIndex);
}

export function islandLabel(m: IslandReversalMatch): string {
  if (m.variant === "bigIsland") {
    return `大岛型反转：${m.days}天`;
  }
  return m.kind === "bottom"
    ? `岛型反转：${m.days}天`
    : `顶岛反转：${m.days}天`;
}

export const ISLAND_BOX_STYLE = {
  fill: "rgba(245, 215, 110, 0.12)",
  border: "rgba(201, 162, 39, 0.88)",
  borderWidth: 1,
  radius: 6,
  lineDash: [4, 3] as [number, number],
} as const;

export const BIG_ISLAND_BOX_STYLE = {
  fill: "rgba(0, 153, 255, 0.10)",
  border: "rgba(0, 153, 255, 0.90)",
  borderWidth: 1,
  radius: 6,
  lineDash: [5, 4] as [number, number],
} as const;
