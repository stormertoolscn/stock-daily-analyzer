<script setup lang="ts">
/**
 * 资金复盘：当日主力净流入 / 净流出榜。
 * 双击个股进入 K 线复盘；行内展示当日分时缩略图。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import {
  fetchFundFlowReview,
  formatFlowAmount,
  type FundFlowReview,
  type FundFlowStockItem,
} from "@/api/fundflow";
import { ApiError } from "@/api/stock";
import IntradaySpark from "@/components/IntradaySpark.vue";

defineOptions({ name: "CapitalFlow" });

const router = useRouter();
const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<FundFlowReview | null>(null);

/** 净流入资金：默认大→小；净流出资金：默认 |额| 大→小（更负在前） */
const inflowAsc = ref(false);
const outflowAsc = ref(false);

let abort: AbortController | null = null;

async function load(refresh = false) {
  abort?.abort();
  abort = new AbortController();
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchFundFlowReview(refresh, abort.signal);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    error.value = err instanceof ApiError ? err.message : "加载资金复盘失败";
  } finally {
    loading.value = false;
  }
}

function openKline(row: FundFlowStockItem) {
  if (!row.code) return;
  void router.push({
    name: "kline",
    query: { code: row.code, name: row.name },
  });
}

function signedPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function pctClass(v: number): string {
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "";
}

function toggleInflowSort() {
  inflowAsc.value = !inflowAsc.value;
}

function toggleOutflowSort() {
  outflowAsc.value = !outflowAsc.value;
}

const sortedInflows = computed(() => {
  const list = [...(data.value?.inflows ?? [])];
  list.sort((a, b) =>
    inflowAsc.value
      ? a.net_amount - b.net_amount
      : b.net_amount - a.net_amount,
  );
  return list.map((row, i) => ({ ...row, rank: i + 1 }));
});

/** 默认净流出大→小（更负在前）；点击切换 */
const sortedOutflows = computed(() => {
  const list = [...(data.value?.outflows ?? [])];
  list.sort((a, b) =>
    outflowAsc.value
      ? b.net_amount - a.net_amount
      : a.net_amount - b.net_amount,
  );
  return list.map((row, i) => ({ ...row, rank: i + 1 }));
});

onMounted(() => {
  void load();
});

onBeforeUnmount(() => {
  abort?.abort();
});
</script>

