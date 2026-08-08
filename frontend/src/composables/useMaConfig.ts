import { ref, watch } from "vue";

import {
  MACD_LONG,
  MACD_MM,
  MACD_SHORT,
  THS_MA_LINES_12,
  THS_VOL_MA_LINES,
  type MaLineStyle,
} from "@/kline-engine";

const MA_KEY = "sda-ma-lines-v1";
const VOL_MA_KEY = "sda-vol-ma-lines-v2";
const MACD_KEY = "sda-macd-params-v1";

export interface MacdParams {
  short: number;
  long: number;
  mm: number;
}

function cloneLines(lines: readonly MaLineStyle[]): MaLineStyle[] {
  return lines.map((l) => ({ ...l }));
}

function loadLines(key: string, fallback: MaLineStyle[]): MaLineStyle[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return cloneLines(fallback);
    const parsed = JSON.parse(raw) as MaLineStyle[];
    if (!Array.isArray(parsed) || !parsed.length) return cloneLines(fallback);
    return parsed.map((l, i) => ({
      period: Math.max(0, Number(l.period) || fallback[i]?.period || 5),
      color: String(l.color || fallback[i]?.color || "#8b9199"),
      name: String(l.name || `MA${l.period || fallback[i]?.period || i + 1}`),
      width: Math.max(0, Number(l.width ?? fallback[i]?.width ?? 1)),
      lineType: (l as MaLineStyle).lineType ?? fallback[i]?.lineType ?? "solid",
    }));
  } catch {
    return cloneLines(fallback);
  }
}

function defaultMacd(): MacdParams {
  return { short: MACD_SHORT, long: MACD_LONG, mm: MACD_MM };
}

function loadMacd(): MacdParams {
  try {
    const raw = localStorage.getItem(MACD_KEY);
    if (!raw) return defaultMacd();
    const p = JSON.parse(raw) as Partial<MacdParams>;
    return {
      short: Math.max(2, Number(p.short) || MACD_SHORT),
      long: Math.max(3, Number(p.long) || MACD_LONG),
      mm: Math.max(2, Number(p.mm) || MACD_MM),
    };
  } catch {
    return defaultMacd();
  }
}

/** 主图 12 根均线 + 量能均线 + MACD(SHORT/LONG/MM) 配置（持久化）。 */
export function useMaConfig() {
  const maLines = ref<MaLineStyle[]>(loadLines(MA_KEY, THS_MA_LINES_12));
  const volMaLines = ref<MaLineStyle[]>(loadLines(VOL_MA_KEY, THS_VOL_MA_LINES));
  const macdParams = ref<MacdParams>(loadMacd());

  while (maLines.value.length < 12) {
    const i = maLines.value.length;
    maLines.value.push({
      period: 0,
      color: THS_MA_LINES_12[i % THS_MA_LINES_12.length].color,
      name: `MA${i + 1}`,
      width: 0,
    });
  }
  if (maLines.value.length > 12) maLines.value = maLines.value.slice(0, 12);

  watch(
    maLines,
    (v) => localStorage.setItem(MA_KEY, JSON.stringify(v)),
    { deep: true },
  );
  watch(
    volMaLines,
    (v) => localStorage.setItem(VOL_MA_KEY, JSON.stringify(v)),
    { deep: true },
  );
  watch(
    macdParams,
    (v) => localStorage.setItem(MACD_KEY, JSON.stringify(v)),
    { deep: true },
  );

  function resetMa() {
    maLines.value = cloneLines(THS_MA_LINES_12);
  }

  function resetVolMa() {
    volMaLines.value = cloneLines(THS_VOL_MA_LINES);
  }

  function resetMacd() {
    macdParams.value = defaultMacd();
  }

  return { maLines, volMaLines, macdParams, resetMa, resetVolMa, resetMacd };
}
