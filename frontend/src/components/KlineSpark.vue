<script setup lang="ts">
/**
 * 日 K 缩略折线图：资金复盘榜行内预览（收盘价连线，类似分时线）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { fetchStockKline } from "@/api/stock";
import type { KlineBar } from "@/kline-engine";

const props = withDefaults(
  defineProps<{
    code: string;
    /** 展示最近多少根日 K */
    bars?: number;
  }>(),
  { bars: 42 },
);

const candles = ref<KlineBar[]>([]);
const failed = ref(false);
let abort: AbortController | null = null;

const W = 88;
const H = 32;
const PAD_X = 1;
const PAD_Y = 3;

/** 收盘价连线（类似分时线）；颜色按整体涨跌 */
const line = computed<{ points: string; area: string; color: string }>(() => {
  const list = candles.value;
  if (!list.length) return { points: "", area: "", color: "var(--color-up)" };
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of list) {
    if (b.close < lo) lo = b.close;
    if (b.close > hi) hi = b.close;
  }
  const span = hi - lo || 1;
  const n = list.length;
  const slot = (W - PAD_X * 2) / n;
  const yOf = (p: number) => PAD_Y + (1 - (p - lo) / span) * (H - PAD_Y * 2);
  const pts = list.map((b, i) => {
    const x = PAD_X + slot * (i + 0.5);
    return `${x.toFixed(2)},${yOf(b.close).toFixed(2)}`;
  });
  const first = list[0].close;
  const last = list[list.length - 1].close;
  const color = last >= first ? "var(--color-up)" : "var(--color-down)";
  const area = `${PAD_X},${H - PAD_Y} ${pts.join(" ")} ${W - PAD_X},${H - PAD_Y}`;
  return { points: pts.join(" "), area, color };
});

async function load() {
  abort?.abort();
  if (!props.code) {
    candles.value = [];
    return;
  }
  abort = new AbortController();
  failed.value = false;
  try {
    const data = await fetchStockKline(
      props.code,
      "day",
      "qfq",
      abort.signal,
    );
    const all = data.bars ?? [];
    const n = Math.max(10, props.bars);
    candles.value = all.slice(-n);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    candles.value = [];
    failed.value = true;
  }
}

onMounted(() => {
  void load();
});

watch(
  () => [props.code, props.bars] as const,
  () => {
    void load();
  },
);

onBeforeUnmount(() => {
  abort?.abort();
});
</script>

<template>
  <div class="kspark" :title="failed ? '日K暂不可用' : '近期日K折线'">
    <svg
      v-if="line.points"
      :viewBox="`0 0 ${W} ${H}`"
      :width="W"
      :height="H"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon :points="line.area" :fill="line.color" opacity="0.12" />
      <polyline
        :points="line.points"
        fill="none"
        :stroke="line.color"
        stroke-width="1.2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    <span v-else class="kspark-empty">{{ failed ? "—" : "…" }}</span>
  </div>
</template>

<style scoped>
.kspark {
  width: 88px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--cf-muted, #5b6b82);
}

.kspark-empty {
  font-size: 12px;
  color: inherit;
  opacity: 0.55;
}
</style>
