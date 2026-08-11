/**
 * 通达信风格 MACD 增强绘制数据（SHORT=12, LONG=26, MM=9）。
 * DIF:=EMA(C,12)-EMA(C,26); DEA:=EMA(DIF,MM); MACD:=(DIF-DEA)*2
 * 柱：红涨青跌；DIF 黄粗线、DEA 白线；
 * 简化实现公式中的峰连线黄柱、获利洋红柱。
 */
import { macd } from "./indicators";
import type { KlineBar } from "./types";

export const MACD_SHORT = 12;
export const MACD_LONG = 26;
export const MACD_MM = 9;
/** 涨停紫 / 获利洋红：MACD 幅图与 K 线特征共用 */
export const MACD_MAGENTA = "#e040fb";

export interface MacdVisualSeries {
  dif: number[];
  dea: number[];
  macd: number[];
  /** 基础柱颜色：红 / 青 / 洋红(获利) */
  histColors: string[];
  /** 峰连线 HJ_22 简化 */
  peakLine: (number | null)[];
  /** MACD>峰线时的黄柱上沿（MACD），下沿为 peakLine */
  yellowTop: (number | null)[];
  yellowBot: (number | null)[];
}

const COLOR_RED = "#f5222d";
const COLOR_CYAN = "#00c2d4";
const COLOR_MAGENTA = "#e040fb";

/** 粗略获利盘占比：现价在近窗高低区间中的位置 × 量能加权修正，≈ WINNER*100 */
function approxWinnerPct(bars: KlineBar[], i: number, win = 60): number {
  const from = Math.max(0, i - win + 1);
  let lo = Infinity;
  let hi = -Infinity;
  let vol = 0;
  let volBelow = 0;
  const close = bars[i].close;
  for (let j = from; j <= i; j += 1) {
    const b = bars[j];
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
    vol += b.volume;
    // 三角近似：收盘低于现价的量计入获利
    if (b.close <= close) volBelow += b.volume;
    else if (b.low < close) {
      const span = b.high - b.low || 1;
      volBelow += b.volume * Math.max(0, (close - b.low) / span);
    }
  }
  if (vol <= 0) return 50;
  return (volBelow / vol) * 100;
}

/**
 * 正柱区间内，把相邻「零轴上穿后的局部高点」连成折线（公式 HJ_22 简化）。
 */
function buildPeakLine(hist: number[]): (number | null)[] {
  const n = hist.length;
  const out: (number | null)[] = new Array(n).fill(null);
  const peaks: { i: number; v: number }[] = [];

  let i = 0;
  while (i < n) {
    if (hist[i] <= 0) {
      i += 1;
      continue;
    }
    let j = i;
    let maxI = i;
    let maxV = hist[i];
    while (j < n && hist[j] > 0) {
      if (hist[j] > maxV) {
        maxV = hist[j];
        maxI = j;
      }
      j += 1;
    }
    peaks.push({ i: maxI, v: maxV });
    i = j;
  }

  if (peaks.length === 0) return out;
  // 单峰：水平延伸到该正区间
  for (let p = 0; p < peaks.length; p += 1) {
    const a = peaks[p];
    const b = peaks[p + 1];
    if (!b) {
      // 从峰点画到序列末或回到 0 前
      let t = a.i;
      while (t < n && hist[t] > 0) {
        out[t] = a.v;
        t += 1;
      }
      continue;
    }
    const span = b.i - a.i;
    if (span <= 0) continue;
    for (let k = a.i; k <= b.i; k += 1) {
      const t = (k - a.i) / span;
      out[k] = a.v + (b.v - a.v) * t;
    }
  }
  return out;
}

export function buildMacdVisual(
  bars: KlineBar[],
  opts?: { short?: number; long?: number; mm?: number },
): MacdVisualSeries {
  const short = opts?.short ?? MACD_SHORT;
  const long = opts?.long ?? MACD_LONG;
  const mm = opts?.mm ?? MACD_MM;
  const closes = bars.map((b) => b.close);
  const { dif, dea, macd: hist } = macd(closes, short, long, mm);
  const peakLine = buildPeakLine(hist);
  const histColors: string[] = [];
  const yellowTop: (number | null)[] = [];
  const yellowBot: (number | null)[] = [];

  for (let i = 0; i < hist.length; i += 1) {
    const h = hist[i];
    const winner = approxWinnerPct(bars, i);
    const profit = winner > 82;
    if (profit) histColors.push(COLOR_MAGENTA);
    else if (h >= 0) histColors.push(COLOR_RED);
    else histColors.push(COLOR_CYAN);

    const peak = peakLine[i];
    if (peak != null && h > peak && h > 0) {
      yellowTop.push(h);
      yellowBot.push(peak);
    } else {
      yellowTop.push(null);
      yellowBot.push(null);
    }
  }

  return { dif, dea, macd: hist, histColors, peakLine, yellowTop, yellowBot };
}
