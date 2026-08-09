<script setup lang="ts">
/**
 * ECharts K线 / 分时组件外壳。
 * 渲染逻辑全部委托 kline-engine；本组件只持有实例、十字线索引，
 * 以及通达信/同花顺式方向键：
 * ← / → 移动十字线（到最旧 / 最新）；↑ 收缩 K 线；↓ 放开 K 线。
 */
import * as echarts from "echarts";
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";

import RangeStatsDialog from "@/components/RangeStatsDialog.vue";
import type { RangeStatsDetail } from "@/components/RangeStatsDialog.vue";
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
  /** 复权说明，如「前复权」 */
  adjustLabel?: string;
  /** 分时区间高亮（bars 下标） */
  rangeStart?: number | null;
  rangeEnd?: number | null;
  macdShort?: number;
  macdLong?: number;
  macdMm?: number;
  /** 章盟主等额外买卖点 */
  extraMarkPoints?: import("@/kline-engine").BuildOptionParams["extraMarkPoints"];
  config?: Partial<KlineRenderConfig>;
}>();

export type RangeStatsPayload = RangeStatsDetail;

const emit = defineEmits<{
  "update:hoverIndex": [index: number | null];
  "update:priceExtent": [extent: { min: number; max: number } | null];
  "dblclick-bar": [index: number];
  "range-stats": [payload: RangeStatsPayload];
  "pattern-match": [payload: { mode: "select" | "all"; from: number; to: number }];
}>();

const containerRef = shallowRef<HTMLDivElement | null>(null);
const wrapRef = shallowRef<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
const engine = createKlineEngine(props.config);

/** 记住当前缩放，避免 setOption 全量刷新后跳回默认窗口 */
let savedZoom: { start: number; end: number } | null = null;
let lastBarsKey = "";
/** 键盘/鼠标十字线当前位置（bars 下标） */
let cursorIndex: number | null = null;
/** 按住方向键缩放时锁定的锚点 K 线（避免逐 tick 漂移） */
let holdAnchor: number | null = null;

const ZOOM_FACTOR = 0.9;
const HOLD_TICK_MS = 35;
const MIN_VISIBLE_BARS = 15;
const LONG_PRESS_MS = 180;
const DRAG_THRESHOLD_PX = 6;

type HoldKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
let holdTimer: ReturnType<typeof setInterval> | null = null;
let holdKey: HoldKey | null = null;
let extentTimer: ReturnType<typeof setTimeout> | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

/** 框选：left=实线拉区间缩放；right=虚线拉区间菜单 */
type BrushButton = "left" | "right";
type BrushState = {
  button: BrushButton;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  active: boolean;
  pointerId: number | null;
  longPressTimer: ReturnType<typeof setTimeout> | null;
};
let brush: BrushState | null = null;

const brushBox = reactive({
  show: false,
  dashed: false,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
});

/** 框选激活后盖一层，挡住 ECharts 抢拖动 */
const brushCapture = reactive({
  show: false,
});

const rangeMenu = reactive({
  show: false,
  x: 0,
  y: 0,
  from: 0,
  to: 0,
});

const statsPanel = reactive<{
  show: boolean;
  data: RangeStatsDetail | null;
}>({ show: false, data: null });

/** 右键框选区间线（保留区间线） */
const rangeBand = reactive({
  show: false,
  left: 0,
  width: 0,
});


const patternToast = ref("");
let patternToastTimer: ReturnType<typeof setTimeout> | null = null;

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
  const n = props.bars.length;
  const minSpan = Math.max(
    0.05,
    Math.min(100, (MIN_VISIBLE_BARS / Math.max(1, n)) * 100),
  );
  let s = Math.max(0, Math.min(100, start));
  let e = Math.max(0, Math.min(100, end));
  if (e < s) {
    const t = s;
    s = e;
    e = t;
  }
  if (e - s < minSpan) {
    const mid = (s + e) / 2;
    s = Math.max(0, mid - minSpan / 2);
    e = Math.min(100, s + minSpan);
    s = Math.max(0, e - minSpan);
  }
  savedZoom = { start: s, end: e };
  chart.dispatchAction({
    type: "dataZoom",
    start: s,
    end: e,
  });
  scheduleEmitPriceExtent();
}

