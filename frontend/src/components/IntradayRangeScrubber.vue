<script setup lang="ts">
/**
 * 同花顺实时龙虎榜式分时区间条：
 * 灰底粗轨 + 轨内细红线 + 白胶囊柄（三道红竖纹）+ 带三角的时间气泡。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  length: number;
  start: number;
  end: number;
  labels?: string[];
}>();

const emit = defineEmits<{
  "update:start": [value: number];
  "update:end": [value: number];
  scrub: [];
}>();

const trackRef = ref<HTMLDivElement | null>(null);
type Handle = "start" | "end" | "range";
let dragging: Handle | null = null;
let dragOriginX = 0;
let dragStartAtDown = 0;
let dragEndAtDown = 0;

const maxIndex = computed(() => Math.max(0, props.length - 1));

const startPct = computed(() =>
  maxIndex.value <= 0 ? 0 : (props.start / maxIndex.value) * 100,
);
const endPct = computed(() =>
  maxIndex.value <= 0 ? 100 : (props.end / maxIndex.value) * 100,
);

const startTime = computed(
  () => props.labels?.[props.start] ?? props.labels?.[0] ?? "09:30",
);
const endTime = computed(
  () =>
    props.labels?.[props.end] ??
    props.labels?.[props.labels.length - 1] ??
    "15:00",
);

watch(
  () => props.length,
  (n) => {
    if (n <= 0) return;
    if (props.end > n - 1) emit("update:end", n - 1);
    if (props.start > n - 1) emit("update:start", Math.max(0, n - 1));
  },
);

function clamp(i: number): number {
  return Math.max(0, Math.min(maxIndex.value, Math.round(i)));
}

function indexFromClientX(clientX: number): number {
  const el = trackRef.value;
  if (!el || maxIndex.value <= 0) return 0;
  const rect = el.getBoundingClientRect();
  const t = (clientX - rect.left) / Math.max(1, rect.width);
  return clamp(t * maxIndex.value);
}

function onPointerDown(handle: Handle, e: PointerEvent) {
  if (props.length <= 1) return;
  dragging = handle;
  dragOriginX = e.clientX;
  dragStartAtDown = props.start;
  dragEndAtDown = props.end;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  emit("scrub");
  e.preventDefault();
  e.stopPropagation();
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return;
  if (dragging === "start") {
    emit("update:start", Math.min(indexFromClientX(e.clientX), props.end));
  } else if (dragging === "end") {
    emit("update:end", Math.max(indexFromClientX(e.clientX), props.start));
  } else {
    const el = trackRef.value;
    if (!el || maxIndex.value <= 0) return;
    const dx = e.clientX - dragOriginX;
    const di = Math.round((dx / el.getBoundingClientRect().width) * maxIndex.value);
    const span = dragEndAtDown - dragStartAtDown;
    let ns = dragStartAtDown + di;
    let ne = ns + span;
    if (ns < 0) {
      ns = 0;
      ne = span;
    }
    if (ne > maxIndex.value) {
      ne = maxIndex.value;
      ns = ne - span;
    }
    emit("update:start", clamp(ns));
    emit("update:end", clamp(ne));
  }
  emit("scrub");
}

function onPointerUp() {
  dragging = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});
</script>

<template>
  <div class="irs" aria-label="分时区间选择">
    <div ref="trackRef" class="irs-track">
      <!-- 灰色粗底轨（圆角胶囊） -->
      <div class="irs-rail" />
      <!-- 全宽浅灰中线 -->
      <div class="irs-midline" />
      <!-- 选中段内的细红线（盖住中线） -->
      <div
        class="irs-redline"
        :style="{
          left: `${startPct}%`,
          width: `${Math.max(0, endPct - startPct)}%`,
        }"
        @pointerdown="onPointerDown('range', $event)"
      />

      <div class="irs-handle" :style="{ left: `${startPct}%` }">
        <div class="irs-bubble">
          {{ startTime }}
          <i class="irs-caret" />
        </div>
        <button
          type="button"
          class="irs-thumb"
          aria-label="区间起点"
          @pointerdown="onPointerDown('start', $event)"
        >
          <span class="irs-grip" aria-hidden="true"><i /><i /><i /></span>
        </button>
      </div>

      <div class="irs-handle" :style="{ left: `${endPct}%` }">
        <div class="irs-bubble">
          {{ endTime }}
          <i class="irs-caret" />
        </div>
        <button
          type="button"
          class="irs-thumb"
          aria-label="区间终点"
          @pointerdown="onPointerDown('end', $event)"
        >
          <span class="irs-grip" aria-hidden="true"><i /><i /><i /></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.irs {
  flex-shrink: 0;
  padding: 14px 8px 10px;
  user-select: none;
  touch-action: none;
}

.irs-track {
  position: relative;
  height: 28px;
  margin: 0 14px;
}

/* 灰色粗底（浅灰） */
.irs-rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 12px;
  margin-top: -6px;
  border-radius: 999px;
  background: #d0d0d0;
  pointer-events: none;
}

/* 轨内浅灰中线（未选中段可见） */
.irs-midline {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  border-radius: 1px;
  background: #b8b8b8;
  pointer-events: none;
}

/* 轨内细红线（仅选中区间） */
.irs-redline {
  position: absolute;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  border-radius: 1px;
  background: #e54d42;
  cursor: grab;
  z-index: 1;
}

.irs-redline:active {
  cursor: grabbing;
}

.irs-handle {
  position: absolute;
  top: 50%;
  width: 0;
  height: 0;
  z-index: 3;
}

/* 红色时间气泡 + 下三角 */
.irs-bubble {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  height: 18px;
  padding: 0 6px;
  border-radius: 3px;
  background: #e54d42;
  color: #fff;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 1px 2px rgb(0 0 0 / 16%);
}

.irs-caret {
  position: absolute;
  left: 50%;
  bottom: -4px;
  width: 0;
  height: 0;
  margin-left: -4px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid #e54d42;
}

/* 白胶囊柄 */
.irs-thumb {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 14px;
  height: 22px;
  margin: 0;
  transform: translate(-50%, -50%);
  border: 0;
  border-radius: 7px;
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 10%),
    0 1px 3px rgb(0 0 0 / 20%);
  cursor: ew-resize;
  padding: 0;
  display: grid;
  place-items: center;
}

.irs-grip {
  display: flex;
  gap: 1.5px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* 三道细红竖纹 */
.irs-grip i {
  display: block;
  width: 1.5px;
  height: 10px;
  border-radius: 1px;
  background: #e54d42;
}
</style>
