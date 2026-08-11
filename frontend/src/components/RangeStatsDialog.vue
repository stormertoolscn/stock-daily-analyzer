<script setup lang="ts">
/**
 * 区间统计对话框：右键框选 K 线区间后展示区间涨跌、量能、形态统计。
 */
import { computed } from "vue";

export interface RangeStatsDetail {
  from: number;
  to: number;
  startDate: string;
  endDate: string;
  bars: number;
  calendarDays: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeSum: number;
  avgVolume: number;
  amountSum: number;
  avgAmount: number;
  avgClose: number;
  weightedAvg: number;
  change: number;
  changePct: number;
  amplitude: number;
  amplitudePct: number;
  maxRisePct: number;
  maxDrawdownPct: number;
  annualizedPct: number | null;
  yangCount: number;
  yinCount: number;
  flatCandleCount: number;
  upCount: number;
  downCount: number;
  flatDayCount: number;
  volatilityPct: number | null;
  sharpe: number | null;
}

const props = defineProps<{
  data: RangeStatsDetail;
  stockName?: string;
  stockCode?: string;
  adjustLabel?: string;
}>();

const emit = defineEmits<{
  close: [];
  "pattern-match": [];
  ranking: [];
  "sector-ranking": [];
}>();

function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function pctClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v) || v === 0) return "";
  return v > 0 ? "rs-up" : "rs-down";
}

const d = computed(() => props.data);

const statCards = computed(() => {
  const x = d.value;
  return [
    { label: "区间涨跌", value: fmtNum(x.change), cls: pctClass(x.change) },
    { label: "涨跌幅", value: fmtPct(x.changePct), cls: pctClass(x.changePct) },
    { label: "振幅", value: fmtPct(x.amplitudePct), cls: "" },
    { label: "最高 / 最低", value: `${fmtNum(x.high)} / ${fmtNum(x.low)}`, cls: "" },
    { label: "成交量", value: fmtMoney(x.volumeSum), cls: "" },
    { label: "成交额", value: fmtMoney(x.amountSum), cls: "" },
    { label: "区间年化", value: fmtPct(x.annualizedPct), cls: pctClass(x.annualizedPct) },
    { label: "最大涨幅", value: fmtPct(x.maxRisePct), cls: "rs-up" },
    { label: "最大回撤", value: fmtPct(x.maxDrawdownPct), cls: "rs-down" },
    { label: "波动率", value: fmtPct(x.volatilityPct), cls: "" },
    { label: "夏普比率", value: fmtNum(x.sharpe), cls: "" },
    { label: "K线根数", value: `${x.bars} 根 / ${x.calendarDays} 天`, cls: "" },
  ];
});
</script>

<template>
  <div class="rs-mask" @click.self="emit('close')">
    <div class="rs-panel">
      <header class="rs-head">
        <div>
          <h3>区间统计</h3>
          <p>
            {{ stockName || "" }} <em v-if="stockCode">{{ stockCode }}</em>
            <span v-if="adjustLabel"> · {{ adjustLabel }}</span>
          </p>
          <p class="rs-range">
            {{ d.startDate }} → {{ d.endDate }}
          </p>
        </div>
        <button type="button" class="rs-close" title="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="rs-cards">
        <div v-for="c in statCards" :key="c.label" class="rs-card">
          <span>{{ c.label }}</span>
          <strong :class="c.cls">{{ c.value }}</strong>
        </div>
      </div>

      <div class="rs-candles">
        <span class="rs-candle rs-yang">阳线 {{ d.yangCount }}</span>
        <span class="rs-candle rs-yin">阴线 {{ d.yinCount }}</span>
        <span class="rs-candle">平盘 {{ d.flatCandleCount }}</span>
        <span class="rs-candle rs-up">上涨日 {{ d.upCount }}</span>
        <span class="rs-candle rs-down">下跌日 {{ d.downCount }}</span>
        <span class="rs-candle">持平日 {{ d.flatDayCount }}</span>
      </div>

      <div class="rs-actions">
        <button type="button" class="rs-btn rs-btn-accent" @click="emit('pattern-match')">
          形态匹配
        </button>
        <button type="button" class="rs-btn" @click="emit('ranking')">区间排行</button>
        <button type="button" class="rs-btn" @click="emit('sector-ranking')">板块排行</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rs-mask {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(15 23 42 / 32%);
  backdrop-filter: blur(2px);
}

.rs-panel {
  width: min(560px, calc(100% - 48px));
  max-height: calc(100% - 64px);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  box-shadow: 0 18px 50px rgb(15 23 42 / 30%);
  padding: 18px 20px 16px;
}

.rs-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}

.rs-head h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}

.rs-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
}

.rs-head p em {
  font-style: normal;
  color: var(--color-accent);
}

.rs-range {
  font-variant-numeric: tabular-nums;
}

.rs-close {
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  width: 28px;
  height: 28px;
  cursor: pointer;
  flex-shrink: 0;
}

.rs-close:hover {
  color: var(--color-text);
  border-color: var(--color-accent);
}

.rs-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.rs-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--color-bg);
}

.rs-card span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.rs-card strong {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.rs-candles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.rs-candle {
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 10px;
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.rs-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.rs-btn {
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  padding: 8px 14px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.rs-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.rs-btn-accent {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.rs-btn-accent:hover {
  color: #fff;
  opacity: 0.9;
}

.rs-up {
  color: var(--color-up);
}

.rs-down {
  color: var(--color-down);
}
</style>