/** ↑ 收缩（放大）；↓ 放开（缩小）。
 * 有十字线（含键盘留下的竖线位置）且在当前窗口内时，锚定它所在 K 线，缩放后不逃出窗口；
 * 否则锚定窗口正中的 K 线，围绕窗口中心缩放，两侧对称收放。 */
function zoomStep(direction: "in" | "out") {
  if (!chart || !props.bars.length) return;
  const n = props.bars.length;
  // ECharts dataZoom 百分比映射到类别轴值 0..n-1（与 visibleIndexRange 一致）
  const extent = Math.max(1, n - 1);
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

  const a = (start / 100) * extent;
  const b = (end / 100) * extent;
  const spanU = Math.max(0.5, b - a);
  const newSpanU = (span / 100) * extent;

  // 锚点：十字线所在 K 线在窗口内时用它；否则用窗口正中的 K 线（保证缩放稳定居中）
  let u: number;
  if (
    holdAnchor != null &&
    holdAnchor >= 0 &&
    holdAnchor < n &&
    holdAnchor >= a &&
    holdAnchor <= b
  ) {
    u = holdAnchor;
  } else {
    u = Math.max(0, Math.min(extent, Math.round((a + b) / 2)));
  }
  const f = Math.max(0, Math.min(1, (u - a) / spanU));
  let a2 = u - f * newSpanU;
  let b2 = a2 + newSpanU;
  if (a2 < 0) {
    a2 = 0;
    b2 = newSpanU;
  }
  if (b2 > extent) {
    b2 = extent;
    a2 = Math.max(0, extent - newSpanU);
  }
  applyZoom((a2 / extent) * 100, (b2 / extent) * 100);
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
    // 锁定十字线所在（或最后一次所在）的 K 线为缩放锚点；没有则围绕窗口中心缩放
    holdAnchor = cursorIndex;
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
      extraMarkPoints: props.extraMarkPoints,
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
    emit("update:hoverIndex", idx);
  } else {
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

function localPoint(ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const el = wrapRef.value ?? containerRef.value;
  if (!el) return { x: ev.clientX, y: ev.clientY };
  const r = el.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

/** 取主图 grid 像素矩形（dataZoom filter 下 convertFromPixel 不可靠） */
function mainGridRect(): { x: number; y: number; width: number; height: number } {
  if (!chart) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  try {
    // ECharts 类型中 getModel 为私有，运行时可用（与 emitPriceExtent 同一写法）
    const model = (
      chart as unknown as {
        getModel: () => {
          getComponent: (
            name: string,
            index: number,
          ) => {
            coordinateSystem?: {
              getRect?: () => {
                x: number;
                y: number;
                width: number;
                height: number;
              };
            };
          } | undefined;
        };
      }
    ).getModel();
    const grid = model.getComponent("grid", 0) as
      | { coordinateSystem?: { getRect?: () => { x: number; y: number; width: number; height: number } } }
      | undefined;
    const rect = grid?.coordinateSystem?.getRect?.();
    if (rect && rect.width > 0) {
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
  } catch {
    /* ignore */
  }
  const w = chart.getWidth() || 1;
  const h = chart.getHeight() || 1;
  return { x: 0, y: 0, width: w, height: h };
}

/** 像素 X → 全局 bars 下标（按当前可视窗口比例） */
function pixelToBarIndex(x: number): number {
  if (!chart || !props.bars.length) return 0;
  const n = props.bars.length;
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, Math.round(i)));
  const { lo, hi } = visibleIndexRange();
  const grid = mainGridRect();
  const t = Math.max(0, Math.min(1, (x - grid.x) / Math.max(1, grid.width)));
  return clamp(lo + t * (hi - lo));
}

function updateBrushBox() {
  if (!brush?.active) {
    brushBox.show = false;
    brushCapture.show = false;
    return;
  }
  const x1 = Math.min(brush.startX, brush.curX);
  const y1 = Math.min(brush.startY, brush.curY);
  const x2 = Math.max(brush.startX, brush.curX);
  const y2 = Math.max(brush.startY, brush.curY);
  brushBox.show = true;
  brushBox.dashed = brush.button === "right";
  brushBox.left = x1;
  brushBox.top = y1;
  brushBox.width = Math.max(1, x2 - x1);
  brushBox.height = Math.max(1, y2 - y1);
  brushCapture.show = true;
}

function clearBrush() {
  if (brush?.longPressTimer) clearTimeout(brush.longPressTimer);
  brush = null;
  brushBox.show = false;
  brushCapture.show = false;
}

function formatBarDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildRangeStats(from: number, to: number): RangeStatsDetail | null {
  const bars = props.bars;
  if (!bars.length) return null;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(bars.length - 1, Math.max(from, to));
  if (b < a) return null;

  const prevClose = a > 0 ? bars[a - 1].close : bars[a].open;
  let high = -Infinity;
  let low = Infinity;
  let volumeSum = 0;
  let amountSum = 0;
  let closeSum = 0;
  let yangCount = 0;
  let yinCount = 0;
  let flatCandleCount = 0;
  let upCount = 0;
  let downCount = 0;
  let flatDayCount = 0;
  let peak = prevClose;
  let maxRisePct = 0;
  let maxDrawdownPct = 0;
  const rets: number[] = [];

  for (let i = a; i <= b; i += 1) {
    const bar = bars[i];
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
    volumeSum += bar.volume;
    const typical = (bar.high + bar.low + bar.close) / 3;
    amountSum += typical * bar.volume;
    closeSum += bar.close;

    if (bar.close > bar.open) yangCount += 1;
    else if (bar.close < bar.open) yinCount += 1;
    else flatCandleCount += 1;

    const prev = i > 0 ? bars[i - 1].close : prevClose;
    if (bar.close > prev) upCount += 1;
    else if (bar.close < prev) downCount += 1;
    else flatDayCount += 1;

    if (prevClose > 0) {
      maxRisePct = Math.max(maxRisePct, ((bar.high - prevClose) / prevClose) * 100);
    }
    peak = Math.max(peak, bar.high);
    if (peak > 0) {
      const dd = ((bar.low - peak) / peak) * 100;
      if (dd < maxDrawdownPct) maxDrawdownPct = dd;
    }
    if (prev > 0) {
      rets.push((bar.close - prev) / prev);
    }
  }

  const count = b - a + 1;
  const open = bars[a].open;
  const close = bars[b].close;
  const change = close - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const amplitude = high - low;
  const amplitudePct = prevClose !== 0 ? (amplitude / prevClose) * 100 : 0;
  const avgClose = closeSum / count;
  const weightedAvg = volumeSum > 0 ? amountSum / volumeSum : avgClose;
  const calendarDays = Math.max(
    1,
    Math.round((bars[b].timestamp - bars[a].timestamp) / 86400000) + 1,
  );

  let annualizedPct: number | null = null;
  if (prevClose > 0 && calendarDays > 0) {
    const totalRet = close / prevClose;
    if (totalRet > 0) {
      annualizedPct = (totalRet ** (365 / calendarDays) - 1) * 100;
    }
  }

  let volatilityPct: number | null = null;
  let sharpe: number | null = null;
  if (rets.length >= 2) {
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const variance =
      rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
    const std = Math.sqrt(Math.max(0, variance));
    volatilityPct = std * 100;
    if (std > 1e-12) sharpe = mean / std;
  }

  return {
    from: a,
    to: b,
    startDate: formatBarDate(bars[a].timestamp),
    endDate: formatBarDate(bars[b].timestamp),
    bars: count,
    calendarDays,
    prevClose,
    open,
    high,
    low,
    close,
    volumeSum,
    avgVolume: volumeSum / count,
    amountSum,
    avgAmount: amountSum / count,
    avgClose,
    weightedAvg,
    change,
    changePct,
    amplitude,
    amplitudePct,
    maxRisePct,
    maxDrawdownPct,
    annualizedPct,
    yangCount,
    yinCount,
    flatCandleCount,
    upCount,
    downCount,
    flatDayCount,
    volatilityPct,
    sharpe,
  };
}

function updateRangeBand(from: number, to: number) {
  if (!chart || !wrapRef.value) {
    rangeBand.show = false;
    return;
  }
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  try {
    const x0 = chart.convertToPixel({ xAxisIndex: 0 }, a);
    const x1 = chart.convertToPixel({ xAxisIndex: 0 }, b);
    const left = typeof x0 === "number" ? x0 : Array.isArray(x0) ? x0[0] : null;
    const right = typeof x1 === "number" ? x1 : Array.isArray(x1) ? x1[0] : null;
    if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) {
      rangeBand.show = false;
      return;
    }
    rangeBand.show = true;
    rangeBand.left = Math.min(left, right);
    rangeBand.width = Math.max(2, Math.abs(right - left));
  } catch {
    rangeBand.show = false;
  }
}