<template>
  <div class="cf-page">
    <header class="cf-hero">
      <div class="cf-hero-text">
        <p class="cf-kicker">Capital Flow</p>
        <h1>
          资金复盘
          <em v-if="data">{{ data.trade_date }}</em>
        </h1>
        <p class="cf-sub">
          看清当日主力去向：左侧承接、右侧撤离。双击个股进入 K 线复盘。
        </p>
      </div>
      <div class="cf-hero-actions">
        <button type="button" class="cf-btn" :disabled="loading" @click="load(true)">
          {{ loading ? "刷新中…" : "刷新" }}
        </button>
        <span v-if="data" class="cf-meta">
          {{ data.session_label }} · {{ data.source }} · {{ data.updated_at }}
        </span>
      </div>
    </header>

    <div v-if="error" class="cf-error">{{ error }}</div>
    <div v-else-if="loading && !data" class="cf-empty">正在拉取当日资金流向…</div>

    <template v-else-if="data">
      <section class="cf-totals">
        <div class="cf-total in">
          <span>净流入合计</span>
          <strong>{{ formatFlowAmount(data.inflow_total) }}</strong>
        </div>
        <div class="cf-total out">
          <span>净流出合计</span>
          <strong>{{ formatFlowAmount(data.outflow_total) }}</strong>
        </div>
      </section>

      <section v-if="data.themes.length" class="cf-themes">
        <h2>主线题材</h2>
        <div class="cf-theme-row">
          <button
            v-for="t in data.themes"
            :key="t.name + t.side"
            type="button"
            class="cf-theme"
            :class="t.side"
            :title="formatFlowAmount(t.net_amount)"
          >
            <span>{{ t.name }}</span>
            <em>{{ formatFlowAmount(t.net_amount) }}</em>
          </button>
        </div>
      </section>

      <section class="cf-boards">
        <div class="cf-board">
          <header>
            <h2>净流入个股</h2>
          </header>
          <div class="cf-cols">
            <span class="col-rank">#</span>
            <span class="col-name">名称</span>
            <span class="col-spark">分时简图</span>
            <button
              type="button"
              class="col-amt sortable"
              title="点击按净流入资金排序"
              @click="toggleInflowSort"
            >
              净流入资金 {{ inflowAsc ? "↑" : "↓" }}
            </button>
          </div>
          <ul>
            <li
              v-for="row in sortedInflows"
              :key="'in-' + row.code"
              title="双击打开 K 线复盘"
              @dblclick="openKline(row)"
            >
              <span class="rank">{{ row.rank }}</span>
              <div class="id">
                <strong>{{ row.name }}</strong>
                <em>{{ row.code }}</em>
              </div>
              <IntradaySpark :code="row.code" tone="up" />
              <div class="nums">
                <span class="up">{{ formatFlowAmount(row.net_amount) }}</span>
                <span :class="pctClass(row.change_pct)">{{
                  signedPct(row.change_pct)
                }}</span>
              </div>
            </li>
          </ul>
        </div>

        <div class="cf-board">
          <header>
            <h2>净流出个股</h2>
          </header>
          <div class="cf-cols">
            <span class="col-rank">#</span>
            <span class="col-name">名称</span>
            <span class="col-spark">分时简图</span>
            <button
              type="button"
              class="col-amt sortable"
              title="点击按净流出资金排序"
              @click="toggleOutflowSort"
            >
              净流出资金 {{ outflowAsc ? "↑" : "↓" }}
            </button>
          </div>
          <ul>
            <li
              v-for="row in sortedOutflows"
              :key="'out-' + row.code"
              title="双击打开 K 线复盘"
              @dblclick="openKline(row)"
            >
              <span class="rank">{{ row.rank }}</span>
              <div class="id">
                <strong>{{ row.name }}</strong>
                <em>{{ row.code }}</em>
              </div>
              <IntradaySpark :code="row.code" tone="down" />
              <div class="nums">
                <span class="down">{{ formatFlowAmount(row.net_amount) }}</span>
                <span :class="pctClass(row.change_pct)">{{
                  signedPct(row.change_pct)
                }}</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section class="cf-summary">
        <h2>一句话综述</h2>
        <p>{{ data.summary }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.cf-page {
  --cf-ink: #152033;
  --cf-muted: #5b6b82;
  --cf-line: color-mix(in srgb, #152033 12%, transparent);
  --cf-up: var(--color-up, #f5222d);
  --cf-down: var(--color-down, #16a34a);
  --cf-paper: #f3f6fb;
  --cf-card: #ffffff;
  height: 100%;
  overflow: auto;
  padding: 20px 24px 40px;
  background:
    radial-gradient(1200px 420px at 8% -10%, #dce9ff 0%, transparent 55%),
    radial-gradient(900px 360px at 100% 0%, #ffe8d6 0%, transparent 50%),
    var(--cf-paper);
  color: var(--cf-ink);
}

.cf-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 18px;
}

.cf-kicker {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--cf-muted);
}

.cf-hero h1 {
  margin: 4px 0 0;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.cf-hero h1 em {
  margin-left: 10px;
  font-style: normal;
  font-size: 18px;
  font-weight: 600;
  color: var(--cf-muted);
}

.cf-sub {
  margin: 8px 0 0;
  max-width: 42rem;
  color: var(--cf-muted);
  font-size: 14px;
  line-height: 1.5;
}

.cf-hero-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.cf-btn {
  appearance: none;
  border: 1px solid var(--cf-line);
  background: var(--cf-card);
  color: var(--cf-ink);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}

.cf-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.cf-meta {
  font-size: 12px;
  color: var(--cf-muted);
}

.cf-error,
.cf-empty {
  padding: 24px;
  border-radius: 14px;
  background: var(--cf-card);
  border: 1px solid var(--cf-line);
  color: var(--cf-muted);
}

.cf-error {
  color: var(--cf-up);
}

.cf-totals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.cf-total {
  background: var(--cf-card);
  border: 1px solid var(--cf-line);
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.cf-total span {
  color: var(--cf-muted);
  font-size: 13px;
}

.cf-total strong {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}

.cf-total.in strong {
  color: var(--cf-up);
}

.cf-total.out strong {
  color: var(--cf-down);
}

.cf-themes {
  margin-bottom: 16px;
}

.cf-themes h2,
.cf-summary h2,
.cf-board header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.cf-theme-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.cf-theme {
  appearance: none;
  border: 1px solid var(--cf-line);
  background: var(--cf-card);
  border-radius: 999px;
  padding: 7px 12px;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  cursor: default;
  font-size: 13px;
}

.cf-theme em {
  font-style: normal;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.cf-theme.in em {
  color: var(--cf-up);
}

.cf-theme.out em {
  color: var(--cf-down);
}

.cf-boards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  min-height: 0;
}

.cf-board {
  background: var(--cf-card);
  border: 1px solid var(--cf-line);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 420px;
}

.cf-board header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 14px 16px 8px;
}

.cf-cols {
  display: grid;
  grid-template-columns: 28px minmax(72px, 1fr) 88px auto;
  gap: 10px;
  align-items: center;
  padding: 0 16px 8px;
  border-bottom: 1px solid var(--cf-line);
  font-size: 12px;
  color: var(--cf-muted);
}

.col-amt {
  justify-self: end;
  text-align: right;
}

.sortable {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--cf-muted);
  font-size: 12px;
  padding: 0;
  cursor: pointer;
  font-weight: 600;
}

.sortable:hover {
  color: var(--cf-ink);
}

.cf-board ul {
  list-style: none;
  margin: 0;
  padding: 6px 0 10px;
  overflow: auto;
  flex: 1;
}

.cf-board li {
  display: grid;
  grid-template-columns: 28px minmax(72px, 1fr) 88px auto;
  gap: 10px;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.cf-board li:hover {
  background: color-mix(in srgb, #2563eb 8%, transparent);
}

.rank {
  font-size: 12px;
  color: var(--cf-muted);
  font-variant-numeric: tabular-nums;
}

.id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.id strong {
  font-size: 14px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.id em {
  font-style: normal;
  font-size: 12px;
  color: #2563eb;
  font-variant-numeric: tabular-nums;
}

.nums {
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  justify-self: end;
}

.up {
  color: var(--cf-up);
}

.down {
  color: var(--cf-down);
}

.cf-summary {
  margin-top: 16px;
  background: var(--cf-card);
  border: 1px solid var(--cf-line);
  border-radius: 14px;
  padding: 14px 16px 16px;
}

.cf-summary p {
  margin: 8px 0 0;
  line-height: 1.7;
  color: color-mix(in srgb, var(--cf-ink) 88%, transparent);
  font-size: 14px;
}

@media (max-width: 960px) {
  .cf-boards,
  .cf-totals,
  .cf-hero {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .cf-hero-actions {
    align-items: flex-start;
  }
}
</style>
