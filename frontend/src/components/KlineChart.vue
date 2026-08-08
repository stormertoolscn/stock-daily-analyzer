<script setup lang="ts">
/**
 * ECharts K线 / 分时组件外壳。
 * 渲染逻辑全部委托 kline-engine；本组件只持有实例、十字线索引，
 * 以及通达信/同花顺式方向键：
 * ← / → 移动十字线（到最旧 / 最新）；↑ 收缩 K 线；↓ 放开 K 线。
 */
import * as echarts from "echarts";
import { onBeforeUnmount, onMounted, shallowRef, watch } from "vue";

import { createKlineEngine, getAShareTheme } from "@/kline-engine";
import type {
  ChartMode,
  KlineBar,
  KlineRenderConfig,
} from "@/kline-engine";

const props = defineProps<{
  bars: KlineBar[];
  mode?: ChartMode;
  prevClose?: number | null;
  /** 显示跳空缺口，默认 true */
  showGaps?: boolean;
  /** 分时显示集合竞价，默认 true */
  showAuction?: boolean;
  /** 主图均线 */
  maLines?: import("@/kline-engine").MaLineStyle[];
  /** 量能均线 */
  volMaLines?: import("@/kline-engine").MaLineStyle[];
  /** 底部区域滑条（已关闭，默认不显示） */
  showSlider?: boolean;
  /** 通达信特征叠加 */
  showFeatures?: boolean;
  /** 日/周/月等周期，用于过滤日线级涨停提示 */
  klinePeriod?: "intraday" | "day" | "week" | "month";
  stockCode?: string;
  stockName?: string;
  /** 分时区间高亮（bars 下标） */
  rangeStart?: number | null;
  rangeEnd?: number | null;
  macdShort?: number;
  macdLong?: number;
  macdMm?: number;
  config?: Partial<KlineRenderConfig>;
}>();

const emit = defineEmits<{
  "update:hoverIndex": [index: number | null];
  "update:priceExtent": [extent: { min: number; max: number } | null];
  "dblclick-bar": [index: number];
}>();

const containerRef = shallowRef<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
const engine = createKlineEngine(props.config);

/** 记住当前缩放，避免 setOption 全量刷新后跳回默认窗口 */
let savedZoom: { start: number; end: number } | null = null;
let lastBarsKey = "";
/** 键盘/鼠标十字线当前位置（bars 下标） */
let cursorIndex: number | null = null;
/** 鼠标/键盘十字线当前是否可见（决定缩放锚点） */
let crosshairActive = false;
/** 按住方向键缩放时锁定的锚点 K 线（避免逐 tick 漂移） */
let holdAnchor: number | null = null;

const ZOOM_FACTOR = 0.9;
const HOLD_TICK_MS = 35;
const MIN_VISIBLE_BARS = 15;

type HoldKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
let holdTimer: ReturnType<typeof setInterval> | null = null;
let holdKey: HoldKey | null = null;
let extentTimer: ReturnType<typeof setTimeout> | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

function barsKey(): string {
  const bars = props.bars;
  if (!bars.length) return "";
  return `${props.mode ?? "candle"}:${bars.length}:${bars[0].timestamp}:${bars[bars.length - 1].timestamp}`;
}

function categoryLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (props.mode === "intraday") {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function scheduleEmitPriceExtent() {
  if (extentTimer) clearTimeout(extentTimer);
  extentTimer = setTimeout(() => {
    extentTimer = null;
    emitPriceExtent();
  }, 80);
}

function unwrapZoomNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v) && typeof v[0] === "number" && Number.isFinite(v[0])) {
    return v[0];
  }
  return null;
}