function zoomToIndexRange(from: number, to: number) {
  const n = props.bars.length;
  if (n <= 1) return;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(n - 1, Math.max(from, to));
  const pad = Math.max(0, Math.floor((b - a) * 0.02));
  const lo = Math.max(0, a - pad);
  const hi = Math.min(n - 1, b + pad);
  const extent = Math.max(1, n - 1);
  applyZoom((lo / extent) * 100, (hi / extent) * 100);
}

function finishLeftBrush() {
  if (!brush?.active || !chart) {
    clearBrush();
    return;
  }
  const x1 = Math.min(brush.startX, brush.curX);
  const x2 = Math.max(brush.startX, brush.curX);
  clearBrush();
  if (x2 - x1 < DRAG_THRESHOLD_PX) return;
  const from = pixelToBarIndex(x1);
  const to = pixelToBarIndex(x2);
  if (from === to) {
    // 至少放大到相邻一根
    zoomToIndexRange(from, Math.min(props.bars.length - 1, from + 1));
    return;
  }
  zoomToIndexRange(from, to);
}

function finishRightBrush(clientX: number, clientY: number) {
  if (!brush?.active || !chart || !wrapRef.value) {
    clearBrush();
    return;
  }
  const x1 = Math.min(brush.startX, brush.curX);
  const x2 = Math.max(brush.startX, brush.curX);
  const from = pixelToBarIndex(x1);
  const to = pixelToBarIndex(x2);
  clearBrush();
  if (x2 - x1 < DRAG_THRESHOLD_PX) return;
  const a = Math.min(from, to);
  const b = Math.max(from, to);

  const rect = wrapRef.value.getBoundingClientRect();
  let mx = clientX - rect.left;
  let my = clientY - rect.top;
  mx = Math.max(8, Math.min(rect.width - 168, mx));
  my = Math.max(8, Math.min(rect.height - 120, my));
  rangeMenu.show = true;
  rangeMenu.x = mx;
  rangeMenu.y = my;
  rangeMenu.from = a;
  rangeMenu.to = b;
  statsPanel.show = false;
  updateRangeBand(a, b);
}

