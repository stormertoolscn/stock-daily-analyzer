/**
 * 通达信风格 K 线特征识别（涨停/跌停/破板/倍量/壹泽洗盘/一阳穿线/多空排列）。
 */
import { sma } from "../indicators";
import type { KlineBar } from "../types";

export interface BarFeatureTags {
  limitUp: boolean;
  limitDown: boolean;
  breakUp: boolean;
  breakDown: boolean;
  volLimitUp: boolean;
  /** 阴线穿过 ≥N 根均线 */
  yinPierce: boolean;
  /** 阳线穿过 ≥N 根均线 */
  yangPierce: boolean;
  yizeWash: boolean;
  pierceOpen: boolean;
  bullAlign: boolean;
  bearAlign: boolean;
  /** 实际穿过的均线根数（用于文案） */
  pierceCount: number;
}

export interface DetectFeaturesOptions {
  /** 参与穿线/排列的均线周期（按顺序，含未显示的也可） */
  maPeriods: number[];
  /** 穿 N 线目标，默认 6；若均线不足则降为可用根数（至少 3） */
  pierceN?: number;
  /** 涨跌停幅度，如 0.1 / 0.2 / 0.05 */
  limitRatio?: number;
}

export function resolveLimitRatio(code?: string, name?: string): number {
  const n = (name ?? "").toUpperCase();
  if (n.includes("ST")) return 0.05;
  const c = (code ?? "").replace(/\D/g, "");
  if (c.startsWith("688") || c.startsWith("300") || c.startsWith("301")) {
    return 0.2;
  }
  return 0.1;
}

/** 昨收 × (1±limit) 的可成交价近似（四舍五入到分） */
function limitUpPrice(prevClose: number, ratio: number): number {
  return Math.round(prevClose * (1 + ratio) * 100) / 100;
}

function limitDownPrice(prevClose: number, ratio: number): number {
  return Math.round(prevClose * (1 - ratio) * 100) / 100;
}

/** 收盘价是否贴住最高/最低（允许 1 分钱误差） */
function nearlyEq(a: number, b: number): boolean {
  const tick = Math.max(0.01, Math.min(a, b) * 0.0008);
  return Math.abs(a - b) <= tick;
}

function between(v: number, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return v >= lo && v <= hi;
}

export function detectBarFeatures(
  bars: KlineBar[],
  options: DetectFeaturesOptions,
): BarFeatureTags[] {
  const n = bars.length;
  const periods = options.maPeriods.filter((p) => p > 0);
  const wantN = options.pierceN ?? 6;
  const pierceN = Math.max(3, Math.min(wantN, periods.length || wantN));
  const ratio = options.limitRatio ?? 0.1;
  const closes = bars.map((b) => b.close);
  const maSeries = periods.map((p) => sma(closes, p));

  const yinPierce = new Array<boolean>(n).fill(false);
  const yangPierce = new Array<boolean>(n).fill(false);
  const tags: BarFeatureTags[] = new Array(n);

  for (let i = 0; i < n; i += 1) {
    const bar = bars[i];
    const prev = i > 0 ? bars[i - 1] : null;
    const prevClose = prev?.close ?? bar.open;

    const zt = limitUpPrice(prevClose, ratio);
    const dt = limitDownPrice(prevClose, ratio);
    const tick = Math.max(0.01, prevClose * 0.0005);

    const hitUp = bar.high + tick >= zt;
    const hitDown = bar.low - tick <= dt;
    const limitUp = hitUp && nearlyEq(bar.close, bar.high);
    const limitDown = hitDown && nearlyEq(bar.close, bar.low);
    const breakUp = hitUp && !nearlyEq(bar.close, bar.high) && bar.close < bar.high;
    const breakDown =
      hitDown && !nearlyEq(bar.close, bar.low) && bar.close > bar.low;
    const volLimitUp =
      limitUp && prev != null && prev.volume > 0 && bar.volume >= prev.volume * 1.68;

    let pierceCount = 0;
    for (const series of maSeries) {
      const ma = series[i];
      if (ma == null || !Number.isFinite(ma)) continue;
      if (between(ma, bar.open, bar.close)) pierceCount += 1;
    }
    const isYang = bar.close > bar.open;
    const isYin = bar.close < bar.open;
    yinPierce[i] = isYin && pierceCount >= pierceN;
    yangPierce[i] = isYang && pierceCount >= pierceN;

    tags[i] = {
      limitUp,
      limitDown,
      breakUp,
      breakDown,
      volLimitUp,
      yinPierce: yinPierce[i],
      yangPierce: yangPierce[i],
      yizeWash: false,
      pierceOpen: false,
      bullAlign: false,
      bearAlign: false,
      pierceCount,
    };
  }

  for (let i = 0; i < n; i += 1) {
    const t = tags[i];
    let yinIn4 = false;
    for (let k = 1; k <= 4 && i - k >= 0; k += 1) {
      if (yinPierce[i - k]) {
        yinIn4 = true;
        break;
      }
    }
    const jiaji = i > 0 && yinPierce[i - 1] && yangPierce[i];
    t.yizeWash = (yinIn4 && yangPierce[i]) || jiaji;
    t.pierceOpen = yangPierce[i] && t.breakUp;

    const mas: number[] = [];
    for (const series of maSeries) {
      const v = series[i];
      if (v == null || !Number.isFinite(v)) {
        mas.length = 0;
        break;
      }
      mas.push(v);
    }
    if (mas.length >= 3) {
      let bull = true;
      let bear = true;
      for (let j = 0; j < mas.length - 1; j += 1) {
        if (!(mas[j] >= mas[j + 1])) bull = false;
        if (!(mas[j] <= mas[j + 1])) bear = false;
      }
      t.bullAlign = bull;
      t.bearAlign = bear;
    }
  }

  return tags;
}