function readZoom(): { start: number; end: number } {
  if (!chart) return { start: 0, end: 100 };
  const opt = chart.getOption() as {
    dataZoom?: Array<Record<string, unknown>>;
  };
  const zooms = opt.dataZoom ?? [];
  const pick =
    zooms.find((z) => {
      const t = z.type;
      return t === "slider" || (Array.isArray(t) && t[0] === "slider");
    }) ?? zooms[0];
  return {
    start: unwrapZoomNum(pick?.start) ?? 0,
    end: unwrapZoomNum(pick?.end) ?? 100,
  };
}

function applyZoom(start: number, end: number) {
  if (!chart) return;
  const s = Math.max(0, Math.min(100, start));
  const e = Math.max(0, Math.min(100, end));
  if (e - s < 0.5) return;
  savedZoom = { start: s, end: e };
  chart.dispatchAction({
    type: "dataZoom",
    start: s,
    end: e,
  });
  scheduleEmitPriceExtent();
}

/** ↑ 收缩（放大）；↓ 放开（缩小）。
 * 有十字线时锚定十字线所在 K 线（缩放后它不逃出窗口）；否则锚定右侧最新。 */
function zoomStep(direction: "in" | "out") {
  if (!chart || !props.bars.length) return;
  const n = props.bars.length;
  const { start, end } = readZoom();
  let span = Math.max(0.5, end - start);
  const minSpan = Math.max(
    2,
    Math.min(100, (MIN_VISIBLE_BARS / n) * 100),
  );

  if (direction === "in") {
    span = Math.max(minSpan, span * ZOOM_FACTOR);
  } else {
    span = Math.min(100, span / ZOOM_FACTOR);
  }

  const anchor =
    holdAnchor != null && holdAnchor >= 0 && holdAnchor < n ? holdAnchor : null;
  if (anchor != null && n > 1) {
    // 锚定十字线所在 K 线：按其在窗口内的比例，让它在缩放后仍停留在原屏幕位置
    const a = (start / 100) * n;
    const b = (end / 100) * n;
    const spanU = Math.max(0.5, b - a);
    const u = anchor + 0.5;
    const f = Math.max(0, Math.min(1, (u - a) / spanU));
    const newSpanU = (span / 100) * n;
    let a2 = u - f * newSpanU;
    let b2 = a2 + newSpanU;
    if (a2 < 0) {
      a2 = 0;
      b2 = newSpanU;
    }
    if (b2 > n) {
      b2 = n;
      a2 = Math.max(0, n - newSpanU);
    }
    applyZoom((a2 / n) * 100, (b2 / n) * 100);
    return;
  }

  // 无十字线：保持现有右端锚定行为
  let nextEnd = end;
  let nextStart = nextEnd - span;
  if (nextStart < 0) {
    nextStart = 0;
    nextEnd = Math.min(100, span);
  }
  if (nextEnd > 100) {
    nextEnd = 100;
    nextStart = Math.max(0, nextEnd - span);
  }
  applyZoom(nextStart, nextEnd);
}

function visibleIndexRange(): { lo: number; hi: number } {
  const n = props.bars.length;
  if (n <= 0) return { lo: 0, hi: 0 };
  const { start, end } = readZoom();
  const lo = Math.max(0, Math.floor((start / 100) * (n - 1)));
  const hi = Math.min(n - 1, Math.ceil((end / 100) * (n - 1)));
  return { lo, hi: Math.max(lo, hi) };
}

/** 保证十字线落在可视区内；贴边时平移窗口 */
function ensureCursorVisible(idx: number) {
  const n = props.bars.length;
  if (n <= 1 || !chart) return;
  const { start, end } = readZoom();
  const span = Math.max(0.5, end - start);
  const pct = (idx / (n - 1)) * 100;
  const margin = Math.min(4, span * 0.08);
  if (pct < start + margin) {
    let ns = Math.max(0, pct - margin);
    let ne = ns + span;
    if (ne > 100) {
      ne = 100;
      ns = Math.max(0, ne - span);
    }
    applyZoom(ns, ne);
  } else if (pct > end - margin) {
    let ne = Math.min(100, pct + margin);
    let ns = ne - span;
    if (ns < 0) {
      ns = 0;
      ne = Math.min(100, span);
    }
    applyZoom(ns, ne);
  }
}

