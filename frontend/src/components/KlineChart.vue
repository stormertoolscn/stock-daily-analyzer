<script setup lang="ts">
/**
 * ECharts K线组件外壳。
 *
 * 组件本身不包含任何"怎么画"的判断逻辑 —— 全部委托给 kline-engine
 * (data + config -> option)。组件只负责：接收 bars/config props、
 * 持有 ECharts 实例、随容器尺寸变化 resize、随主题切换重新取色。
 */
import * as echarts from "echarts";
import { onBeforeUnmount, onMounted, shallowRef, watch } from "vue";

import { createKlineEngine, getAShareTheme } from "@/kline-engine";
import type { KlineBar, KlineRenderConfig } from "@/kline-engine";

const props = defineProps<{
  bars: KlineBar[];
  config?: Partial<KlineRenderConfig>;
}>();

const containerRef = shallowRef<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
const engine = createKlineEngine(props.config);

function render() {
  if (!chart) return;
  engine.setTheme(props.config?.theme ?? getAShareTheme());
  chart.setOption(engine.buildOption(props.bars), true);
}

function handleResize() {
  chart?.resize();
}

onMounted(() => {
  if (!containerRef.value) return;
  chart = echarts.init(containerRef.value);
  render();
  window.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleResize);
  chart?.dispose();
  chart = null;
});

watch(() => props.bars, render, { deep: true });
</script>

<template>
  <div ref="containerRef" class="h-full min-h-[420px] w-full"></div>
</template>