function onBrushPointerDown(ev: PointerEvent) {
  if (!containerRef.value || !props.bars.length) return;
  if (ev.shiftKey) return; // Shift+拖：留给 dataZoom 平移
  const button: BrushButton | null =
    ev.button === 0 ? "left" : ev.button === 2 ? "right" : null;
  if (!button) return;

  // 右键：阻止系统菜单；左键框选开始后由捕获层接管
  if (button === "right") ev.preventDefault();

  rangeMenu.show = false;
  const pt = localPoint(ev);
  if (brush?.longPressTimer) clearTimeout(brush.longPressTimer);
  brush = {
    button,
    startX: pt.x,
    startY: pt.y,
    curX: pt.x,
    curY: pt.y,
    active: false,
    pointerId: ev.pointerId,
    longPressTimer: setTimeout(() => {
      if (!brush) return;
      brush.active = true;
      updateBrushBox();
    }, LONG_PRESS_MS),
  };
}

function onBrushPointerMove(ev: PointerEvent) {
  if (!brush) return;
  if (brush.pointerId != null && ev.pointerId !== brush.pointerId) return;
  const pt = localPoint(ev);
  brush.curX = pt.x;
  brush.curY = pt.y;
  const dist = Math.hypot(pt.x - brush.startX, pt.y - brush.startY);
  if (!brush.active && dist >= DRAG_THRESHOLD_PX) {
    if (brush.longPressTimer) {
      clearTimeout(brush.longPressTimer);
      brush.longPressTimer = null;
    }
    brush.active = true;
    // 一旦进入框选，挡住 ECharts 继续吃拖动手势
    ev.preventDefault();
    ev.stopPropagation();
  }
  if (brush.active) {
    ev.preventDefault();
    updateBrushBox();
  }
}

