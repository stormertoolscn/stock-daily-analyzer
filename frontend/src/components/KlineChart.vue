<script setup lang="ts">
/**
 * ECharts K线 / 分时组件外壳。
 * 渲染逻辑全部委托 kline-engine；本组件只持有实例、十字线索引，
 * 以及同花顺式方向键缩放：↑ 放大（天数变少）/ ↓ 缩小（天数变多），按住连续缩放。
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
  stockCode?: string;
  stockName?: string;
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

const ZOOM_FACTOR = 0.9; // 每帧相对缩放
const ZOOM_TICK_MS = 35;
const MIN_VISIBLE_BARS = 15;

let holdTimer: ReturnType<typeof setInterval> | null = null;
let holdKey: "ArrowUp" | "ArrowDown" | null = null;

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
  // getOption 里 type/start/end 常被包成数组；优先读 slider
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
  requestAnimationFrame(() => emitPriceExtent());
}

/** direction: in = 放大(天数变少), out = 缩小(天数变多)；锚定右侧最新K线 */
function zoomStep(direction: "in" | "out") {
  if (!chart || !props.bars.length) return;
  const { start, end } = readZoom();
  let span = Math.max(0.5, end - start);
  const minSpan = Math.max(
    2,
    Math.min(100, (MIN_VISIBLE_BARS / props.bars.length) * 100),
  );

  if (direction === "in") {
    span = Math.max(minSpan, span * ZOOM_FACTOR);
  } else {
    span = Math.min(100, span / ZOOM_FACTOR);
  }

  // 右侧锚定：尽量保持 end 不变
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

function stopZoomHold() {
  if (holdTimer != null) {
    clearInterval(holdTimer);
    holdTimer = null;
  }
  holdKey = null;
}

function startZoomHold(direction: "in" | "out", key: "ArrowUp" | "ArrowDown") {
  stopZoomHold();
  holdKey = key;
  zoomStep(direction);
  holdTimer = setInterval(() => zoomStep(direction), ZOOM_TICK_MS);
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
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  // 浏览器 key repeat 会连发 keydown；我们用自己的 interval，忽略 repeat
  if (e.repeat) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  startZoomHold(e.key === "ArrowUp" ? "in" : "out", e.key);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (holdKey === e.key || holdKey != null) stopZoomHold();
  }
}

function onWindowBlur() {
  stopZoomHold();
}

function render() {
  if (!chart) return;
  const key = barsKey();
  if (key !== lastBarsKey) {
    savedZoom = null;
    lastBarsKey = key;
  }

  engine.setTheme(props.config?.theme ?? getAShareTheme());
  chart.setOption(
    engine.buildOption(props.bars, {
      mode: props.mode ?? "candle",
      prevClose: props.prevClose,
      showGaps: props.showGaps !== false,
      showAuction: props.showAuction !== false,
      showSlider: false,
      showFeatures: props.showFeatures !== false,
      stockCode: props.stockCode,
      stockName: props.stockName,
      maLines: props.maLines,
      volMaLines: props.volMaLines,
      zoomStart: savedZoom?.start,
      zoomEnd: savedZoom?.end,
    }),
    { notMerge: true, lazyUpdate: false },
  );

  if (!savedZoom) {
    savedZoom = readZoom();
  }
}

function handleResize() {
  chart?.resize();
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
  emit("update:hoverIndex", idx >= 0 ? idx : null);
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
  emitPriceExtent();
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
  chart.getZr().on("globalout", () => emit("update:hoverIndex", null));
  chart.on("updateAxisPointer", handleAxisPointer);
  chart.on("datazoom", handleDataZoom);
  chart.on("finished", emitPriceExtent);
  chart.on("dblclick", handleDblClick);
  render();
  // setOption 后下一帧再读刻度，避免 scale 未就绪
  requestAnimationFrame(() => emitPriceExtent());

  // 筹码区展开/拖拽会改变容器宽度，必须跟着重算，否则遮挡或留白
  resizeObs = new ResizeObserver(() => {
    handleResize();
    requestAnimationFrame(() => emitPriceExtent());
  });
  resizeObs.observe(containerRef.value);
  // 同时观察父级（.ths-chart-main），宽度变化更稳
  const parent = containerRef.value.parentElement;
  if (parent) resizeObs.observe(parent);

  window.addEventListener("resize", handleResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
});

onBeforeUnmount(() => {
  stopZoomHold();
  resizeObs?.disconnect();
  resizeObs = null;
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", onWindowBlur);
  chart?.off("updateAxisPointer", handleAxisPointer);
  chart?.off("datazoom", handleDataZoom);
  chart?.off("finished", emitPriceExtent);
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
      props.stockCode,
      props.stockName,
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
