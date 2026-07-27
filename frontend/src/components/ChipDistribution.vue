<script setup lang="ts">
/**
 * 右侧筹码分布：绘制区与左侧主图 K 线网格同高同底，Y 轴跟主图价格刻度对齐。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  computeChipDistribution,
  KLINE_LAYOUT,
  roundPrice,
  type ChipDistribution,
  type KlineBar,
} from "@/kline-engine";

const props = defineProps<{
  bars: KlineBar[];
  /** 十字线对应下标；null 时用最后一根 */
  asOfIndex: number | null;
  /** 是否展开 */
  open: boolean;
  width: number;
  /** 主图 Y 轴价格范围（与 ECharts scale 同步）；缺省时用可见 K 线高低估算 */
  priceMin?: number | null;
  priceMax?: number | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "update:width": [value: number];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const bodyRef = ref<HTMLDivElement | null>(null);

const MIN_W = 120;
const MAX_W = 320;

const plotStyle = computed(() => ({
  top: `${KLINE_LAYOUT.main.topPx}px`,
  height: `${KLINE_LAYOUT.main.heightPct}%`,
}));

const resolvedIndex = computed(() => {
  if (!props.bars.length) return -1;
  if (props.asOfIndex != null && props.asOfIndex >= 0) {
    return Math.min(props.asOfIndex, props.bars.length - 1);
  }
  return props.bars.length - 1;
});

const distribution = computed<ChipDistribution | null>(() => {
  if (!props.open || resolvedIndex.value < 0) return null;
  return computeChipDistribution(props.bars, resolvedIndex.value);
});

const stats = computed(() => {
  const d = distribution.value;
  if (!d) return null;
  return {
    avgCost: roundPrice(d.avgCost),
    close: roundPrice(d.close),
    profitPct: (d.profitRatio * 100).toFixed(1),
    trapPct: ((1 - d.profitRatio) * 100).toFixed(1),
  };
});

/** 与左侧主图同一价格轴：优先用 ECharts yAxis extent */
function resolvePriceSpan(dist: ChipDistribution): { minP: number; maxP: number } {
  let minP = props.priceMin;
  let maxP = props.priceMax;
  if (
    minP == null ||
    maxP == null ||
    !Number.isFinite(minP) ||
    !Number.isFinite(maxP) ||
    maxP <= minP
  ) {
    // 回退：用当前加载 K 线高低（与全量展示时主图接近）
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of props.bars) {
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
    }
    if (!(hi > lo)) {
      lo = dist.close * 0.98;
      hi = dist.close * 1.02;
    }
    const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.01;
    minP = lo - pad;
    maxP = hi + pad;
  }
  return { minP: minP as number, maxP: maxP as number };
}

function draw() {
  const canvas = canvasRef.value;
  const body = bodyRef.value;
  const dist = distribution.value;
  if (!canvas || !body || !dist) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = body.clientWidth;
  const cssH = body.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bins = dist.bins;
  if (!bins.length) return;

  const { minP, maxP } = resolvePriceSpan(dist);
  const priceSpan = maxP - minP || 1;
  const maxVol = Math.max(...bins.map((b) => b.volume), 1);

  const plotH = cssH;
  const barMaxW = cssW - 10;

  const up =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-up")
      .trim() || "#f5222d";
  const locked = "#4080ff";
  const muted =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-text-muted")
      .trim() || "#6b7280";

  // 与主图 Y 轴同向：高价在上；无额外上下 padding，避免与主图底边错位
  const yOf = (price: number) => ((maxP - price) / priceSpan) * plotH;

  // 柱高必须按「价格步长 → 像素」换算；用 plotH/bins.length 会在主图缩放时重叠成粗条
  const step =
    dist.step > 0
      ? dist.step
      : bins.length > 1
        ? Math.abs(bins[1].price - bins[0].price)
        : priceSpan / Math.max(bins.length, 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cssW, cssH);
  ctx.clip();

  for (const bin of bins) {
    const w = (bin.volume / maxVol) * barMaxW;
    if (w < 0.5) continue;
    const yTop = yOf(bin.price + step / 2);
    const yBot = yOf(bin.price - step / 2);
    const h = Math.max(0.8, yBot - yTop);
    // 完全落在可视价格轴外则跳过
    if (yBot < 0 || yTop > cssH) continue;
    ctx.fillStyle = bin.price <= dist.close ? up : locked;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, yTop, w, h);
  }
  ctx.globalAlpha = 1;

  const yClose = yOf(dist.close);
  if (yClose >= 0 && yClose <= cssH) {
    ctx.strokeStyle = up;
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yClose);
    ctx.lineTo(cssW, yClose);
    ctx.stroke();
  }

  const yAvg = yOf(dist.avgCost);
  if (yAvg >= 0 && yAvg <= cssH) {
    ctx.strokeStyle = "#8b9199";
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yAvg);
    ctx.lineTo(cssW, yAvg);
    ctx.stroke();

    ctx.fillStyle = muted;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("成本", cssW - 4, Math.min(cssH - 4, Math.max(10, yAvg - 3)));
  }
  ctx.restore();
}