function onBrushPointerUp(ev: PointerEvent) {
  if (!brush) return;
  if (brush.pointerId != null && ev.pointerId !== brush.pointerId && ev.type !== "pointercancel") {
    return;
  }
  if (brush.longPressTimer) {
    clearTimeout(brush.longPressTimer);
    brush.longPressTimer = null;
  }
  const btn = brush.button;
  const wasActive = brush.active;
  // pointerup 的 button 常为 0；用 buttons/记录的键判定
  const releasedOk =
    btn === "left"
      ? ev.button === 0 || ev.type === "pointercancel" || ev.buttons === 0
      : ev.button === 2 || ev.button === 0 || ev.type === "pointercancel" || ev.buttons === 0;
  if (!wasActive || !releasedOk) {
    clearBrush();
    return;
  }
  if (btn === "left") {
    finishLeftBrush();
  } else {
    finishRightBrush(ev.clientX, ev.clientY);
  }
}

function onContextMenu(ev: MouseEvent) {
  ev.preventDefault();
}

function closeRangeMenu() {
  rangeMenu.show = false;
}

function showPatternToast(msg: string) {
  patternToast.value = msg;
  if (patternToastTimer) clearTimeout(patternToastTimer);
  patternToastTimer = setTimeout(() => {
    patternToast.value = "";
    patternToastTimer = null;
  }, 2600);
}

function onMenuIntervalStats() {
  const stats = buildRangeStats(rangeMenu.from, rangeMenu.to);
  closeRangeMenu();
  if (!stats) return;
  statsPanel.data = stats;
  statsPanel.show = true;
  updateRangeBand(stats.from, stats.to);
  emit("range-stats", stats);
}

function onMenuPatternSelect() {
  const { from, to } = rangeMenu;
  closeRangeMenu();
  emit("pattern-match", { mode: "select", from, to });
  showPatternToast(
    `形态匹配选股：已选取 ${formatBarDate(props.bars[from].timestamp)} ~ ${formatBarDate(props.bars[to].timestamp)}（选股引擎接入中）`,
  );
}

function onMenuPatternAll() {
  const { from, to } = rangeMenu;
  closeRangeMenu();
  emit("pattern-match", { mode: "all", from, to });
  showPatternToast(
    `所有形态匹配：区间 ${to - from + 1} 根 K 线已提交（匹配引擎接入中）`,
  );
}

function onStatsClose() {
  statsPanel.show = false;
  rangeBand.show = false;
}

function onStatsPatternMatch() {
  if (!statsPanel.data) return;
  const { from, to } = statsPanel.data;
  emit("pattern-match", { mode: "select", from, to });
  showPatternToast(`形态匹配：区间 ${to - from + 1} 根 K 线已提交（匹配引擎接入中）`);
}

