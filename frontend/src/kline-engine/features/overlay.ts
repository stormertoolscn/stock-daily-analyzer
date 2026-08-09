/**
 * 通达信主图 STICKLINE 涨停/破板绘制（严格对照公式）。
 *
 * 倍量涨停: 先黄体宽3，再紫体宽1.8（两侧露黄）
 * 涨停紫: 与 MACD 幅图获利洋红同色 #e040fb，宽1.8
 * 底尖: MA5上行黄 / 下行橙，O→O+(C-O)*0.25 宽0.8 再 *0.2 宽0.3
 * 顶尖: 仅涨停3，C→C-(C-O)*0.2 宽0.3 COLORFF8800（黄框内黑心视觉）
 * 破板: 普通阴/阳线 + 顶部空心绿框内嵌实心黑块（黑心须可见）
 * 开板: 底部空心绿框内嵌实心黑块
 */
import type { KlineBar } from "../types";
import type { BarFeatureTags } from "./detect";
import { MACD_MAGENTA } from "../macdVisual";

/** 通达信公式色 */
export const FEATURE_COLORS = {
  /** 涨停紫：对齐 MACD 幅图洋红 */
  limitUp: MACD_MAGENTA,
  /** 跌停 COLOR296406 */
  limitDown: "#296406",
  volLimitUp: MACD_MAGENTA,
  /** 倍量涨停黄体 COLORYELLOW */
  volLimitUpYellow: "#FFFF00",
  /** 底尖黄 COLORYELLOW */
  tipYellow: "#FFFF00",
  /** 底尖/顶尖橙 COLORFF8800 */
  tipOrange: "#FF8800",
  /** 破板 COLORGREEN */
  breakBox: "#00C000",
  yize: "#FF00FF",
  pierce: "#fe5000",
  alignBull: "#FF00FF",
  alignBear: "#00C000",
} as const;

/** 蜡烛类目占比（与 engine barWidth 68% 对齐） */
const CANDLE_BAND = 0.68;
/** 公式宽3 → 全蜡烛；紫宽1.8 → 1.8/3 */
const YELLOW_BODY_RATIO = CANDLE_BAND;
const PURPLE_BODY_RATIO = CANDLE_BAND * (1.8 / 3);
/** 尖宽 0.8 / 0.3 相对公式宽3 */
const TIP_WIDE_RATIO = CANDLE_BAND * (0.8 / 3);
const TIP_THIN_RATIO = CANDLE_BAND * (0.3 / 3);
/** 破板空心框宽 1.38 / 3 */
const BREAK_BOX_RATIO = CANDLE_BAND * (1.38 / 3);

export interface FeaturePaintRect {
  date: string;
  y0: number;
  y1: number;
  fill: string;
  stroke: string;
  lineWidth: number;
  widthRatio?: number;
  /**
   * body：实体柱/空心框
   * tipSolid：实心尖（底端贴 y0 向上，或由 y0<y1 表示区间）
   * tipHollow：顶端黄/橙框 + 内黑心（贴价位向下）
   */
  kind?: "body" | "tipSolid" | "tipHollow";
  /** tipHollow/贴顶尖：true=贴 y0 向下画固定像素高 */
  tipFromTop?: boolean;
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
  limitUpFlags: boolean[];
  volLimitUpFlags: boolean[];
  breakUpFlags: boolean[];
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
  opts?: { symbol?: string; symbolSize?: number; fontSize?: number },
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
      fontSize: opts?.fontSize ?? 11,
      fontWeight: "bold",
      position,
      distance: position === "top" ? 4 : 6,
    },
    symbol: opts?.symbol ?? (position === "top" ? "triangle" : "none"),
    symbolSize: opts?.symbolSize ?? (position === "top" ? 8 : 0),
  });
}

/** 涨停底尖色：MA5 上行黄，否则橙 */
function tipColor(ma5Rising: boolean): string {
  return ma5Rising ? FEATURE_COLORS.tipYellow : FEATURE_COLORS.tipOrange;
}

