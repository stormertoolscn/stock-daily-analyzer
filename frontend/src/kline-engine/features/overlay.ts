/**
 * 把 BarFeatureTags 转成 ECharts candlestick itemStyle / markPoint / 叠加矩形。
 *
 * 涨停/倍量涨停配色对照通达信常见公式色：
 * - 涨停体 COLOR6910A3，底部黄头
 * - 倍量涨停：紫体 + 亮黄粗边框 + 黄头（截图中黄框紫柱）
 */
import type { KlineBar } from "../types";
import type { BarFeatureTags } from "./detect";

/** 通达信公式色（勿用主题涨跌红绿替代板标记） */
export const FEATURE_COLORS = {
  /** COLOR6910A3 涨停紫 */
  limitUp: "#6910A3",
  /** 跌停深绿 */
  limitDown: "#296406",
  /** 倍量涨停实体仍用紫 */
  volLimitUp: "#6910A3",
  /** 倍量涨停亮黄外框 COLORFFFF00 */
  volLimitUpBorder: "#FFFF00",
  /** 黄头 STICKLINE */
  limitTip: "#FFFF00",
  /** 破板绿 */
  breakBox: "#00C000",
  yize: "#FF00FF",
  pierce: "#FFFF00",
  alignBull: "#FF00FF",
  alignBear: "#00C000",
} as const;

export interface FeaturePaintRect {
  date: string;
  y0: number;
  y1: number;
  fill: string;
  stroke: string;
  lineWidth: number;
  /** 占格子带宽的比例（0~1），默认 0.7（与现有 70% 宽一致） */
  widthRatio?: number;
}