function showCursorAt(idx: number) {
  if (!chart || !props.bars.length) return;
  const n = props.bars.length;
  const i = Math.max(0, Math.min(n - 1, idx));
  cursorIndex = i;
  crosshairActive = true;
  ensureCursorVisible(i);

  // dataZoom 后坐标系会变，下一帧再取像素，保证竖线贴准
  requestAnimationFrame(() => placeAxisPointer(i));
}

function placeAxisPointer(i: number) {
  if (!chart || !props.bars.length) return;
  const opt = chart.getOption() as {
    xAxis?: Array<{ data?: string[] }> | { data?: string[] };
  };
  const xAxis0 = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
  const cat = xAxis0?.data?.[i];

  let xPixel: number | null = null;
  const tryX = (finder: object, value: unknown) => {
    try {
      const x = chart!.convertToPixel(finder, value as never);
      if (typeof x === "number" && Number.isFinite(x)) return x;
      if (Array.isArray(x) && Number.isFinite(x[0])) return x[0] as number;
    } catch {
      /* ignore */
    }
    return null;
  };

  if (cat != null) xPixel = tryX({ xAxisIndex: 0 }, cat);
  if (xPixel == null) xPixel = tryX({ xAxisIndex: 0 }, i);
  if (xPixel == null) {
    xPixel = tryX({ seriesId: "kline-candle" }, [i, props.bars[i].close]);
  }
  if (xPixel == null) {
    xPixel = tryX({ seriesIndex: 0 }, [i, props.bars[i].close]);
  }
  if (xPixel == null || !Number.isFinite(xPixel)) return;

  const height = chart.getHeight();
  const yPixel = Math.max(20, Math.min(height - 20, height * 0.28));

  chart.dispatchAction({
    type: "updateAxisPointer",
    currTrigger: "mousemove",
    x: xPixel,
    y: yPixel,
  });
  chart.dispatchAction({
    type: "showTip",
    x: xPixel,
    y: yPixel,
  });

  const zr = chart.getZr();
  const handler = (
    zr as unknown as {
      handler?: {
        dispatch: (type: string, event: Record<string, unknown>) => void;
      };
    }
  ).handler;
  handler?.dispatch("mousemove", {
    zrX: xPixel,
    zrY: yPixel,
    preventDefault() {},
    stopImmediatePropagation() {},
    stopPropagation() {},
  });

  emit("update:hoverIndex", i);
  containerRef.value?.focus({ preventScroll: true });
}

/** ← 更旧；→ 更新 */
function moveCursor(delta: number) {
  if (!props.bars.length) return;
  const n = props.bars.length;
  let cur = cursorIndex;
  if (cur == null || cur < 0 || cur >= n) {
    const { lo, hi } = visibleIndexRange();
    cur = delta > 0 ? hi : lo;
  }
  const next = Math.max(0, Math.min(n - 1, cur + delta));
  if (next === cursorIndex && (next === 0 || next === n - 1)) return;
  showCursorAt(next);
}

function stopHold() {
  if (holdTimer != null) {
    clearInterval(holdTimer);
    holdTimer = null;
  }
  holdKey = null;
  holdAnchor = null;
}

