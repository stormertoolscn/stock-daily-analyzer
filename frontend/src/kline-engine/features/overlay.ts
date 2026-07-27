/**
 * 把 BarFeatureTags 转成 ECharts candlestick itemStyle / markPoint / 叠加矩形。
 */
import type { KlineBar } from "../types";
import type { BarFeatureTags } from "./detect";

export const FEATURE_COLORS = {
  limitUp: "#6910A3",
  limitDown: "#296406",
  volLimitUp: "#e6a23c",
  limitTip: "#f5d76e",
  breakBox: "#16a34a",
  yize: "#d946ef",
  pierce: "#eab308",
  alignBull: "#d946ef",
  alignBear: "#16a34a",
} as const;

export interface FeaturePaintRect {
  date: string;
  y0: number;
  y1: number;
  fill: string;
  stroke: string;
  lineWidth: number;
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
      fontSize: 10,
      fontWeight: "bold",
      position,
      distance: 6,
    },
    symbol: position === "top" ? "triangle" : "none",
    symbolSize: position === "top" ? 7 : 0,
  });
}

export function buildFeatureOverlay(
  bars: KlineBar[],
  tags: BarFeatureTags[],
  _theme: { upColor: string; downColor: string },
): FeatureOverlayResult {
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

    if (t.volLimitUp) {
      candleData.push({
        value: ohlc,
        itemStyle: {
          color: FEATURE_COLORS.volLimitUp,
          color0: FEATURE_COLORS.volLimitUp,
          borderColor: FEATURE_COLORS.volLimitUp,
          borderColor0: FEATURE_COLORS.volLimitUp,
          borderWidth: 2,
        },
      });
      // 倍量涨停：实体下部黄条（通达信 STICKLINE 黄头）
      paintRects.push({
        date,
        y0: bar.open,
        y1: bar.open + (bar.close - bar.open) * 0.28,
        fill: FEATURE_COLORS.limitTip,
        stroke: FEATURE_COLORS.limitTip,
        lineWidth: 0,
      });
      pushLabel(markPointData, date, bar.high, "倍量涨停", FEATURE_COLORS.volLimitUp);
    } else if (t.limitUp) {
      candleData.push({
        value: ohlc,
        itemStyle: {
          color: FEATURE_COLORS.limitUp,
          color0: FEATURE_COLORS.limitUp,
          borderColor: FEATURE_COLORS.limitUp,
          borderColor0: FEATURE_COLORS.limitUp,
          borderWidth: 1.5,
        },
      });
      paintRects.push({
        date,
        y0: bar.open,
        y1: bar.open + (bar.close - bar.open) * 0.25,
        fill: FEATURE_COLORS.limitTip,
        stroke: FEATURE_COLORS.limitTip,
        lineWidth: 0,
      });
      pushLabel(markPointData, date, bar.high, "涨停", FEATURE_COLORS.limitUp);
    } else if (t.limitDown) {
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

    if (t.breakUp) {
      paintRects.push({
        date,
        y0: bodyLo + body * 0.55,
        y1: bodyHi,
        fill: "rgba(22,163,74,0.08)",
        stroke: FEATURE_COLORS.breakBox,
        lineWidth: 1.4,
      });
      pushLabel(markPointData, date, bar.high, "破板", FEATURE_COLORS.breakBox);
    }
    if (t.breakDown) {
      paintRects.push({
        date,
        y0: bodyLo,
        y1: bodyLo + body * 0.45,
        fill: "rgba(22,163,74,0.08)",
        stroke: FEATURE_COLORS.breakBox,
        lineWidth: 1.4,
      });
      pushLabel(markPointData, date, bar.low, "开板", FEATURE_COLORS.breakBox, "bottom");
    }

    if (t.yizeWash) {
      pushLabel(markPointData, date, bar.high * 1.008, "壹泽洗", FEATURE_COLORS.yize);
    }

    if (t.pierceOpen) {
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
