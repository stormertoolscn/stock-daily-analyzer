<script setup lang="ts">
/**
 * 右侧筹码分布：连续火焰山峰形（平滑轮廓，非方块条）。
 * 绘制区与左侧主图 K 线网格同高同底，Y 轴跟主图价格刻度对齐。
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
/** 分桶密度：越高轮廓越细腻 */
const binCount = ref(220);

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
  return computeChipDistribution(props.bars, resolvedIndex.value, {
    binCount: binCount.value,
  });
});

function refreshBinCount() {
  const h = bodyRef.value?.clientHeight ?? 0;
  // 连续峰形：约 1.1px / 档，边缘更圆滑
  const next = Math.max(140, Math.min(320, Math.round((h || 260) / 1.1)));
  if (next !== binCount.value) binCount.value = next;
}

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

/** 火焰山色阶：按价格相对位置分带 + 密度提亮；尖峰更醒目 */
function flameColor(
  t: number,
  priceRatio: number,
  profit: boolean,
): string {
  const dens = Math.max(0, Math.min(1, t));
  // 由低到高：白/金 → 红 → 粉 → 洋红 → 橙（参考通达信火焰山分层）
  const bands: [number, number, number][] = [
    [245, 245, 248],
    [255, 210, 140],
    [245, 80, 60],
    [255, 120, 160],
    [224, 64, 251],
    [255, 140, 40],
  ];
  const bandT = Math.max(0, Math.min(0.999, priceRatio));
  const base = lerpStops(bands, bandT);
  // 获利侧略偏暖，套牢侧略偏冷
  if (!profit) {
    return mixRgb(base, [64, 128, 255], 0.35 + dens * 0.15);
  }
  return mixRgb(base, [255, 60, 40], 0.12 + dens * 0.2);
}

