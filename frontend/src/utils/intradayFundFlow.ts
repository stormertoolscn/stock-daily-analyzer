/**
 * 分时区间资金估算（无 Level-2 逐笔时的参考图）。
 * 按分钟成交额分档累加买卖方向，供实时龙虎榜资金面板使用。
 */
import type { KlineBar } from "@/kline-engine";

export interface FundBucket {
  label: string;
  /** 净额（元，正流入负流出） */
  net: number;
}

export interface IntradayFundStats {
  buckets: FundBucket[];
  /** 主力净额 = 大于50万 + 30-50万 */
  mainNet: number;
  mainBuy: number;
  mainSell: number;
  rangeChangePct: number;
  rangeTurnover: number;
  totalTurnover: number;
  startIndex: number;
  endIndex: number;
}

const BUCKET_LABELS = ["大于50万", "30-50万", "10-30万", "小于10万"] as const;

function barAmount(bar: KlineBar): number {
  // 后端未下发 amount 时用价×量近似（量单位因数据源而异，仅作相对参考）
  return Math.max(0, bar.close * bar.volume);
}

function bucketIndex(amount: number): number {
  if (amount >= 5e5) return 0;
  if (amount >= 3e5) return 1;
  if (amount >= 1e5) return 2;
  return 3;
}

export function formatFundAmount(v: number): string {
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  if (abs >= 1e8) {
    const yi = abs / 1e8;
    return `${sign}${yi >= 10 ? yi.toFixed(1) : yi.toFixed(2)}亿`;
  }
  if (abs >= 1e4) {
    const wan = abs / 1e4;
    return `${sign}${wan >= 100 ? wan.toFixed(0) : wan.toFixed(0)}万`;
  }
  if (abs < 1) return "0";
  return `${sign}${abs.toFixed(0)}`;
}

export function formatFundAmountPlain(v: number): string {
  /** 主力净额等大字：不带正号时也可带符号 */
  return formatFundAmount(v);
}

/** 在 [start, end]（含）上估算分时资金结构 */
export function computeIntradayFundStats(
  bars: KlineBar[],
  startIndex: number,
  endIndex: number,
  prevClose?: number | null,
): IntradayFundStats | null {
  if (!bars.length) return null;
  const lo = Math.max(0, Math.min(startIndex, endIndex));
  const hi = Math.min(bars.length - 1, Math.max(startIndex, endIndex));
  if (lo > hi) return null;

  const nets = [0, 0, 0, 0];
  let mainBuy = 0;
  let mainSell = 0;
  let rangeTurnover = 0;
  let totalTurnover = 0;

  for (let i = 0; i < bars.length; i += 1) {
    const amt = barAmount(bars[i]);
    totalTurnover += amt;
  }

  for (let i = lo; i <= hi; i += 1) {
    const bar = bars[i];
    const amt = barAmount(bar);
    rangeTurnover += amt;
    const prev = i > 0 ? bars[i - 1].close : (prevClose ?? bar.open);
    const up = bar.close >= prev;
    const signed = up ? amt : -amt;
    const bi = bucketIndex(amt);
    nets[bi] += signed;
    if (bi <= 1) {
      if (signed >= 0) mainBuy += signed;
      else mainSell += signed;
    }
  }

  const first = bars[lo];
  const last = bars[hi];
  const base = prevClose && prevClose > 0 ? prevClose : first.open || first.close;
  const rangeChangePct = base > 0 ? ((last.close - first.open) / base) * 100 : 0;

  return {
    buckets: BUCKET_LABELS.map((label, i) => ({ label, net: nets[i] })),
    mainNet: nets[0] + nets[1],
    mainBuy,
    mainSell,
    rangeChangePct,
    rangeTurnover,
    totalTurnover,
    startIndex: lo,
    endIndex: hi,
  };
}
