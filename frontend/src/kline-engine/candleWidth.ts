/**
 * 通达信风格 K 线柱宽（像素级）。
 *
 * 对照桌面通达信「约 20 根」窗口：
 * - 柱体约占类目带宽 ~68%（柱:缝 ≈ 2:1，约 10–12px 柱 / 4–6px 缝）
 * - 拉窄极限 1px；拉宽封顶约 24px（避免 20 根时被过早卡死）
 * - ≥3px 取奇数宽，便于 1px 影线居中
 */

export const TDX_CANDLE = {
  /** 柱体 / 类目带宽（对照 20 根视图约 2:1） */
  bodyRatio: 0.68,
  minPx: 1,
  maxPx: 24,
  /** 估算主图可用宽度时的回退值（无容器尺寸时） */
  fallbackPlotWidth: 860,
  /** 主图左右留白（与 engine grid left/right 对齐） */
  gridLeftPx: 4,
  gridRightPx: 48,
} as const;

/** 将宽度收到奇数像素（1 保持 1；2→3） */
export function snapOddPx(width: number): number {
  const n = Math.round(width);
  if (n <= 1) return 1;
  if (n % 2 === 1) return n;
  return n + 1;
}

/**
 * 由单根类目带宽（px）得到柱体宽。
 */
export function candleWidthFromBand(bandWidthPx: number): number {
  if (!(bandWidthPx > 0)) return TDX_CANDLE.minPx;
  const raw = bandWidthPx * TDX_CANDLE.bodyRatio;
  const clamped = Math.max(
    TDX_CANDLE.minPx,
    Math.min(TDX_CANDLE.maxPx, raw),
  );
  if (clamped < 2.2) return 1;
  return Math.min(TDX_CANDLE.maxPx, snapOddPx(clamped));
}

export interface TdxBarWidths {
  candle: number;
  volume: number;
  macd: number;
  /** 估算用的可见根数 */
  visibleCount: number;
  bandWidth: number;
}

/**
 * 按可见窗口与绘图区宽度计算通达信风格柱宽。
 * zoomStart/End 为 dataZoom 百分比 0–100。
 */
export function resolveTdxBarWidths(params: {
  barCount: number;
  zoomStart?: number;
  zoomEnd?: number;
  /** 整图容器宽度（含左右空白） */
  containerWidth?: number;
}): TdxBarWidths {
  const n = Math.max(1, params.barCount);
  const z0 = params.zoomStart ?? 0;
  const z1 = params.zoomEnd ?? 100;
  const span = Math.max(0.5, Math.min(100, z1 - z0));
  const visibleCount = Math.max(1, Math.ceil((n * span) / 100));

  const container =
    params.containerWidth && params.containerWidth > 40
      ? params.containerWidth
      : TDX_CANDLE.fallbackPlotWidth;
  const plotWidth = Math.max(
    40,
    container - TDX_CANDLE.gridLeftPx - TDX_CANDLE.gridRightPx,
  );
  const bandWidth = plotWidth / visibleCount;
  const candle = candleWidthFromBand(bandWidth);
  // 量柱与 K 线同宽；MACD 略细但保持奇数
  const volume = candle;
  const macd =
    candle <= 1 ? 1 : Math.min(candle, snapOddPx(Math.max(1, candle * 0.55)));

  return { candle, volume, macd, visibleCount, bandWidth };
}
