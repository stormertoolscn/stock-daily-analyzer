<script setup lang="ts">
/**
 * 演示页：用随机游走生成的模拟数据驱动 KlineChart + kline-engine，
 * 验证"数据 -> 引擎 -> ECharts option"链路可用。真实数据接入后端
 * 后，只需把 mockBars 换成接口返回值，组件与引擎都无需改动。
 */
import { ref } from "vue";

import KlineChart from "@/components/KlineChart.vue";
import type { KlineBar } from "@/kline-engine";

function generateMockBars(days: number): KlineBar[] {
  const bars: KlineBar[] = [];
  let price = 20;
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    const open = price;
    const change = (Math.random() - 0.48) * open * 0.04;
    const close = Math.max(1, open + change);
    const high = Math.max(open, close) + Math.random() * open * 0.015;
    const low = Math.max(0.5, Math.min(open, close) - Math.random() * open * 0.015);
    const volume = Math.round(50000 + Math.random() * 150000);
    bars.push({
      timestamp: now - i * 86400_000,
      open,
      close,
      high,
      low,
      volume,
    });
    price = close;
  }
  return bars;
}

const bars = ref<KlineBar[]>(generateMockBars(90));
</script>

<template>
  <div class="space-y-4">
    <div class="card">
      <h2 class="card-title">K线复盘</h2>
      <p class="text-sm text-text-muted">
        下方为模拟数据演示，验证 kline-engine 的红涨绿跌实心柱渲染；
        真实行情接入后端后替换数据源即可。
      </p>
    </div>
    <div class="card">
      <KlineChart :bars="bars" />
    </div>
  </div>
</template>
