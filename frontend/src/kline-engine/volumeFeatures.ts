/**
 * 通达信量柱副图特征（由用户公式摘录可复现部分）。
 *
 * 已套用：
 * - DRAWBAND(MA10, MA135)
 * - 倍量 / 倍量阳绿阴红 / V1 黄柱 / V3 红段 / V4 绿段（收跌倍量）
 * - 破板日量柱：红主体 + 底部左紫右黄对半
 * - B≥99 紫柱（AMOUNT 用 VOL×CLOSE 近似）
 * - 连续缩量上涨绿柱 HJ_37
 * - 阶段地量中段绿框
 * - 倍量横线（黄虚线）
 * - MVP5 陡升洋红加粗 MVP5S
 * - MVP5 上穿 MVP35 标记
 *
 * 未套用（缺数据或分时专用）：
 * - VVOL/CTIME 分时预估量、FINANCE/WINNER/CAPITAL 换手、固定屏占比色条、文案水印等
 */
import type { KlineBar } from "./types";
import { ema, sma } from "./indicators";
import { MACD_MAGENTA } from "./macdVisual";

export interface VolumeBarTag {
  beiLiang: boolean;
  beiLiangYang: boolean;
  beiLiangYin: boolean;
  beiLiangDownClose: boolean; // HJ_11
  purpleB99: boolean;
  shrinkUpGreen: boolean; // HJ_37
  stageLowVol: boolean; // 阶段地量
}

export interface VolumeFeaturePack {
  tags: VolumeBarTag[];
  ma5: (number | null)[];
  ma10: (number | null)[];
  ma35: (number | null)[];
  ma135: (number | null)[];
  /** MVP5 陡升段（否则 null） */
  mvp5Steep: (number | null)[];
  /** MVP5 上穿 MVP35 */
  mvp5Cross35: boolean[];
  /** 倍量横线：从条件日到末根的水平黄虚线价位；无则 null */
  beiLiangHLine: { fromIndex: number; volume: number } | null;
}

function hhv(values: number[], end: number, period: number): number {
  const from = Math.max(0, end - period + 1);
  let m = -Infinity;
  for (let i = from; i <= end; i += 1) m = Math.max(m, values[i]);
  return m;
}

function llv(values: number[], end: number, period: number): number {
  const from = Math.max(0, end - period + 1);
  let m = Infinity;
  for (let i = from; i <= end; i += 1) m = Math.min(m, values[i]);
  return m;
}

function countTrue(flags: boolean[], end: number, period: number): number {
  const from = Math.max(0, end - period + 1);
  let n = 0;
  for (let i = from; i <= end; i += 1) if (flags[i]) n += 1;
  return n;
}

/**
 * HJ_2≈AMOUNT/CLOSE/(HHV(AMOUNT,20)/HHV(CLOSE,20))
 * 无成交额时用 VOL*CLOSE 近似 AMOUNT。
 */
function approxBRatio(bars: KlineBar[], i: number): number {
  const amounts = bars.map((b) => b.volume * b.close);
  const closes = bars.map((b) => b.close);
  const volProxy = bars[i].volume; // ≈ AMOUNT/CLOSE
  const den = hhv(amounts, i, 20) / Math.max(1e-9, hhv(closes, i, 20));
  if (!(den > 0)) return 0;
  const hj2 = volProxy / den;
  return Math.min(1, Math.max(0, hj2)) * 100;
}