function onStatsRanking() {
  showPatternToast("区间排行：功能接入中");
}

function onStatsSectorRanking() {
  showPatternToast("板块排行：功能接入中");
}
let resizeObs: ResizeObserver | null = null;
let themeObs: MutationObserver | null = null;

function onWrapMouseDownFocus() {
  containerRef.value?.focus({ preventScroll: true });
}

function onDocPointerDown(ev: MouseEvent) {
  if (!rangeMenu.show && !statsPanel.show) return;
  const wrap = wrapRef.value;
  if (!wrap) return;
  const t = ev.target;
  if (t instanceof Node && wrap.contains(t)) {
    if (t instanceof Element && t.closest(".kline-range-menu, .rsd")) {
      return;
    }
    if (rangeMenu.show && !(t instanceof Element && t.closest(".kline-range-menu"))) {
      closeRangeMenu();
    }
    if (statsPanel.show && !(t instanceof Element && t.closest(".rsd"))) {
      statsPanel.show = false;
      rangeBand.show = false;
    }
    return;
  }
  closeRangeMenu();
  statsPanel.show = false;
  rangeBand.show = false;
}

onMounted(() => {
  if (!containerRef.value || !wrapRef.value) return;
  chart = echarts.init(containerRef.value, undefined, { renderer: "canvas" });
  chart.getZr().on("globalout", () => {
    if (cursorIndex == null) emit("update:hoverIndex", null);
  });
  chart.on("updateAxisPointer", handleAxisPointer);
  chart.on("datazoom", handleDataZoom);
  chart.on("dblclick", handleDblClick);

  const wrap = wrapRef.value;
  // 捕获阶段抢在 ECharts 之前，保证框选能收到事件
  wrap.addEventListener("pointerdown", onBrushPointerDown, true);
  window.addEventListener("pointermove", onBrushPointerMove, true);
  window.addEventListener("pointerup", onBrushPointerUp, true);
  window.addEventListener("pointercancel", onBrushPointerUp, true);
  wrap.addEventListener("mousedown", onWrapMouseDownFocus);
  wrap.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("mousedown", onDocPointerDown, true);

  render();
  scheduleEmitPriceExtent();

  resizeObs = new ResizeObserver(() => handleResize());
  resizeObs.observe(containerRef.value);
  const parent = containerRef.value.parentElement;
  if (parent) resizeObs.observe(parent);

  themeObs = new MutationObserver(() => {
    render();
  });
  themeObs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  window.addEventListener("resize", handleResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
});

onBeforeUnmount(() => {
  stopHold();
  clearBrush();
  if (patternToastTimer) clearTimeout(patternToastTimer);
  if (resizeTimer) clearTimeout(resizeTimer);
  if (extentTimer) clearTimeout(extentTimer);
  resizeObs?.disconnect();
  resizeObs = null;
  themeObs?.disconnect();
  themeObs = null;
  wrapRef.value?.removeEventListener("pointerdown", onBrushPointerDown, true);
  window.removeEventListener("pointermove", onBrushPointerMove, true);
  window.removeEventListener("pointerup", onBrushPointerUp, true);
  window.removeEventListener("pointercancel", onBrushPointerUp, true);
  wrapRef.value?.removeEventListener("mousedown", onWrapMouseDownFocus);
  wrapRef.value?.removeEventListener("contextmenu", onContextMenu);
  window.removeEventListener("mousedown", onDocPointerDown, true);
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
      JSON.stringify(props.extraMarkPoints ?? null),
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
  <div ref="wrapRef" class="kline-chart-wrap relative h-full min-h-0 w-full flex-1 select-none">
    <div
      ref="containerRef"
      class="ths-chart-canvas h-full min-h-0 w-full flex-1 outline-none"
      tabindex="0"
    ></div>

    <!-- 框选激活时捕获层：挡住 ECharts -->
    <div
      v-show="brushCapture.show"
      class="kline-brush-capture absolute inset-0 z-[25]"
    />

    <!-- 框选矩形：左键实线 / 右键虚线 -->
    <div
      v-show="brushBox.show"
      class="kline-brush-box pointer-events-none absolute z-30"
      :class="brushBox.dashed ? 'is-dashed' : 'is-solid'"
      :style="{
        left: `${brushBox.left}px`,
        top: `${brushBox.top}px`,
        width: `${brushBox.width}px`,
        height: `${brushBox.height}px`,
      }"
    />

    <!-- 保留的区间线 -->
    <div
      v-show="rangeBand.show && (statsPanel.show || rangeMenu.show)"
      class="kline-range-band pointer-events-none absolute inset-y-0 z-[22]"
      :style="{ left: `${rangeBand.left}px`, width: `${rangeBand.width}px` }"
    />

    <!-- 右键框选结束菜单 -->
    <div
      v-if="rangeMenu.show"
      class="kline-range-menu absolute z-40"
      :style="{ left: `${rangeMenu.x}px`, top: `${rangeMenu.y}px` }"
      @mousedown.stop
      @pointerdown.stop
    >
      <button type="button" class="kline-range-menu__item" @click="onMenuIntervalStats">
        区间统计
      </button>
      <div class="kline-range-menu__sep" />
      <button type="button" class="kline-range-menu__item" @click="onMenuPatternSelect">
        形态匹配选股
      </button>
      <button type="button" class="kline-range-menu__item" @click="onMenuPatternAll">
        所有形态匹配
      </button>
    </div>

    <RangeStatsDialog
      v-if="statsPanel.show && statsPanel.data"
      :data="statsPanel.data"
      :stock-name="stockName"
      :stock-code="stockCode"
      :adjust-label="adjustLabel"
      @close="onStatsClose"
      @pattern-match="onStatsPatternMatch"
      @ranking="onStatsRanking"
      @sector-ranking="onStatsSectorRanking"
    />

    <div v-if="patternToast" class="kline-pattern-toast absolute z-50">
      {{ patternToast }}
    </div>
  </div>
</template>

<style scoped>
.kline-brush-capture {
  cursor: crosshair;
  touch-action: none;
  background: transparent;
}
.kline-brush-box {
  border: 1px solid rgba(90, 180, 255, 0.95);
  background: rgba(40, 120, 220, 0.12);
  box-sizing: border-box;
}
.kline-brush-box.is-dashed {
  border-style: dashed;
  border-color: rgba(200, 210, 220, 0.85);
  background: rgba(180, 190, 200, 0.08);
}
.kline-range-band {
  border-left: 1px dashed color-mix(in srgb, var(--color-text-muted) 70%, transparent);
  border-right: 1px dashed color-mix(in srgb, var(--color-text-muted) 70%, transparent);
  background: color-mix(in srgb, var(--color-text-muted) 10%, transparent);
}

.kline-range-menu {
  min-width: 148px;
  padding: 4px 0;
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  border-radius: calc(var(--radius-surface, 12px) * 0.55);
  box-shadow: var(--glass-shadow, 0 2px 10px rgba(0, 0, 0, 0.35));
  backdrop-filter: blur(var(--glass-blur, 8px));
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.35;
  user-select: none;
}
.kline-range-menu__item {
  display: block;
  width: 100%;
  padding: 5px 16px;
  text-align: left;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.kline-range-menu__item:hover {
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
}
.kline-range-menu__sep {
  height: 1px;
  margin: 3px 0;
  background: color-mix(in srgb, var(--color-border) 80%, transparent);
}

.kline-pattern-toast {
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  max-width: min(520px, calc(100% - 24px));
  padding: 8px 14px;
  background: color-mix(in srgb, var(--color-bg-elevated) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  border-radius: calc(var(--radius-surface, 12px) * 0.55);
  color: var(--color-text);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
  backdrop-filter: blur(8px);
}
</style>
