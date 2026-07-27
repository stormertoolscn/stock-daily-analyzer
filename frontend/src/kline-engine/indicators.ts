/**
 * 技术指标纯函数：SMA / EMA / MACD。
 * 与引擎解耦，只吃 number[]，方便单测与复用。
 */

/** 简单移动平均；不足 period 的位置填 null。 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均；从第一根开始递推，不足 period 仍输出值。 */
export function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(0);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export interface MacdResult {
  dif: number[];
  dea: number[];
  macd: number[];
}

/** 标准 MACD(12,26,9)：DIF = EMA12-EMA26，DEA = EMA(DIF,9)，柱 = 2*(DIF-DEA)。 */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = emaFast.map((v, i) => v - emaSlow[i]);
  const dea = ema(dif, signal);
  const hist = dif.map((v, i) => 2 * (v - dea[i]));
  return { dif, dea, macd: hist };
}

export function formatVolume(vol: number): string {
  if (vol >= 1e8) return `${(vol / 1e8).toFixed(2)}亿`;
  if (vol >= 1e4) return `${(vol / 1e4).toFixed(2)}万`;
  return vol.toLocaleString("zh-CN");
}

export function roundPrice(n: number, digits = 2): string {
  return n.toFixed(digits);
}