watch(
  [distribution, () => props.width, () => props.open, () => props.priceMin, () => props.priceMax],
  async () => {
    if (!props.open) return;
    await nextTick();
    draw();
  },
);

let resizeObs: ResizeObserver | null = null;

onMounted(() => {
  if (bodyRef.value) {
    resizeObs = new ResizeObserver(() => draw());
    resizeObs.observe(bodyRef.value);
  }
  draw();
});

onBeforeUnmount(() => {
  resizeObs?.disconnect();
});

function toggle() {
  emit("update:open", !props.open);
}

let dragging = false;
let startX = 0;
let startW = 0;

function onResizeDown(e: MouseEvent) {
  if (!props.open) return;
  dragging = true;
  startX = e.clientX;
  startW = props.width;
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", onResizeUp);
  e.preventDefault();
}

function onResizeMove(e: MouseEvent) {
  if (!dragging) return;
  const next = Math.min(MAX_W, Math.max(MIN_W, startW + (startX - e.clientX)));
  emit("update:width", next);
}

function onResizeUp() {
  dragging = false;
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeUp);
}
</script>

<template>
  <aside
    class="chip-dock"
    :class="{ 'chip-dock-open': open }"
    :style="open ? { width: `${width}px` } : undefined"
  >
    <button
      type="button"
      class="chip-toggle"
      :title="open ? '隐藏筹码' : '显示筹码'"
      @click="toggle"
    >
      {{ open ? "»" : "筹码" }}
    </button>

    <div v-show="open" class="chip-panel">
      <div class="chip-resize" title="拖拽调整宽度" @mousedown="onResizeDown" />
      <header class="chip-head">
        <span>筹码分布</span>
        <button type="button" class="chip-hide" @click="toggle">隐藏</button>
      </header>
      <div v-if="stats" class="chip-stats">
        <span>获利 <em class="chip-up">{{ stats.profitPct }}%</em></span>
        <span>套牢 <em class="chip-lock">{{ stats.trapPct }}%</em></span>
        <span>成本 <em>{{ stats.avgCost }}</em></span>
        <span>现价 <em class="chip-up">{{ stats.close }}</em></span>
      </div>
      <!-- 与左侧主图 grid[0] 同顶同高，底边对齐 K 线主图底 -->
      <div ref="bodyRef" class="chip-body" :style="plotStyle">
        <canvas ref="canvasRef" />
      </div>
      <footer class="chip-foot" :style="{ top: `calc(${KLINE_LAYOUT.main.topPx}px + ${KLINE_LAYOUT.main.heightPct}%)` }">
        红获利 · 蓝套牢
      </footer>
    </div>
  </aside>
</template>

<style scoped>
.chip-dock {
  position: relative;
  flex: 0 0 auto;
  width: 0;
  align-self: stretch;
  overflow: visible;
  z-index: 2;
}

.chip-dock-open {
  transition: none;
}

.chip-toggle {
  position: absolute;
  top: 40%;
  right: 0;
  z-index: 5;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: 8px 0 0 8px;
  background: var(--color-bg-elevated);
  color: var(--color-accent);
  font-size: 12px;
  letter-spacing: 0.12em;
  padding: 12px 5px;
  cursor: pointer;
  box-shadow: -2px 0 8px rgb(15 23 42 / 6%);
}

.chip-dock-open .chip-toggle {
  right: auto;
  left: 0;
  transform: translate(-100%, -50%);
  writing-mode: horizontal-tb;
  letter-spacing: 0;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-right: 0;
  border-radius: 8px 0 0 8px;
}

.chip-panel {
  position: relative;
  width: 100%;
  height: 100%;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  overflow: hidden;
}

.chip-resize {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 2;
}

.chip-resize:hover,
.chip-resize:active {
  background: color-mix(in srgb, var(--color-accent) 35%, transparent);
}

.chip-head {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 10px 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text);
  pointer-events: none;
  background: linear-gradient(
    180deg,
    var(--color-bg-elevated) 55%,
    transparent
  );
}

.chip-hide {
  pointer-events: auto;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
}

.chip-hide:hover {
  color: var(--color-accent);
}

.chip-stats {
  position: absolute;
  top: 18px;
  left: 0;
  right: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  padding: 0 10px;
  font-size: 10px;
  color: var(--color-text-muted);
  line-height: 1.35;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-bg-elevated) 92%, transparent),
    transparent
  );
}

.chip-stats em {
  font-style: normal;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
  margin-left: 2px;
}

.chip-up {
  color: var(--color-up) !important;
}

.chip-lock {
  color: #4080ff !important;
}

.chip-body {
  position: absolute;
  left: 0;
  right: 0;
  /* top/height 由 KLINE_LAYOUT inline 控制，与主图 grid 对齐 */
  padding: 0 6px 0 4px;
  box-sizing: border-box;
}

.chip-body canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.chip-foot {
  position: absolute;
  left: 0;
  right: 0;
  padding: 4px 10px 0;
  font-size: 10px;
  color: var(--color-text-muted);
  pointer-events: none;
}
</style>