export interface FeatureOverlayResult {
  candleData: Array<
    | [number, number, number, number]
    | {
        value: [number, number, number, number];
        itemStyle: {
          color: string;
          color0: string;
          borderColor: string;
          borderColor0: string;
          borderWidth?: number;
        };
      }
  >;
  markPointData: Array<{
    name: string;
    coord: [string, number];
    value: string;
    itemStyle: { color: string };
    label: {
      show: boolean;
      formatter: string;
      color: string;
      fontSize: number;
      position: "top" | "bottom" | "inside";
      distance?: number;
      fontWeight?: "normal" | "bold";
    };
    symbol: string;
    symbolSize: number;
  }>;
  paintRects: FeaturePaintRect[];
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pushLabel(
  out: FeatureOverlayResult["markPointData"],
  date: string,
  price: number,
  text: string,
  color: string,
  position: "top" | "bottom" = "top",
) {
  out.push({
    name: text,
    coord: [date, price],
    value: text,
    itemStyle: { color },
    label: {
      show: true,
      formatter: text,
      color,
      fontSize: 11,
      fontWeight: "bold",
      position,
      distance: position === "top" ? 4 : 6,
    },
    symbol: position === "top" ? "triangle" : "none",
    symbolSize: position === "top" ? 8 : 0,
  });
}

/** 实体底部黄头（通达信涨停/倍量涨停 STICKLINE） */
function pushYellowTip(
  paintRects: FeaturePaintRect[],
  date: string,
  bar: KlineBar,
  ratio = 0.22,
) {
  const span = bar.close - bar.open;
  if (Math.abs(span) < 1e-8) return;
  paintRects.push({
    date,
    y0: bar.open,
    y1: bar.open + span * ratio,
    fill: FEATURE_COLORS.limitTip,
    stroke: FEATURE_COLORS.limitTip,
    lineWidth: 0,
  });
}

/** 紫色实体：宽度 = 蜡烛宽度的 2/3（蜡烛宽 68% → 带宽约 45.33%） */
const PURPLE_BODY_WIDTH_RATIO = (68 / 100) * (2 / 3);

/** 涨停/倍量涨停紫色实体（比 K 线本体窄 1/3） */
function pushPurpleBody(
  paintRects: FeaturePaintRect[],
  date: string,
  bar: KlineBar,
) {
  const y0 = Math.min(bar.open, bar.close);
  const y1 = Math.max(bar.open, bar.close);
  if (Math.abs(y1 - y0) < 1e-8) return; // 一字板无实体，跳过
  paintRects.push({
    date,
    y0,
    y1,
    fill: FEATURE_COLORS.limitUp,
    stroke: FEATURE_COLORS.limitUp,
    lineWidth: 0,
    widthRatio: PURPLE_BODY_WIDTH_RATIO,
  });
}

export interface BuildFeatureOverlayOptions {
  /**
   * 是否展示日线级涨跌停/破板类标注与着色。
   * 周 K、月 K 及以上应设为 false，避免把日线概念套到更高周期。
   * 默认 true。
   */
  includeDailyLimitHints?: boolean;
}

export function buildFeatureOverlay(
  bars: KlineBar[],
  tags: BarFeatureTags[],
  _theme: { upColor: string; downColor: string },
  options?: BuildFeatureOverlayOptions,
): FeatureOverlayResult {
  const includeDaily = options?.includeDailyLimitHints !== false;
  const candleData: FeatureOverlayResult["candleData"] = [];
  const markPointData: FeatureOverlayResult["markPointData"] = [];
  const paintRects: FeaturePaintRect[] = [];
  const last = bars.length - 1;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const t = tags[i];
    const date = formatDate(bar.timestamp);
    const ohlc: [number, number, number, number] = [
      bar.open,
      bar.close,
      bar.low,
      bar.high,
    ];
    const bodyLo = Math.min(bar.open, bar.close);
    const bodyHi = Math.max(bar.open, bar.close);
    const body = Math.max(bodyHi - bodyLo, (bar.high - bar.low) * 0.05);

    if (includeDaily && t.volLimitUp) {
      // 倍量涨停：紫体 + 亮黄粗框（对照通达信截图黄框紫柱）
      candleData.push({
        value: ohlc,
        itemStyle: {
          color: "rgba(0,0,0,0)",
          color0: "rgba(0,0,0,0)",
          borderColor: FEATURE_COLORS.volLimitUpBorder,
          borderColor0: FEATURE_COLORS.volLimitUpBorder,
          borderWidth: 3,
        },
      });
      pushPurpleBody(paintRects, date, bar);
      pushYellowTip(paintRects, date, bar, 0.26);
      pushLabel(
        markPointData,
        date,
        bar.high,
        "倍量涨停",
        FEATURE_COLORS.volLimitUpBorder,
      );
    } else if (includeDaily && t.limitUp) {
      // 涨停：紫色实心 + 底部黄头
      candleData.push({
        value: ohlc,
        itemStyle: {
          color: "rgba(0,0,0,0)",
          color0: "rgba(0,0,0,0)",
          borderColor: FEATURE_COLORS.limitUp,
          borderColor0: FEATURE_COLORS.limitUp,
          borderWidth: 1,
        },
      });
      pushPurpleBody(paintRects, date, bar);
      pushYellowTip(paintRects, date, bar, 0.22);
      pushLabel(markPointData, date, bar.high, "涨停", FEATURE_COLORS.limitUp);
    } else if (includeDaily && t.limitDown) {
      candleData.push({
        value: ohlc,
        itemStyle: {
          color: FEATURE_COLORS.limitDown,
          color0: FEATURE_COLORS.limitDown,
          borderColor: FEATURE_COLORS.limitDown,
          borderColor0: FEATURE_COLORS.limitDown,
          borderWidth: 1.5,
        },
      });
      pushLabel(markPointData, date, bar.low, "跌停", FEATURE_COLORS.limitDown, "bottom");
    } else {
      candleData.push(ohlc);
    }

    if (includeDaily && t.breakUp) {
      const tip = Math.max(
        (bar.high - bar.low) * 0.08,
        body * 0.14,
        Math.abs(bar.close - bar.open) * 0.12 || body * 0.1,
      );
      paintRects.push({
        date,
        y0: bodyHi - tip,
        y1: bodyHi,
        fill: "rgba(0,0,0,0)",
        stroke: FEATURE_COLORS.breakBox,
        lineWidth: 1.25,
      });
      pushLabel(markPointData, date, bar.high, "破板", FEATURE_COLORS.breakBox);
    }
    if (includeDaily && t.breakDown) {
      const tip = Math.max(
        (bar.high - bar.low) * 0.08,
        body * 0.14,
        Math.abs(bar.close - bar.open) * 0.12 || body * 0.1,
      );
      paintRects.push({
        date,
        y0: bodyLo,
        y1: bodyLo + tip,
        fill: "rgba(0,0,0,0)",
        stroke: FEATURE_COLORS.breakBox,
        lineWidth: 1.25,
      });
      pushLabel(markPointData, date, bar.low, "开板", FEATURE_COLORS.breakBox, "bottom");
    }

    if (t.yizeWash) {
      pushLabel(markPointData, date, bar.high * 1.008, "壹泽洗", FEATURE_COLORS.yize);
    }

    if (includeDaily && t.pierceOpen) {
      const n = Math.max(6, t.pierceCount);
      pushLabel(
        markPointData,
        date,
        bar.high * 1.015,
        `阳${n}线开`,
        FEATURE_COLORS.pierce,
      );
    }

    if (i === last) {
      if (t.bullAlign) {
        pushLabel(markPointData, date, bar.low, "多头排列", FEATURE_COLORS.alignBull, "bottom");
      } else if (t.bearAlign) {
        pushLabel(markPointData, date, bar.low, "空头排列", FEATURE_COLORS.alignBear, "bottom");
      }
    }
  }

  return { candleData, markPointData, paintRects };
}
