<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import {
  fetchLhbDaily,
  fetchLhbSeats,
  formatAmount,
  formatPct,
  type LhbDailyItem,
  type LhbSeatDetailResponse,
} from "@/api/lhb";
import { ApiError } from "@/api/stock";
import LhbGraph from "@/components/LhbGraph.vue";

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const tradeDate = ref(todayIso());
const loadingList = ref(false);
const loadingSeats = ref(false);
const listError = ref<string | null>(null);
const seatError = ref<string | null>(null);
const source = ref<string>("");
const items = ref<LhbDailyItem[]>([]);
const selected = ref<LhbDailyItem | null>(null);
const detail = ref<LhbSeatDetailResponse | null>(null);
const keyword = ref("");

let listAbort: AbortController | null = null;
let seatAbort: AbortController | null = null;

const filteredItems = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter(
    (it) =>
      it.code.includes(q) ||
      it.name.toLowerCase().includes(q) ||
      it.reason.toLowerCase().includes(q) ||
      it.insight.toLowerCase().includes(q),
  );
});

function pctClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value === 0) return "text-text";
  return value > 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]";
}

function seatKindLabel(kind: string): string {
  if (kind === "institution") return "机构";
  if (kind === "other") return "通道";
  return "游资";
}

async function loadDaily() {
  listAbort?.abort();
  listAbort = new AbortController();
  loadingList.value = true;
  listError.value = null;
  try {
    const data = await fetchLhbDaily(tradeDate.value, listAbort.signal);
    items.value = data.items;
    source.value = data.source;
    tradeDate.value = data.trade_date;
    if (data.items.length) {
      const keep = selected.value
        ? data.items.find((x) => x.code === selected.value?.code && x.trade_date === selected.value?.trade_date)
        : null;
      await selectItem(keep ?? data.items[0]);
    } else {
      selected.value = null;
      detail.value = null;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    items.value = [];
    selected.value = null;
    detail.value = null;
    listError.value = err instanceof ApiError ? err.message : "加载龙虎榜失败";
  } finally {
    loadingList.value = false;
  }
}

async function selectItem(item: LhbDailyItem) {
  selected.value = item;
  seatAbort?.abort();
  seatAbort = new AbortController();
  loadingSeats.value = true;
  seatError.value = null;
  try {
    detail.value = await fetchLhbSeats(item.code, {
      tradeDate: item.trade_date,
      name: item.name,
      signal: seatAbort.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    detail.value = null;
    seatError.value = err instanceof ApiError ? err.message : "加载席位失败";
  } finally {
    loadingSeats.value = false;
  }
}

watch(tradeDate, () => {
  // 用户改日期后再点查询，避免每个按键都请求
});

onBeforeUnmount(() => {
  listAbort?.abort();
  seatAbort?.abort();
});

loadDaily();
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4">
    <section class="card shrink-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="card-title mb-1">龙虎榜分析</h2>
          <p class="text-sm text-text-muted">
            日榜筛选 + 买卖席位关系图谱（Cytoscape）。红线买入，绿线卖出。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-sm text-text-muted" for="lhb-date">交易日</label>
          <input
            id="lhb-date"
            v-model="tradeDate"
            type="date"
            class="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          />
          <button type="button" class="btn btn-primary" :disabled="loadingList" @click="loadDaily">
            {{ loadingList ? "加载中…" : "查询" }}
          </button>
          <span v-if="source" class="text-xs text-text-muted">数据源 {{ source }}</span>
        </div>
      </div>
    </section>

    <div v-if="listError" class="rounded-lg border border-[var(--color-up)]/30 bg-[var(--color-up)]/5 px-4 py-3 text-sm text-[var(--color-up)]">
      {{ listError }}
    </div>

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <!-- 左：日榜表 -->
      <section class="card flex min-h-0 flex-col overflow-hidden p-0">
        <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 class="text-sm font-semibold text-text">
            上榜股票
            <span class="ml-1 font-normal text-text-muted">({{ filteredItems.length }})</span>
          </h3>
          <input
            v-model="keyword"
            type="search"
            placeholder="搜索代码 / 名称 / 原因"
            class="w-48 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text placeholder:text-text-muted"
          />
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <table class="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead class="sticky top-0 z-10 bg-bg-elevated text-xs text-text-muted">
              <tr class="border-b border-border">
                <th class="px-3 py-2 font-medium">代码</th>
                <th class="px-3 py-2 font-medium">名称</th>
                <th class="px-3 py-2 font-medium text-right">涨跌幅</th>
                <th class="px-3 py-2 font-medium text-right">净买额</th>
                <th class="px-3 py-2 font-medium">解读</th>
                <th class="px-3 py-2 font-medium">上榜原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredItems.length && !loadingList">
                <td colspan="6" class="px-3 py-10 text-center text-text-muted">暂无数据</td>
              </tr>
              <tr
                v-for="item in filteredItems"
                :key="`${item.code}-${item.trade_date}-${item.reason}`"
                class="cursor-pointer border-b border-border/70 transition-colors hover:bg-bg"
                :class="{
                  'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]':
                    selected?.code === item.code && selected?.reason === item.reason,
                }"
                @click="selectItem(item)"
              >
                <td class="px-3 py-2 font-mono text-xs">{{ item.code }}</td>
                <td class="px-3 py-2 font-medium">{{ item.name }}</td>
                <td class="px-3 py-2 text-right tabular-nums" :class="pctClass(item.change_pct)">
                  {{ formatPct(item.change_pct) }}
                </td>
                <td class="px-3 py-2 text-right tabular-nums" :class="pctClass(item.net_buy)">
                  {{ formatAmount(item.net_buy) }}
                </td>
                <td class="max-w-[140px] truncate px-3 py-2 text-text-muted" :title="item.insight">
                  {{ item.insight || "—" }}
                </td>
                <td class="max-w-[180px] truncate px-3 py-2 text-text-muted" :title="item.reason">
                  {{ item.reason || "—" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 右：席位 + 图谱 -->
      <section class="card flex min-h-0 flex-col gap-3 overflow-hidden">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="text-sm font-semibold text-text">
              <template v-if="selected">
                {{ selected.name }}
                <span class="ml-1 font-mono text-xs font-normal text-text-muted">{{ selected.code }}</span>
              </template>
              <template v-else>席位关系</template>
            </h3>
            <p v-if="detail" class="mt-1 text-xs text-text-muted">
              {{ detail.trade_date }} · 买 {{ detail.buys.length }} / 卖 {{ detail.sells.length }} ·
              {{ detail.source }}
            </p>
          </div>
          <span v-if="loadingSeats" class="text-xs text-text-muted">席位加载中…</span>
        </div>

        <div v-if="seatError" class="text-sm text-[var(--color-up)]">{{ seatError }}</div>

        <div class="min-h-[360px] flex-1">
          <LhbGraph
            v-if="detail?.graph"
            :nodes="detail.graph.nodes"
            :edges="detail.graph.edges"
          />
          <div
            v-else
            class="flex h-full min-h-[360px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-text-muted"
          >
            选择左侧股票查看买卖席位图谱
          </div>
        </div>

        <div v-if="detail" class="grid gap-3 md:grid-cols-2">
          <div class="overflow-hidden rounded-lg border border-border">
            <div class="border-b border-border bg-bg px-3 py-2 text-xs font-semibold text-[var(--color-up)]">
              买入前五
            </div>
            <ul class="divide-y divide-border text-xs">
              <li
                v-for="seat in detail.buys"
                :key="`b-${seat.rank}-${seat.seat_name}`"
                class="flex items-start justify-between gap-2 px-3 py-2"
              >
                <div class="min-w-0">
                  <div class="truncate font-medium text-text" :title="seat.seat_name">
                    {{ seat.seat_name }}
                  </div>
                  <div class="mt-0.5 text-text-muted">{{ seatKindLabel(seat.seat_kind) }}</div>
                </div>
                <div class="shrink-0 text-right tabular-nums text-[var(--color-up)]">
                  {{ formatAmount(seat.net_amount || seat.buy_amount) }}
                </div>
              </li>
            </ul>
          </div>

          <div class="overflow-hidden rounded-lg border border-border">
            <div class="border-b border-border bg-bg px-3 py-2 text-xs font-semibold text-[var(--color-down)]">
              卖出前五
            </div>
            <ul class="divide-y divide-border text-xs">
              <li
                v-for="seat in detail.sells"
                :key="`s-${seat.rank}-${seat.seat_name}`"
                class="flex items-start justify-between gap-2 px-3 py-2"
              >
                <div class="min-w-0">
                  <div class="truncate font-medium text-text" :title="seat.seat_name">
                    {{ seat.seat_name }}
                  </div>
                  <div class="mt-0.5 text-text-muted">{{ seatKindLabel(seat.seat_kind) }}</div>
                </div>
                <div class="shrink-0 text-right tabular-nums text-[var(--color-down)]">
                  {{ formatAmount(Math.abs(seat.net_amount || seat.sell_amount)) }}
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div class="flex flex-wrap gap-3 text-xs text-text-muted">
          <span class="inline-flex items-center gap-1.5">
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" /> 游资席位
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-[#8b5cf6]" /> 机构专用
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" /> 标的股票
          </span>
        </div>
      </section>
    </div>
  </div>
</template>
