<script setup lang="ts">
/**
 * 实时龙虎榜 · 分时资金参考图（位于分时图上方，不遮挡）。
 * 推拉底部进度条动态更新；关闭圆 X 由父级浮在 K 线右侧。
 */
import { computed } from "vue";

import {
  formatFundAmount,
  type IntradayFundStats,
} from "@/utils/intradayFundFlow";

const props = defineProps<{
  stats: IntradayFundStats | null;
  floatMvLabel?: string;
}>();

const maxAbsBucket = computed(() => {
  const bs = props.stats?.buckets ?? [];
  return Math.max(1, ...bs.map((b) => Math.abs(b.net)));
});

function barWidth(net: number): string {
  return `${Math.max(4, (Math.abs(net) / maxAbsBucket.value) * 100)}%`;
}

function tone(v: number): string {
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "flat";
}
</script>

<template>
  <div class="ifp" role="region" aria-label="分时资金参考">
    <div v-if="!stats" class="ifp-empty">推拉底部进度条查看区间资金</div>
    <template v-else>
      <div class="ifp-top">
        <div class="ifp-main">
          <span class="ifp-k">主力净额</span>
          <span class="ifp-v ifp-v-lg" :class="`ifp-t-${tone(stats.mainNet)}`">
            {{ formatFundAmount(stats.mainNet) }}
          </span>
        </div>
        <div class="ifp-buckets">
          <div
            v-for="b in stats.buckets"
            :key="b.label"
            class="ifp-bucket-row"
          >
            <span class="ifp-bucket-label">{{ b.label }}</span>
            <div class="ifp-bucket-track">
              <div
                class="ifp-bucket-bar"
                :class="`ifp-${tone(b.net)}`"
                :style="{ width: barWidth(b.net) }"
              />
            </div>
            <span class="ifp-bucket-val" :class="`ifp-t-${tone(b.net)}`">
              {{ formatFundAmount(b.net) }}
            </span>
          </div>
        </div>
      </div>

      <div class="ifp-grid">
        <div class="ifp-cell">
          <span class="ifp-k">区间涨幅</span>
          <span class="ifp-v" :class="`ifp-t-${tone(stats.rangeChangePct)}`">
            {{
              `${stats.rangeChangePct > 0 ? "+" : ""}${stats.rangeChangePct.toFixed(2)}%`
            }}
          </span>
        </div>
        <div class="ifp-cell">
          <span class="ifp-k">流通市值</span>
          <span class="ifp-v ifp-muted">{{ floatMvLabel || "—" }}</span>
        </div>
        <div class="ifp-cell">
          <span class="ifp-k">主力买入</span>
          <span class="ifp-v ifp-t-up">{{ formatFundAmount(stats.mainBuy) }}</span>
        </div>
        <div class="ifp-cell">
          <span class="ifp-k">区间成交</span>
          <span class="ifp-v ifp-muted">
            {{ formatFundAmount(stats.rangeTurnover).replace(/^[+-]/, "") }}
          </span>
        </div>
        <div class="ifp-cell">
          <span class="ifp-k">主力卖出</span>
          <span class="ifp-v ifp-t-down">{{ formatFundAmount(stats.mainSell) }}</span>
        </div>
        <div class="ifp-cell">
          <span class="ifp-k">总成交</span>
          <span class="ifp-v ifp-muted">
            {{ formatFundAmount(stats.totalTurnover).replace(/^[+-]/, "") }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ifp {
  position: relative;
  flex-shrink: 0;
  margin: 0 10px 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  box-shadow: 0 1px 4px rgb(15 23 42 / 5%);
}

.ifp-empty {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: 6px 0;
  text-align: center;
}

.ifp-top {
  display: grid;
  grid-template-columns: minmax(88px, auto) 1fr;
  gap: 12px;
  align-items: start;
  margin-bottom: 8px;
}

.ifp-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ifp-buckets {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.ifp-bucket-row {
  display: grid;
  grid-template-columns: 58px 1fr 68px;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}

.ifp-bucket-label {
  color: var(--color-text-muted);
}

.ifp-bucket-track {
  height: 7px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-border) 55%, transparent);
  overflow: hidden;
}

.ifp-bucket-bar {
  height: 100%;
  border-radius: 3px;
  min-width: 4px;
  transition: width 0.08s linear;
}

.ifp-bucket-bar.ifp-up {
  background: var(--color-up);
}

.ifp-bucket-bar.ifp-down {
  background: var(--color-down);
}

.ifp-bucket-bar.ifp-flat {
  background: var(--color-text-muted);
}

.ifp-bucket-val {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.ifp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
}

.ifp-cell {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.ifp-k {
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.ifp-v {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.ifp-v-lg {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.15;
}

.ifp-muted {
  font-weight: 500;
  color: var(--color-text);
}

.ifp-t-up {
  color: var(--color-up);
}

.ifp-t-down {
  color: var(--color-down);
}

.ifp-t-flat {
  color: var(--color-text-muted);
}

@media (max-width: 720px) {
  .ifp-top {
    grid-template-columns: 1fr;
  }
}
</style>