export function detectVolumeFeatures(bars: KlineBar[]): VolumeFeaturePack {
  const n = bars.length;
  const vols = bars.map((b) => b.volume);
  const closes = bars.map((b) => b.close);
  const opens = bars.map((b) => b.open);

  const ma5 = sma(vols, 5);
  const ma10 = sma(vols, 10);
  const ma35 = sma(vols, 35);
  const ma135 = sma(vols, 135);

  // AT:=VOL/CAPITAL*100 无流通盘 → 用成交额强度 AT≈VOL 归一用原始 VOL，地量仍用相对 LLV
  // 公式：AT:=IF(CAPITAL=0,AMOUNT/1e8,VOL/CAPITAL*100) → CAPITAL=0 时用成交额
  const at = bars.map((b) => (b.volume * b.close) / 1e8);
  const atm1 = ema(at, 5);
  const atm2 = sma(at, 13).map((v) => v ?? 0);

  const upDay = closes.map((c, i) => c > (i > 0 ? closes[i - 1] : opens[i]));
  const volDown = vols.map((v, i) => i > 0 && v < vols[i - 1]);

  const tags: VolumeBarTag[] = new Array(n);
  const stageLow: boolean[] = new Array(n).fill(false);

  for (let i = 0; i < n; i += 1) {
    const prevVol = i > 0 ? vols[i - 1] : 0;
    const beiLiang = i > 0 && prevVol > 0 && vols[i] > prevVol * 1.9;
    const yang = closes[i] > opens[i];
    const yin = closes[i] < opens[i];
    const flatUp =
      closes[i] === opens[i] && i > 0 && closes[i] > closes[i - 1];
    const flatDown =
      closes[i] === opens[i] && i > 0 && closes[i] < closes[i - 1];
    const beiLiangYang = beiLiang && (yang || flatUp);
    const beiLiangYin = beiLiang && (yin || flatDown);
    const beiLiangDownClose =
      beiLiang && i > 0 && closes[i] < closes[i - 1];

    const b = approxBRatio(bars, i);
    const purpleB99 = b >= 99;

    const shrinkUpGreen =
      countTrue(upDay, i, 2) === 2 && countTrue(volDown, i, 2) === 2;

    // 阶段地量：AT<REF(LLV(AT,25),1) AND ATM1<ATM2
    let stageLowVol = false;
    if (i >= 1) {
      const prevLlv = llv(at, i - 1, 25);
      stageLowVol = at[i] < prevLlv && atm1[i] < (atm2[i] as number);
    }
    stageLow[i] = stageLowVol;

    tags[i] = {
      beiLiang,
      beiLiangYang,
      beiLiangYin,
      beiLiangDownClose,
      purpleB99,
      shrinkUpGreen,
      stageLowVol,
    };
  }

  // MVP5S：MVP5>昨 AND 角度>70
  const mvp5Steep: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i += 1) {
    const cur = ma5[i];
    const prev = ma5[i - 1];
    if (cur == null || prev == null || !(prev > 0)) continue;
    const vjd = Math.atan((cur / prev - 1) * 100) * 57.296;
    if (cur > prev && vjd > 70) mvp5Steep[i] = cur;
  }

  const mvp5Cross35: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i += 1) {
    const a0 = ma5[i - 1];
    const a1 = ma5[i];
    const b0 = ma35[i - 1];
    const b1 = ma35[i];
    if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
    mvp5Cross35[i] = a0 <= b0 && a1 > b1;
  }

  // 倍量横线：取「最近一次倍量」的量能，画到最新
  let beiLiangHLine: VolumeFeaturePack["beiLiangHLine"] = null;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (tags[i].beiLiang) {
      beiLiangHLine = { fromIndex: i, volume: vols[i] };
      break;
    }
  }

  return {
    tags,
    ma5,
    ma10,
    ma35,
    ma135,
    mvp5Steep,
    mvp5Cross35,
    beiLiangHLine,
  };
}

export const VOL_FEATURE_COLORS = {
  bandHigh: "rgba(161, 85, 161, 0.22)",
  bandLow: "rgba(255, 100, 100, 0.10)",
  beiLiangYellow: "#e6c200",
  beiLiangRed: "#ff2438",
  beiLiangGreen: "#107c10",
  /** 与 MACD 获利洋红柱一致 */
  purpleB: MACD_MAGENTA,
  shrinkGreen: "#107c10",
  stageLowStroke: "#107c10",
  stageLowFill: "#107c10",
  hLine: "#e6c200",
  mvp5Steep: "#d946ef",
  crossIcon: "#ff2438",
} as const;

