import { ref, watch } from "vue";

import {
  THS_MA_LINES_12,
  THS_VOL_MA_LINES,
  type MaLineStyle,
} from "@/kline-engine";

const MA_KEY = "sda-ma-lines-v1";
const VOL_MA_KEY = "sda-vol-ma-lines-v1";

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
    }));
  } catch {
    return cloneLines(fallback);
  }
}

/** 主图 12 根均线 + 量能均线配置（持久化）。 */
export function useMaConfig() {
  const maLines = ref<MaLineStyle[]>(loadLines(MA_KEY, THS_MA_LINES_12));
  const volMaLines = ref<MaLineStyle[]>(loadLines(VOL_MA_KEY, THS_VOL_MA_LINES));

  // 保证主图始终 12 槽
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

  function resetMa() {
    maLines.value = cloneLines(THS_MA_LINES_12);
  }

  function resetVolMa() {
    volMaLines.value = cloneLines(THS_VOL_MA_LINES);
  }

  return { maLines, volMaLines, resetMa, resetVolMa };
}