function startHold(key: HoldKey, tick: () => void) {
  stopHold();
  holdKey = key;
  tick();
  holdTimer = setInterval(tick, HOLD_TICK_MS);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function onKeyDown(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  // Alt+← 留给布局「返回上一页」
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  const key = e.key;
  if (
    key !== "ArrowUp" &&
    key !== "ArrowDown" &&
    key !== "ArrowLeft" &&
    key !== "ArrowRight"
  ) {
    return;
  }
  if (e.repeat) {
    e.preventDefault();
    return;
  }
  e.preventDefault();

  if (key === "ArrowUp" || key === "ArrowDown") {
    // 十字线可见时锁定该 K 线为缩放锚点；否则保持右端锚定
    holdAnchor = crosshairActive ? cursorIndex : null;
    startHold(key, () =>
      key === "ArrowUp" ? zoomStep("in") : zoomStep("out"),
    );
  } else if (key === "ArrowLeft") {
    holdAnchor = null;
    startHold(key, () => moveCursor(-1));
  } else if (key === "ArrowRight") {
    holdAnchor = null;
    startHold(key, () => moveCursor(1));
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (
    e.key === "ArrowUp" ||
    e.key === "ArrowDown" ||
    e.key === "ArrowLeft" ||
    e.key === "ArrowRight"
  ) {
    if (holdKey === e.key || holdKey != null) stopHold();
  }
}

function onWindowBlur() {
  stopHold();
}

function render() {
  if (!chart) return;
  const key = barsKey();
  if (key !== lastBarsKey) {
    savedZoom = null;
    lastBarsKey = key;
    cursorIndex = null;
  }

  engine.setTheme(props.config?.theme ?? getAShareTheme());
  const rs = props.rangeStart;
  const re = props.rangeEnd;
  const rangeHighlight =
    props.mode === "intraday" &&
    typeof rs === "number" &&
    typeof re === "number"
      ? { start: rs, end: re }
      : null;
  chart.setOption(
    engine.buildOption(props.bars, {
      mode: props.mode ?? "candle",
      prevClose: props.prevClose,
      showGaps: props.showGaps !== false,
      showAuction: props.showAuction !== false,
      showSlider: false,
      showFeatures: props.showFeatures !== false,
      klinePeriod: props.klinePeriod ?? "day",
      stockCode: props.stockCode,
      stockName: props.stockName,
      maLines: props.maLines,
      volMaLines: props.volMaLines,
      zoomStart: savedZoom?.start,
      zoomEnd: savedZoom?.end,
      containerWidth: containerRef.value?.clientWidth,
      rangeHighlight,
      macdShort: props.macdShort,
      macdLong: props.macdLong,
      macdMm: props.macdMm,
    }),
    { notMerge: true, lazyUpdate: false },
  );

  if (!savedZoom) {
    savedZoom = readZoom();
  }
}

function handleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    chart?.resize();
    scheduleEmitPriceExtent();
  }, 80);
}

function handleAxisPointer(event: unknown) {
  const e = event as {
    axesInfo?: Array<{ value?: number | string; axisDim?: string }>;
  };
  const info = e.axesInfo?.find((a) => a.axisDim === "x") ?? e.axesInfo?.[0];
  if (!info || info.value == null) {
    emit("update:hoverIndex", null);
    return;
  }
  const idx =
    typeof info.value === "number"
      ? info.value
      : props.bars.findIndex(
          (b) => categoryLabel(b.timestamp) === String(info.value),
        );
  if (idx >= 0) {
    cursorIndex = idx;
    crosshairActive = true;
    emit("update:hoverIndex", idx);
  } else {
    crosshairActive = false;
    emit("update:hoverIndex", null);
  }
}

function handleDataZoom(raw: unknown) {
  const e = raw as {
    start?: number;
    end?: number;
    batch?: Array<{ start?: number; end?: number }>;
  };
  const item = e.batch?.[0] ?? e;
  if (typeof item.start === "number" && typeof item.end === "number") {
    savedZoom = { start: item.start, end: item.end };
  } else {
    savedZoom = readZoom();
  }
  // 柱宽已是百分比，缩放不再 setOption；仅低频同步筹码 Y 轴
  scheduleEmitPriceExtent();
}