/**
 * 涨停装饰（公式顺序）：
 * 1) 底尖宽 0.8 高 25% + 宽 0.3 高 20%
 * 2) 紫柱 OPEN-CLOSE 宽 1.8（倍量时下层已有黄体）
 * 3) 涨停3 顶尖宽 0.3 高 20%（黄/橙框+黑心）
 */
function pushLimitUpDecor(
  paintRects: FeaturePaintRect[],
  date: string,
  bar: KlineBar,
  opts: { limitUp20: boolean; ma5Rising: boolean },
) {
  const o = bar.open;
  const c = bar.close;
  const body = c - o;
  if (Math.abs(body) < 1e-8) return;

  const tipCol = tipColor(opts.ma5Rising);

  // 底尖：O → O+(C-O)*0.25 宽0.8
  paintRects.push({
    date,
    y0: o,
    y1: o + body * 0.25,
    fill: tipCol,
    stroke: tipCol,
    lineWidth: 0,
    widthRatio: TIP_WIDE_RATIO,
    kind: "body",
  });
  // 底尖：O → O+(C-O)*0.2 宽0.3
  paintRects.push({
    date,
    y0: o,
    y1: o + body * 0.2,
    fill: tipCol,
    stroke: tipCol,
    lineWidth: 0,
    widthRatio: TIP_THIN_RATIO,
    kind: "body",
  });

  // 紫柱 OPEN-CLOSE 宽 1.8
  paintRects.push({
    date,
    y0: Math.min(o, c),
    y1: Math.max(o, c),
    fill: FEATURE_COLORS.limitUp,
    stroke: FEATURE_COLORS.limitUp,
    lineWidth: 0,
    widthRatio: PURPLE_BODY_RATIO,
    kind: "body",
  });

  // 涨停3 顶尖：C → C-(C-O)*0.2 宽0.3，黄框黑心
  if (opts.limitUp20) {
    paintRects.push({
      date,
      y0: c,
      y1: c,
      fill: "none",
      stroke: FEATURE_COLORS.tipOrange,
      lineWidth: 1.5,
      widthRatio: TIP_THIN_RATIO,
      kind: "tipHollow",
      tipFromTop: true,
    });
  }
}

export interface BuildFeatureOverlayOptions {
  includeDailyLimitHints?: boolean;
  pierceLineCount?: number;
  limitRatio?: number;
}

