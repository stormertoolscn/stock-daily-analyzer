import type { KlineBar } from "./types";

/** 单个价格筹码桶 */
export interface ChipBin {
  /** 桶中心价 */
  price: number;
  /** 相对筹码量（已归一化前的原始量） */
  volume: number;
}

export interface ChipDistribution {
  bins: ChipBin[];
  /** 价格桶步长（与 bins[].price 间距一致） */
  step: number;
  /** 平均成本 */
  avgCost: number;
  /** 获利比例 0-1（成本低于现价） */
  profitRatio: number;
  /** 现价 */
  close: number;
  /** 总筹码量 */
  totalVolume: number;
  asOfIndex: number;
}

export interface ChipComputeOptions {
  /** 价格分桶数 */
  binCount?: number;
  /**
   * 每日衰减强度（相对换手）。
   * 当日量相对均量越大，旧筹码衰减越多。
   */
  decayScale?: number;
  /** 最大单日衰减比例 */
  maxDecay?: number;
}

/**
 * 计算截至 asOfIndex 日的筹码分布（简化三角分布 + 换手衰减）。
 * 用于同花顺风格右侧筹码峰。
 */
export function computeChipDistribution(
  bars: KlineBar[],
  asOfIndex: number,
  options: ChipComputeOptions = {},
): ChipDistribution | null {
  if (!bars.length || asOfIndex < 0 || asOfIndex >= bars.length) return null;

  const binCount = options.binCount ?? 240;
  const decayScale = options.decayScale ?? 0.12;
  const maxDecay = options.maxDecay ?? 0.28;

  const slice = bars.slice(0, asOfIndex + 1);
  let minP = Infinity;
  let maxP = -Infinity;
  for (const b of slice) {
    if (b.low < minP) minP = b.low;
    if (b.high > maxP) maxP = b.high;
  }
  if (!(maxP > minP)) {
    minP = slice[slice.length - 1].close * 0.98;
    maxP = slice[slice.length - 1].close * 1.02;
  }

  // 稍扩边距，避免贴边
  const pad = (maxP - minP) * 0.02 || maxP * 0.01;
  minP -= pad;
  maxP += pad;
  const step = (maxP - minP) / binCount;
  if (step <= 0) return null;

  const chips = new Float64Array(binCount);
  let volSum = 0;
  for (const b of slice) volSum += b.volume;
  const avgVol = volSum / slice.length || 1;

  for (const bar of slice) {
    const turn = Math.min(maxDecay, (bar.volume / avgVol) * decayScale);
    const keep = 1 - turn;
    for (let i = 0; i < binCount; i += 1) chips[i] *= keep;

    distributeTriangle(chips, minP, step, binCount, bar);
  }

  let total = 0;
  let costSum = 0;
  const close = slice[slice.length - 1].close;
  let profitVol = 0;
  const bins: ChipBin[] = [];

  for (let i = 0; i < binCount; i += 1) {
    const vol = chips[i];
    const price = minP + (i + 0.5) * step;
    bins.push({ price, volume: vol });
    total += vol;
    costSum += vol * price;
    if (price <= close) profitVol += vol;
  }

  if (total <= 0) return null;

  return {
    bins,
    step,
    avgCost: costSum / total,
    profitRatio: profitVol / total,
    close,
    totalVolume: total,
    asOfIndex,
  };
}

/** 把当日成交量按尖峰三角铺到 [low, high]，峰值在 close（火焰山尖峰）。 */
function distributeTriangle(
  chips: Float64Array,
  minP: number,
  step: number,
  binCount: number,
  bar: KlineBar,
) {
  const low = Math.min(bar.low, bar.high, bar.open, bar.close);
  const high = Math.max(bar.low, bar.high, bar.open, bar.close);
  const close = Math.min(high, Math.max(low, bar.close));
  if (high <= low) {
    const idx = Math.min(
      binCount - 1,
      Math.max(0, Math.floor((close - minP) / step)),
    );
    chips[idx] += bar.volume;
    return;
  }

  const i0 = Math.max(0, Math.floor((low - minP) / step));
  const i1 = Math.min(binCount - 1, Math.floor((high - minP) / step));
  const peak = Math.min(i1, Math.max(i0, Math.floor((close - minP) / step)));

  let weightSum = 0;
  const weights = new Float64Array(i1 - i0 + 1);
  for (let i = i0; i <= i1; i += 1) {
    // 幂次 >1：更集中在收盘价附近，形成尖峰
    const base =
      i <= peak
        ? (i - i0 + 1) / (peak - i0 + 1)
        : (i1 - i + 1) / (i1 - peak + 1);
    const w = Math.max(0.02, base) ** 2.4;
    weights[i - i0] = w;
    weightSum += w;
  }
  if (weightSum <= 0) {
    chips[peak] += bar.volume;
    return;
  }
  for (let i = i0; i <= i1; i += 1) {
    chips[i] += (bar.volume * weights[i - i0]) / weightSum;
  }
  // 额外把约 35% 量砸到峰桶，强化尖峰
  const spike = bar.volume * 0.35;
  chips[peak] += spike;
}
