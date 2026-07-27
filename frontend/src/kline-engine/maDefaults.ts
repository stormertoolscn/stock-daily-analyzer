import type { MaLineStyle } from "./types";

/**
 * 同花顺远航版风格主图均线色板（浅底可读微调）。
 * 周期可自定义；width=0 表示不绘制。
 */
export const THS_MA_LINES_12: MaLineStyle[] = [
  { period: 5, color: "#8b9199", name: "MA5", width: 1 },
  { period: 10, color: "#c9a227", name: "MA10", width: 1 },
  { period: 20, color: "#d946ef", name: "MA20", width: 1 },
  { period: 30, color: "#22c55e", name: "MA30", width: 1 },
  { period: 60, color: "#06b6d4", name: "MA60", width: 1 },
  { period: 120, color: "#f59e0b", name: "MA120", width: 1 },
  { period: 250, color: "#4c7dff", name: "MA250", width: 0 },
  { period: 320, color: "#e06cf0", name: "MA320", width: 0 },
  { period: 500, color: "#ef4444", name: "MA500", width: 0 },
  { period: 600, color: "#14b8a6", name: "MA600", width: 0 },
  { period: 900, color: "#a78bfa", name: "MA900", width: 0 },
  { period: 1200, color: "#fb7185", name: "MA1200", width: 0 },
];

/** 兼容旧引用：前 4 根可见均线 */
export const THS_MA_LINES = THS_MA_LINES_12.filter((l) => (l.width ?? 1) > 0).slice(
  0,
  4,
);

/**
 * 量柱副图均线（对应通达信/同花顺常见 MAVOL）。
 * 公式里 MVP5/MVP* 是量能均线；默认 MA5 / MA10 / MA120。
 */
export const THS_VOL_MA_LINES: MaLineStyle[] = [
  { period: 5, color: "#006464", name: "MA5", width: 1 },
  { period: 10, color: "#a155a1", name: "MA10", width: 1 },
  { period: 120, color: "#ffcc66", name: "MA120", width: 1.5 },
];