/** 读取主图 yAxis 实际刻度范围，供右侧筹码 Y 轴对齐 */
function emitPriceExtent() {
  if (!chart) {
    emit("update:priceExtent", null);
    return;
  }
  try {
    // ECharts 未公开 getModel，运行时可用
    const model = (
      chart as unknown as {
        getModel: () => {
          getComponent: (
            name: string,
            index: number,
          ) => { axis?: { scale?: { getExtent?: () => number[] } } } | undefined;
        };
      }
    ).getModel();
    const yAxis = model.getComponent("yAxis", 0);
    const extent = yAxis?.axis?.scale?.getExtent?.();
    if (
      extent &&
      extent.length >= 2 &&
      Number.isFinite(extent[0]) &&
      Number.isFinite(extent[1]) &&
      extent[1] > extent[0]
    ) {
      emit("update:priceExtent", { min: extent[0], max: extent[1] });
      return;
    }
  } catch {
    /* ignore */
  }
  emit("update:priceExtent", null);
}

function handleDblClick(event: unknown) {
  const e = event as {
    componentType?: string;
    seriesType?: string;
    dataIndex?: number;
  };
  // 优先十字线索引：dataZoom filter 后 series dataIndex 可能错位
  if (cursorIndex != null && cursorIndex >= 0 && cursorIndex < props.bars.length) {
    emit("dblclick-bar", cursorIndex);
    return;
  }
  if (e.componentType !== "series") return;
  if (e.seriesType !== "candlestick" && e.seriesType !== "line") return;
  if (typeof e.dataIndex !== "number" || e.dataIndex < 0) return;
  if (e.dataIndex >= props.bars.length) return;
  emit("dblclick-bar", e.dataIndex);
}

let resizeObs: ResizeObserver | null = null;

onMounted(() => {
  if (!containerRef.value) return;
  chart = echarts.init(containerRef.value, undefined, { renderer: "canvas" });
  // 鼠标离开时不清空键盘十字位置，便于继续用方向键移动
  chart.getZr().on("globalout", () => {
    crosshairActive = false;
    if (cursorIndex == null) emit("update:hoverIndex", null);
  });
  chart.on("updateAxisPointer", handleAxisPointer);
  chart.on("datazoom", handleDataZoom);
  chart.on("dblclick", handleDblClick);
  // 点击画布抢焦点，方向键才能生效
  containerRef.value.addEventListener("mousedown", () => {
    containerRef.value?.focus({ preventScroll: true });
  });
  render();
  scheduleEmitPriceExtent();

  resizeObs = new ResizeObserver(() => handleResize());
  resizeObs.observe(containerRef.value);
  const parent = containerRef.value.parentElement;
  if (parent) resizeObs.observe(parent);

  window.addEventListener("resize", handleResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
});

onBeforeUnmount(() => {
  stopHold();
  if (resizeTimer) clearTimeout(resizeTimer);
  if (extentTimer) clearTimeout(extentTimer);
  resizeObs?.disconnect();
  resizeObs = null;
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", onWindowBlur);
  chart?.off("updateAxisPointer", handleAxisPointer);
  chart?.off("datazoom", handleDataZoom);
  chart?.off("dblclick", handleDblClick);
  chart?.dispose();
  chart = null;
});

watch(
  () =>
    [
      props.bars,
      props.mode,
      props.prevClose,
      props.showGaps,
      props.showAuction,
      props.showSlider,
      props.showFeatures,
      props.klinePeriod,
      props.stockCode,
      props.stockName,
      props.rangeStart,
      props.rangeEnd,
      props.macdShort,
      props.macdLong,
      props.macdMm,
      // 避免 deep watch 在拖动/十字线时误触发全量 setOption 把视窗钉死
      JSON.stringify(props.maLines ?? null),
      JSON.stringify(props.volMaLines ?? null),
    ] as const,
  () => {
    render();
    requestAnimationFrame(() => emitPriceExtent());
  },
);

defineExpose({ engine });
</script>

<template>
  <div
    ref="containerRef"
    class="ths-chart-canvas h-full w-full outline-none"
    tabindex="0"
  ></div>
</template>