function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return [200, 200, 200];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function mixRgb(
  aCss: string,
  b: [number, number, number],
  t: number,
): string {
  const a = parseRgb(aCss);
  const u = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

function lerpStops(stops: [number, number, number][], t: number): string {
  const n = stops.length - 1;
  const p = t * n;
  const i = Math.min(n - 1, Math.floor(p));
  const f = p - i;
  const a = stops[i];
  const b = stops[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

/** 把离散桶平滑成连续轮廓点（价格 y → 宽度 x） */
function buildRidgePoints(
  bins: ChipDistribution["bins"],
  maxVol: number,
  maxW: number,
  yOf: (price: number) => number,
  cssH: number,
): Array<{ x: number; y: number; t: number; price: number }> {
  const pts: Array<{ x: number; y: number; t: number; price: number }> = [];
  for (const bin of bins) {
    const y = yOf(bin.price);
    if (y < -4 || y > cssH + 4) continue;
    const intensity = bin.volume / maxVol;
    const t = intensity < 0.004 ? 0 : Math.pow(intensity, 1.55);
    pts.push({ x: Math.max(0, t * maxW), y, t, price: bin.price });
  }
  // 轻平滑，去掉锯齿方块感
  if (pts.length >= 3) {
    const sm = pts.map((p) => ({ ...p }));
    for (let i = 1; i < pts.length - 1; i += 1) {
      sm[i].x = pts[i - 1].x * 0.22 + pts[i].x * 0.56 + pts[i + 1].x * 0.22;
      sm[i].t = pts[i - 1].t * 0.22 + pts[i].t * 0.56 + pts[i + 1].t * 0.22;
    }
    return sm;
  }
  return pts;
}

/** 单调样条：沿 y 方向画出平滑山脊（调用前需已落在首点） */
function strokeRidge(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
) {
  if (pts.length === 0) return;
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x, pts[0].y);
    return;
  }
  ctx.lineTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function draw() {
  const canvas = canvasRef.value;
  const body = bodyRef.value;
  if (!canvas || !body || !props.open) return;

  refreshBinCount();
  const dist = distribution.value;
  if (!dist) return;

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
  const maxW = cssW - 6;

  const up =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-up")
      .trim() || "#f5222d";
  const muted =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-text-muted")
      .trim() || "#6b7280";

  const yOf = (price: number) => ((maxP - price) / priceSpan) * cssH;
  const ridge = buildRidgePoints(bins, maxVol, maxW, yOf, cssH);
  if (!ridge.length) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cssW, cssH);
  ctx.clip();

  // 连续山峰填充：左缘 → 平滑外轮廓 → 回左缘
  ctx.beginPath();
  ctx.moveTo(0, ridge[0].y);
  strokeRidge(ctx, ridge);
  ctx.lineTo(0, ridge[ridge.length - 1].y);
  ctx.closePath();

  // 竖向火焰山渐变（高价→低价）
  const g = ctx.createLinearGradient(0, 0, 0, cssH);
  const stops = 12;
  for (let i = 0; i <= stops; i += 1) {
    const u = i / stops;
    const price = maxP - u * priceSpan;
    const profit = price <= dist.close;
    g.addColorStop(u, flameColor(0.55 + u * 0.2, 1 - u, profit));
  }
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.88;
  ctx.fill();

  // 内层高亮：按密度再叠一层更窄的峰，增强「火焰」层次
  const inner = ridge.map((p) => ({
    x: p.x * (0.42 + p.t * 0.45),
    y: p.y,
  }));
  ctx.beginPath();
  ctx.moveTo(0, inner[0].y);
  strokeRidge(ctx, inner);
  ctx.lineTo(0, inner[inner.length - 1].y);
  ctx.closePath();
  const g2 = ctx.createLinearGradient(0, 0, Math.max(8, maxW * 0.55), 0);
  g2.addColorStop(0, "rgba(255,255,255,0.55)");
  g2.addColorStop(0.35, "rgba(255,200,120,0.35)");
  g2.addColorStop(1, "rgba(255,80,40,0.05)");
  ctx.fillStyle = g2;
  ctx.globalAlpha = 0.75;
  ctx.fill();

  // 山脊描边
  ctx.beginPath();
  ctx.moveTo(ridge[0].x, ridge[0].y);
  strokeRidge(ctx, ridge);
  ctx.strokeStyle = "rgba(180, 60, 40, 0.45)";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const yClose = yOf(dist.close);
  if (yClose >= 0 && yClose <= cssH) {
    ctx.strokeStyle = up;
    ctx.setLineDash([]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, yClose);
    ctx.lineTo(cssW, yClose);
    ctx.stroke();
  }

  const yAvg = yOf(dist.avgCost);
  if (yAvg >= 0 && yAvg <= cssH) {
    ctx.strokeStyle = "#8b9199";
    ctx.setLineDash([3, 2]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yAvg);
    ctx.lineTo(cssW, yAvg);
    ctx.stroke();
    ctx.setLineDash([]);

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
    resizeObs = new ResizeObserver(() => {
      refreshBinCount();
      draw();
    });
    resizeObs.observe(bodyRef.value);
  }
  refreshBinCount();
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
        <span>筹码分布 · 火焰山</span>
        <button type="button" class="chip-hide" @click="toggle">隐藏</button>
      </header>
      <div v-if="stats" class="chip-stats">
        <span>获利 <em class="chip-up">{{ stats.profitPct }}%</em></span>
        <span>套牢 <em class="chip-lock">{{ stats.trapPct }}%</em></span>
        <span>成本 <em>{{ stats.avgCost }}</em></span>
        <span>现价 <em class="chip-up">{{ stats.close }}</em></span>
      </div>
      <div ref="bodyRef" class="chip-body" :style="plotStyle">
        <canvas ref="canvasRef" />
      </div>
      <footer
        class="chip-foot"
        :style="{ top: `calc(${KLINE_LAYOUT.main.topPx}px + ${KLINE_LAYOUT.main.heightPct}%)` }"
      >
        连续峰形 · 暖红获利 · 冷蓝套牢
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
