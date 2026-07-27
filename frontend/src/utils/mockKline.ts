import type { KlineBar } from "@/kline-engine";

/** 用股票代码作种子，保证同一代码每次生成走势一致。 */
function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashCode(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) {
    h = (h * 31 + code.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

export type KlinePeriod = "intraday" | "day" | "week" | "month";

const BASE_PRICE: Record<string, number> = {
  "600221": 1.4,
  "600519": 1700,
  "000001": 11,
  "300750": 200,
  "000858": 140,
  "601318": 48,
  "600036": 36,
  "002594": 260,
};

/**
 * 生成可演示的模拟 K 线。真实数据接入后，替换此函数的调用方即可。
 */
export function generateMockBars(
  code: string,
  period: KlinePeriod = "day",
  count?: number,
): KlineBar[] {
  const rand = seededRandom(hashCode(code) + period.length * 97);
  const base = BASE_PRICE[code] ?? 10 + (hashCode(code) % 80);
  const days =
    count ??
    (period === "month" ? 72 : period === "week" ? 160 : period === "intraday" ? 240 : 220);

  const stepMs =
    period === "intraday"
      ? 60_000
      : period === "week"
        ? 7 * 86400_000
        : period === "month"
          ? 30 * 86400_000
          : 86400_000;

  const bars: KlineBar[] = [];
  let price = base;
  const now = Date.now();

  for (let i = days - 1; i >= 0; i -= 1) {
    const drift = (rand() - 0.48) * price * (period === "month" ? 0.08 : 0.035);
    const open = price;
    const close = Math.max(0.2, open + drift);
    const wick = Math.abs(drift) * (0.4 + rand() * 1.2) + price * 0.004;
    const high = Math.max(open, close) + wick * rand();
    const low = Math.max(0.1, Math.min(open, close) - wick * rand());
    const volume = Math.round(
      (80_000 + rand() * 420_000) * (0.6 + Math.abs(drift / price) * 18),
    );
    bars.push({
      timestamp: now - i * stepMs,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    });
    price = close;
  }
  return bars;
}

function round(n: number): number {
  const digits = n >= 100 ? 2 : n >= 10 ? 2 : 3;
  return Number(n.toFixed(digits));
}

/** 日线聚合为周/月（演示用）。 */
export function resampleBars(bars: KlineBar[], period: KlinePeriod): KlineBar[] {
  if (period === "day" || period === "intraday") return bars;
  const bucketDays = period === "week" ? 5 : 20;
  const out: KlineBar[] = [];
  for (let i = 0; i < bars.length; i += bucketDays) {
    const slice = bars.slice(i, i + bucketDays);
    if (!slice.length) continue;
    out.push({
      timestamp: slice[slice.length - 1].timestamp,
      open: slice[0].open,
      high: Math.max(...slice.map((b) => b.high)),
      low: Math.min(...slice.map((b) => b.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((s, b) => s + b.volume, 0),
    });
  }
  return out;
}