type VolOverlayBar = {
  value: number | null;
  itemStyle?: { color: string; borderColor?: string; borderWidth?: number };
};

/** 生成量柱副图叠加 series（挂在 x/yAxisIndex=1） */
export function buildVolumeOverlaySeries(
  bars: KlineBar[],
  pack: VolumeFeaturePack,
  opts: {
    barWidth: number | string;
    dates: string[];
    /** 阳线红：倍量涨停黄柱描边（与主图黄体边框同步） */
    upColor: string;
    /** 涨停日：叠半宽紫柱 */
    limitUpFlags?: boolean[];
    /** 巨量/倍量涨停：全宽黄底 + 半宽紫（与主图一致） */
    volLimitUpFlags?: boolean[];
    /** 破板日：若同时倍量，量柱同黄+紫 */
    breakUpFlags?: boolean[];
  },
): object[] {
  const n = bars.length;
  const barW = typeof opts.barWidth === "string" ? opts.barWidth : Math.max(1, opts.barWidth);
  // 紫色量柱：对中，宽 = 公式紫柱 1.8/3 × 蜡烛宽 → 类目约 40.8%
  const purpleBarW =
    typeof opts.barWidth === "string" ? "40.8%" : Math.max(1, opts.barWidth * (1.8 / 3));
  const dates = opts.dates;
  const vols = bars.map((b) => b.volume);
  const limitUp = opts.limitUpFlags ?? [];
  const volLimitUp = opts.volLimitUpFlags ?? [];
  const breakUp = opts.breakUpFlags ?? [];

  const nulls = (): (number | null)[] => new Array(n).fill(null);

  // DRAWBAND：MA10 与 MA135 之间的带状区
  const lower: (number | null)[] = [];
  const span: (number | null)[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = pack.ma10[i];
    const b = pack.ma135[i];
    if (a == null || b == null) {
      lower.push(null);
      span.push(null);
      continue;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    lower.push(lo);
    span.push(hi - lo);
  }

  const beiLiangFull: VolOverlayBar[] = bars.map((bar, i) => {
    // 破板日量柱保持红主体，不整柱改色
    if (breakUp[i]) return { value: null };
    const t = pack.tags[i];
    if (t.beiLiangYang) {
      return { value: bar.volume, itemStyle: { color: VOL_FEATURE_COLORS.beiLiangGreen } };
    }
    if (t.beiLiangYin) {
      return { value: bar.volume, itemStyle: { color: VOL_FEATURE_COLORS.beiLiangRed } };
    }
    return { value: null };
  });

  const yellowBei: VolOverlayBar[] = bars.map((bar, i) =>
    pack.tags[i].beiLiang && !breakUp[i]
      ? { value: bar.volume, itemStyle: { color: VOL_FEATURE_COLORS.beiLiangYellow } }
      : { value: null },
  );

  // 巨量涨停量柱：全宽黄底 + 半宽居中紫（仅倍量涨停，不含破板日）
  const volLimitYellow: VolOverlayBar[] = bars.map((bar, i) =>
    volLimitUp[i]
      ? {
          value: bar.volume,
          itemStyle: {
            color: "#FFFF00",
            borderColor: opts.upColor,
            borderWidth: 1,
          },
        }
      : { value: null },
  );

  const purpleB: VolOverlayBar[] = bars.map((bar, i) =>
    pack.tags[i].purpleB99 || limitUp[i] || volLimitUp[i]
      ? { value: bar.volume, itemStyle: { color: VOL_FEATURE_COLORS.purpleB } }
      : { value: null },
  );

  const shrinkGreen: VolOverlayBar[] = bars.map((bar, i) =>
    pack.tags[i].shrinkUpGreen
      ? { value: bar.volume, itemStyle: { color: VOL_FEATURE_COLORS.shrinkGreen } }
      : { value: null },
  );

  // V3/V4/地量中段：custom 矩形 [index, y0, y1, kind]
  // kind: 0=V3红 1=V4绿 2=地量框
  const stickSegs: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const t = pack.tags[i];
    const vol = vols[i];
    const prev = i > 0 ? vols[i - 1] : 0;
    if (t.beiLiang && prev > 0) {
      if (t.beiLiangDownClose) {
        stickSegs.push([i, prev, vol, 1]);
      } else {
        stickSegs.push([i, prev, vol, 0]);
      }
    }
    if (t.stageLowVol && vol > 0) {
      stickSegs.push([i, vol * 0.3, vol * 0.6, 2]);
    }
  }

  // 破板日量柱：红主体保留；底部对半 — 左紫右黄（对照用户示意图）
  // [index, y0, y1, side] side: 0=左紫 1=右黄
  const breakFootSegs: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    if (!breakUp[i]) continue;
    const vol = vols[i];
    if (!(vol > 0)) continue;
    const foot = vol * 0.25;
    breakFootSegs.push([i, 0, foot, 0]);
    breakFootSegs.push([i, 0, foot, 1]);
  }

  const crossMarks = pack.mvp5Cross35
    .map((flag, i) =>
      flag && pack.ma5[i] != null
        ? {
            name: "金叉",
            coord: [dates[i], pack.ma5[i] as number] as [string, number],
            symbol: "triangle",
            symbolSize: 8,
            itemStyle: { color: VOL_FEATURE_COLORS.crossIcon },
            label: { show: false },
          }
        : null,
    )
    .filter(Boolean);

  const series: object[] = [
    {
      type: "line",
      name: "量能带下沿",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: lower,
      showSymbol: false,
      silent: true,
      lineStyle: { opacity: 0, width: 0 },
      stack: "vol-band",
      z: 0,
    },
    {
      type: "line",
      name: "量能带",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: span,
      showSymbol: false,
      silent: true,
      lineStyle: { opacity: 0, width: 0 },
      areaStyle: {
        color: {
          type: "linear",
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: VOL_FEATURE_COLORS.bandHigh },
            { offset: 1, color: VOL_FEATURE_COLORS.bandLow },
          ],
        },
      },
      stack: "vol-band",
      z: 0,
    },
    {
      type: "bar",
      id: "kline-vol-beiliang",
      name: "倍量填色",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: beiLiangFull,
      barWidth: barW,
      barGap: "-100%",
      z: 2,
      silent: true,
    },
    {
      type: "bar",
      id: "kline-vol-yellow",
      name: "倍量黄",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: yellowBei,
      barWidth: barW,
      barGap: "-100%",
      z: 3,
      silent: true,
    },
    {
      type: "bar",
      id: "kline-vol-limit-yellow",
      name: "巨量涨停黄",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: volLimitYellow,
      barWidth: barW,
      barGap: "-100%",
      z: 3,
      silent: true,
    },
    {
      type: "bar",
      id: "kline-vol-purple",
      name: "量比紫",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: purpleB,
      barWidth: purpleBarW,
      barGap: "-100%",
      z: 4,
      silent: true,
    },
    {
      type: "bar",
      id: "kline-vol-shrink",
      name: "缩量上涨",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: shrinkGreen,
      barWidth: barW,
      barGap: "-100%",
      z: 4,
      silent: true,
    },
  ];

  if (stickSegs.length) {
    series.push({
      type: "custom",
      name: "量柱线段",
      xAxisIndex: 1,
      yAxisIndex: 1,
      silent: true,
      z: 5,
      encode: { x: 0, y: [1, 2] },
      renderItem: (
        params: { dataIndex: number },
        api: {
          value: (dim: number) => number;
          coord: (val: [number, number]) => number[];
          size: (val: [number, number]) => number[];
        },
      ) => {
        const idx = api.value(0);
        const y0 = api.value(1);
        const y1 = api.value(2);
        const kind = api.value(3);
        const p0 = api.coord([idx, y0]);
        const p1 = api.coord([idx, y1]);
        const band = Math.max(2, (api.size([1, 0])[0] as number) || 4);
        const hollow = kind === 2;
        const widthFactor = kind === 2 ? 0.22 : kind === 1 ? 0.42 : 0.36;
        const half = Math.max(1.2, band * widthFactor);
        const color =
          kind === 1
            ? VOL_FEATURE_COLORS.beiLiangGreen
            : kind === 2
              ? VOL_FEATURE_COLORS.stageLowStroke
              : VOL_FEATURE_COLORS.beiLiangRed;
        return {
          type: "rect",
          shape: {
            x: p0[0] - half,
            y: Math.min(p0[1], p1[1]),
            width: half * 2,
            height: Math.max(1, Math.abs(p1[1] - p0[1])),
          },
          style: {
            fill: hollow ? "none" : color,
            stroke: color,
            lineWidth: hollow ? 1.2 : 0,
          },
        };
      },
      data: stickSegs,
    });
  }

  // 破板日量柱底足：左紫右黄对半（与红量柱同宽拼接）
  if (breakFootSegs.length) {
    series.push({
      type: "custom",
      name: "破板量足",
      xAxisIndex: 1,
      yAxisIndex: 1,
      silent: true,
      z: 5,
      encode: { x: 0, y: [1, 2] },
      renderItem: (
        _params: { dataIndex: number },
        api: {
          value: (dim: number) => number;
          coord: (val: [number, number]) => number[];
          size: (val: [number, number]) => number[];
        },
      ) => {
        const idx = api.value(0);
        const y0 = api.value(1);
        const y1 = api.value(2);
        const side = api.value(3); // 0=左紫 1=右黄
        const p0 = api.coord([idx, y0]);
        const p1 = api.coord([idx, y1]);
        const band = Math.max(2, (api.size([1, 0])[0] as number) || 4);
        // 与量柱同宽 68%，各占一半
        const fullW = Math.max(2, band * 0.68);
        const halfW = fullW / 2;
        const x =
          side === 0 ? p0[0] - fullW / 2 : p0[0];
        const color =
          side === 0 ? VOL_FEATURE_COLORS.purpleB : "#FFFF00";
        return {
          type: "rect",
          shape: {
            x,
            y: Math.min(p0[1], p1[1]),
            width: halfW,
            height: Math.max(1, Math.abs(p1[1] - p0[1])),
          },
          style: {
            fill: color,
            stroke: color,
            lineWidth: 0,
          },
        };
      },
      data: breakFootSegs,
    });
  }

  // MVP5 陡升洋红加粗
  series.push({
    type: "line",
    name: "MVP5S",
    xAxisIndex: 1,
    yAxisIndex: 1,
    data: pack.mvp5Steep,
    showSymbol: false,
    connectNulls: false,
    silent: true,
    lineStyle: {
      width: 3,
      color: VOL_FEATURE_COLORS.mvp5Steep,
    },
    z: 6,
  });

  if (pack.beiLiangHLine) {
    const { fromIndex, volume } = pack.beiLiangHLine;
    const hData = nulls();
    for (let i = fromIndex; i < n; i += 1) hData[i] = volume;
    series.push({
      type: "line",
      name: "倍量横线",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: hData,
      showSymbol: false,
      connectNulls: true,
      silent: true,
      lineStyle: {
        width: 1,
        type: "dashed",
        color: VOL_FEATURE_COLORS.hLine,
      },
      z: 6,
    });
  }

  if (crossMarks.length) {
    series.push({
      type: "line",
      name: "量均金叉",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: pack.ma5,
      showSymbol: false,
      lineStyle: { opacity: 0, width: 0 },
      silent: true,
      z: 7,
      markPoint: {
        silent: true,
        data: crossMarks,
      },
    });
  }

  return series;
}