export function buildFeatureOverlay(
  bars: KlineBar[],
  tags: BarFeatureTags[],
  _theme: { upColor: string; downColor: string },
  options?: BuildFeatureOverlayOptions,
): FeatureOverlayResult {
  const includeDaily = options?.includeDailyLimitHints !== false;
  const pierceLineCount = options?.pierceLineCount;
  const candleData: FeatureOverlayResult["candleData"] = [];
  const markPointData: FeatureOverlayResult["markPointData"] = [];
  const paintRects: FeaturePaintRect[] = [];
  const limitUpFlags: boolean[] = new Array(bars.length).fill(false);
  const volLimitUpFlags: boolean[] = new Array(bars.length).fill(false);
  const breakUpFlags: boolean[] = new Array(bars.length).fill(false);
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
      // 倍量涨停：黄体宽3 + 紫 1.8 + 尖
      limitUpFlags[i] = true;
      volLimitUpFlags[i] = true;
      candleData.push({
        value: ohlc,
        itemStyle: {
          color: FEATURE_COLORS.volLimitUpYellow,
          color0: FEATURE_COLORS.volLimitUpYellow,
          // 浅色背景下黄底配阳线红细边框，轮廓清晰
          borderColor: _theme.upColor,
          borderColor0: _theme.upColor,
          borderWidth: 1.2,
        },
      });
      pushLimitUpDecor(paintRects, date, bar, {
        limitUp20: t.limitUp20,
        ma5Rising: t.ma5Rising,
      });
      const pct = t.limitUp20 ? "20%" : "10%";
      pushLabel(markPointData, date, bar.high, pct, FEATURE_COLORS.tipYellow, "top", {
        symbol: "none",
        symbolSize: 0,
        fontSize: 10,
      });
    } else if (includeDaily && t.limitUp) {
      // 普通涨停：保留红实体 + 紫 1.8 + 尖
      limitUpFlags[i] = true;
      candleData.push({
        value: ohlc,
        itemStyle: {
          color: _theme.upColor,
          color0: _theme.upColor,
          borderColor: _theme.upColor,
          borderColor0: _theme.upColor,
          borderWidth: 1.2,
        },
      });
      pushLimitUpDecor(paintRects, date, bar, {
        limitUp20: t.limitUp20,
        ma5Rising: t.ma5Rising,
      });
      const pct = t.limitUp20 ? "20%" : "10%";
      pushLabel(markPointData, date, bar.high, pct, FEATURE_COLORS.tipYellow, "top", {
        symbol: "none",
        symbolSize: 0,
        fontSize: 10,
      });
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
      // 破板等：普通阴/阳线，不整柱涂色
      candleData.push(ohlc);
    }

    if (includeDaily && t.breakUp) {
      // 顶部小方块：空心绿框 + 内嵌实心黑块（须盖住红/绿实体）
      breakUpFlags[i] = true;
      const tipHi = Math.max(bar.close, bar.open);
      paintRects.push({
        date,
        y0: tipHi,
        y1: tipHi,
        fill: "none",
        stroke: FEATURE_COLORS.breakBox,
        lineWidth: 1.35,
        widthRatio: BREAK_BOX_RATIO,
        kind: "tipHollow",
        tipFromTop: true,
      });
      pushLabel(markPointData, date, bar.high, "破板", FEATURE_COLORS.breakBox);
    }
    if (includeDaily && t.breakDown) {
      // 底部小方块：空心绿框 + 内嵌实心黑块
      paintRects.push({
        date,
        y0: bodyLo,
        y1: bodyLo,
        fill: "none",
        stroke: FEATURE_COLORS.breakBox,
        lineWidth: 1.35,
        widthRatio: BREAK_BOX_RATIO,
        kind: "tipHollow",
        tipFromTop: false,
      });
      pushLabel(markPointData, date, bar.low, "开板", FEATURE_COLORS.breakBox, "bottom");
    }

    if (t.yizeWash) {
      pushLabel(markPointData, date, bar.high * 1.008, "壹泽洗", FEATURE_COLORS.yize);
    }

    if (includeDaily && t.yangPierce) {
      const n = t.pierceTarget || pierceLineCount || t.pierceCount;
      if (n > 0) {
        pushLabel(
          markPointData,
          date,
          bar.high * 1.012,
          `一阳穿${n}线`,
          FEATURE_COLORS.pierce,
        );
      }
    } else if (includeDaily && t.yinPierce) {
      const n = t.pierceTarget || pierceLineCount || t.pierceCount;
      if (n > 0) {
        pushLabel(
          markPointData,
          date,
          bar.low,
          `一阴穿${n}线`,
          FEATURE_COLORS.pierce,
          "bottom",
        );
      }
    }

    if (i === last) {
      if (t.bullAlign) {
        pushLabel(markPointData, date, bar.low, "多头排列", FEATURE_COLORS.alignBull, "bottom");
      } else if (t.bearAlign) {
        pushLabel(markPointData, date, bar.low, "空头排列", FEATURE_COLORS.alignBear, "bottom");
      }
    }
  }

  return {
    candleData,
    markPointData,
    paintRects,
    limitUpFlags,
    volLimitUpFlags,
    breakUpFlags,
  };
}

// 供 volume / 外部引用宽度常量
export const LIMIT_STICK_WIDTHS = {
  yellowBody: YELLOW_BODY_RATIO,
  purpleBody: PURPLE_BODY_RATIO,
  tipWide: TIP_WIDE_RATIO,
  tipThin: TIP_THIN_RATIO,
} as const;
