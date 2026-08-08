<script setup lang="ts">
/**
 * 当日分时缩略线：用于资金复盘榜行内预览。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { fetchStockKline } from "@/api/stock";

const props = defineProps<{
  code: string;
  /** 流入红 / 流出绿 */
  tone: "up" | "down";
}>();

const closes = ref<number[]>([]);
const prevClose = ref<number | null>(null);
const failed = ref(false);
let abort: AbortController | null = null;

const W = 88;
const H = 28;
const PAD = 1;

const stroke = computed(() =>
  props.tone === "up" ? "var(--color-up)" : "var(--color-down)",
);

const pathD = computed(() => {
  const pts = closes.value;
  if (pts.length < 2) return "";
  let min = Math.min(...pts);
  let max = Math.max(...pts);
  if (prevClose.value != null && Number.isFinite(prevClose.value)) {
    min = Math.min(min, prevClose.value);
    max = Math.max(max, prevClose.value);
  }
  const span = max - min || 1;
  const n = pts.length;
  return pts
    .map((p, i) => {
      const x = PAD + (i / (n - 1)) * (W - PAD * 2);
      const y = PAD + (1 - (p - min) / span) * (H - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
});

const baselineY = computed(() => {
  const pts = closes.value;
  if (!pts.length || prevClose.value == null || !Number.isFinite(prevClose.value)) {
    return null;
  }
  let min = Math.min(...pts, prevClose.value);
  let max = Math.max(...pts, prevClose.value);
  const span = max - min || 1;
  return PAD + (1 - (prevClose.value - min) / span) * (H - PAD * 2);
});

async function load() {
  abort?.abort();
  if (!props.code) {
    closes.value = [];
    return;
  }
  abort = new AbortController();
  failed.value = false;
  try {
    const data = await fetchStockKline(
      props.code,
      "intraday",
      "none",
      abort.signal,
    );
    const bars = data.bars ?? [];
    // 连续竞价点即可；过密则抽稀
    const step = Math.max(1, Math.floor(bars.length / 60));
    const sampled: number[] = [];
    for (let i = 0; i < bars.length; i += step) {
      sampled.push(bars[i].close);
    }
    if (bars.length && sampled[sampled.length - 1] !== bars[bars.length - 1].close) {
      sampled.push(bars[bars.length - 1].close);
    }
    closes.value = sampled;
    prevClose.value = data.prev_close;
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    closes.value = [];
    failed.value = true;
  }
}

onMounted(() => {
  void load();
});

watch(
  () => props.code,
  () => {
    void load();
  },
);

onBeforeUnmount(() => {
  abort?.abort();
});
</script>

<template>
  <div class="spark" :title="failed ? '分时暂不可用' : '当日分时'">
    <svg
      v-if="pathD"
      :viewBox="`0 0 ${W} ${H}`"
      width="88"
      height="28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        v-if="baselineY != null"
        :x1="PAD"
        :x2="W - PAD"
        :y1="baselineY"
        :y2="baselineY"
        stroke="currentColor"
        stroke-opacity="0.25"
        stroke-width="1"
        stroke-dasharray="2 2"
      />
      <path
        :d="pathD"
        fill="none"
        :stroke="stroke"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    <span v-else class="spark-empty">{{ failed ? "—" : "…" }}</span>
  </div>
</template>

<style scoped>
.spark {
  width: 88px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--cf-muted, #5b6b82);
}

.spark-empty {
  font-size: 12px;
  color: inherit;
  opacity: 0.55;
}
</style>
