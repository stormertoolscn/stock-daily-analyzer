<script setup lang="ts">
/**
 * 游资追踪：按顶级游资（章盟主 / 欢乐海岸等）查询近期龙虎榜交易。
 */
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import {
  fetchHotMoneyList,
  fetchHotMoneyTrades,
  formatAmount,
  type HotMoneyTradeItem,
  type HotMoneyTrader,
} from "@/api/lhb";
import { ApiError, fetchStockQuotes, searchStocks } from "@/api/stock";
import { HOT_MONEY_LIST } from "@/data/hotMoneyMap";

const RETURN_KEY = "sda-hm-track-return";

type ReturnPoint = {
  hmId: string;
  days: number;
  scrollTop: number;
  sideScrollTop: number;
  focusKey: string;
};

const props = defineProps<{
  /** 外部指定初始游资 id，如 hlha / zmz */
  initialId?: string | null;
}>();

const emit = defineEmits<{
  "select-trader": [trader: HotMoneyTrader];
}>();

const router = useRouter();
const keyword = ref("");
const days = ref(7);
const traders = ref<HotMoneyTrader[]>([]);
const selectedId = ref("");
const trades = ref<HotMoneyTradeItem[]>([]);
const tradeSource = ref("");
const rangeText = ref("");
const listLoading = ref(false);
const tradeLoading = ref(false);
const error = ref<string | null>(null);
const focusKey = ref("");
const tableWrapRef = ref<HTMLElement | null>(null);
const sideListRef = ref<HTMLElement | null>(null);
/** code -> 最新价（收盘后即收盘价） */
const priceByCode = ref<Record<string, { price: number; changePct: number }>>({});

/** 与龙虎榜首页一致：代码 / 名称分列（可切回合并显示） */
const splitCodeName = ref(localStorage.getItem("sda-hm-split-code") !== "0");
watch(splitCodeName, (v) => localStorage.setItem("sda-hm-split-code", v ? "1" : "0"));

type TradeSortKey = "side" | "buy_amount" | "sell_amount" | "net_amount" | "price";

const sortKey = ref<TradeSortKey | null>(null);
const sortAsc = ref(false);

function toggleSort(key: TradeSortKey) {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else {
    sortKey.value = key;
    sortAsc.value = false;
  }
}

function sortMark(key: TradeSortKey): string {
  if (sortKey.value !== key) return "";
  return sortAsc.value ? "↑" : "↓";
}

function rowPrice(row: HotMoneyTradeItem): number | null {
  const code = (row.code || "").trim();
  if (!code) return null;
  const hit = priceByCode.value[code];
  return hit?.price ?? null;
}

function sortValue(row: HotMoneyTradeItem, key: TradeSortKey): number {
  switch (key) {
    case "side":
      return row.side === "buy" ? 1 : 0;
    case "buy_amount":
      return row.buy_amount ?? 0;
    case "sell_amount":
      return row.sell_amount ?? 0;
    case "net_amount":
      return row.net_amount ?? 0;
    case "price":
      return rowPrice(row) ?? -1;
    default:
      return 0;
  }
}

const sortedTrades = computed(() => {
  const list = [...trades.value];
  const key = sortKey.value;
  const asc = sortAsc.value;
  list.sort((a, b) => {
    if (key) {
      const cmp = sortValue(a, key) - sortValue(b, key);
      if (cmp !== 0) return asc ? cmp : -cmp;
    }
    // 默认 / 次级：日期新→旧
    return (b.trade_date || "").localeCompare(a.trade_date || "");
  });
  return list;
});

let listAbort: AbortController | null = null;
let tradeAbort: AbortController | null = null;
let quoteAbort: AbortController | null = null;

async function loadTradeQuotes(items: HotMoneyTradeItem[]) {
  const codes = [
    ...new Set(items.map((r) => (r.code || "").trim()).filter((c) => /^\d{6}$/.test(c))),
  ];
  if (!codes.length) {
    priceByCode.value = {};
    return;
  }
  quoteAbort?.abort();
  quoteAbort = new AbortController();
  try {
    const quotes = await fetchStockQuotes(codes, quoteAbort.signal);
    const next: Record<string, { price: number; changePct: number }> = {};
    for (const q of quotes) {
      if (q.price == null || !Number.isFinite(q.price)) continue;
      next[q.code] = {
        price: q.price,
        changePct: q.change_pct ?? 0,
      };
    }
    priceByCode.value = next;
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    // 行情失败不阻断列表
  }
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toFixed(0);
  if (n >= 100) return n.toFixed(2);
  if (n >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function priceClass(row: HotMoneyTradeItem): string {
  const code = (row.code || "").trim();
  const hit = priceByCode.value[code];
  if (!hit) return "";
  if (hit.changePct > 0) return "up";
  if (hit.changePct < 0) return "down";
  return "";
}

function tradeRowKey(row: HotMoneyTradeItem, idx = 0): string {
  // 焦点还原用稳定字段；idx 仅防极端重复行
  return `${row.trade_date}|${row.code}|${row.name}|${row.side}|${row.seat_name}|${row.buy_amount}|${row.sell_amount}|${idx}`;
}

function tradeFocusKey(row: HotMoneyTradeItem): string {
  return `${row.trade_date}|${row.code}|${row.name}|${row.side}|${row.seat_name}|${row.buy_amount}|${row.sell_amount}`;
}

function readReturnPoint(): ReturnPoint | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReturnPoint;
  } catch {
    return null;
  }
}

function saveReturnPoint(row: HotMoneyTradeItem, idx: number) {
  const point: ReturnPoint = {
    hmId: selectedId.value,
    days: days.value,
    scrollTop: tableWrapRef.value?.scrollTop ?? 0,
    sideScrollTop: sideListRef.value?.scrollTop ?? 0,
    focusKey: tradeFocusKey(row),
  };
  sessionStorage.setItem(RETURN_KEY, JSON.stringify(point));
  focusKey.value = point.focusKey;
}

async function restoreReturnPoint() {
  const point = readReturnPoint();
  if (!point || point.hmId !== selectedId.value) return;
  focusKey.value = point.focusKey;
  await nextTick();
  if (sideListRef.value) sideListRef.value.scrollTop = point.sideScrollTop;
  if (tableWrapRef.value) tableWrapRef.value.scrollTop = point.scrollTop;
  const el = tableWrapRef.value?.querySelector(
    `[data-row-key="${CSS.escape(point.focusKey)}"]`,
  ) as HTMLElement | null;
  el?.scrollIntoView({ block: "nearest" });
}

const selected = computed(
  () => traders.value.find((t) => t.id === selectedId.value) ?? null,
);

const featured = computed(() => traders.value.filter((t) => t.featured));

async function loadTraders() {
  listAbort?.abort();
  listAbort = new AbortController();
  listLoading.value = true;
  error.value = null;
  try {
    traders.value = await fetchHotMoneyList(keyword.value, listAbort.signal);
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    // 后端不可用时回落本地名录，保证入口始终可用
    const q = keyword.value.trim().toLowerCase();
    traders.value = HOT_MONEY_LIST.filter((h) => {
      if (!q) return true;
      const bag = [h.name, h.seat, ...h.aliases, ...h.keywords].join(" ").toLowerCase();
      return bag.includes(q);
    }).map((h) => ({
      id: h.id,
      name: h.name,
      seat: h.seat,
      keywords: h.keywords,
      aliases: h.aliases,
      intro: h.intro,
      featured: Boolean(h.featured),
      tier: h.tier,
    }));
    error.value = err instanceof ApiError ? err.message : null;
  } finally {
    listLoading.value = false;
    if (!selectedId.value && traders.value.length) {
      const prefer =
        (props.initialId && traders.value.find((t) => t.id === props.initialId)) ||
        traders.value.find((t) => t.id === "hlha") ||
        traders.value.find((t) => t.id === "zmz") ||
        traders.value[0];
      if (prefer) void selectTrader(prefer);
    }
  }
}

async function resolveStockCode(
  name: string,
): Promise<{ code: string; name: string } | null> {
  const nm = name.trim();
  if (!nm || nm.startsWith("（") || nm.startsWith("(")) return null;
  try {
    const hits = await searchStocks(nm, 5);
    const hit =
      hits.find((h) => h.name === nm) ||
      hits.find((h) => nm.includes(h.name) || h.name.includes(nm)) ||
      hits[0];
    if (hit?.code) return { code: hit.code, name: hit.name || nm };
  } catch {
    /* ignore */
  }
  return null;
}

/** 后端未带回代码时，按名称补齐，便于展示「名称（代码）」与双击跳转 */
async function enrichTradeCodes(items: HotMoneyTradeItem[]) {
  const need = items.filter((r) => !r.code?.trim() && r.name && !r.name.startsWith("（"));
  if (!need.length) return;
  const cache = new Map<string, { code: string; name: string } | null>();
  await Promise.all(
    [...new Set(need.map((r) => r.name.trim()))].map(async (nm) => {
      cache.set(nm, await resolveStockCode(nm));
    }),
  );
  for (const row of need) {
    const hit = cache.get(row.name.trim());
    if (hit) {
      row.code = hit.code;
      row.name = hit.name;
    }
  }
}

async function selectTrader(t: HotMoneyTrader) {
  selectedId.value = t.id;
  emit("select-trader", t);
  tradeAbort?.abort();
  tradeAbort = new AbortController();
  tradeLoading.value = true;
  try {
    const data = await fetchHotMoneyTrades(t.id, days.value, tradeAbort.signal);
    trades.value = data.items;
    tradeSource.value = data.source;
    rangeText.value = `${data.range_start} ~ ${data.range_end}`;
    await enrichTradeCodes(trades.value);
    await loadTradeQuotes(trades.value);
    await restoreReturnPoint();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    trades.value = [];
    priceByCode.value = {};
    tradeSource.value = "";
    rangeText.value = "";
    error.value = err instanceof ApiError ? err.message : "加载交易失败";
  } finally {
    tradeLoading.value = false;
  }
}

function formatStockLabel(row: HotMoneyTradeItem): string {
  const name = (row.name || "").trim() || "未知";
  const code = (row.code || "").trim();
  if (!code) return name;
  return `${name}（${code}）`;
}

function displayCode(row: HotMoneyTradeItem): string {
  return (row.code || "").trim() || "—";
}

function displayName(row: HotMoneyTradeItem): string {
  return (row.name || "").trim() || "—";
}

async function openKline(row: HotMoneyTradeItem, idx: number) {
  let code = (row.code || "").trim();
  let name = (row.name || "").trim();
  if (!code && name) {
    const hit = await resolveStockCode(name);
    if (hit) {
      code = hit.code;
      name = hit.name;
      row.code = hit.code;
      row.name = hit.name;
    }
  }
  if (!code) return;

  saveReturnPoint(row, idx);
  // 先把当前游资追踪写入历史栈，Back 可回到同一游资与滚动位置
  await router.replace({
    name: "lhb-v3",
    query: {
      tab: "hotmoney",
      hm: selectedId.value || undefined,
    },
  });
  void router.push({
    name: "kline",
    query: { code, name },
  });
}

watch(keyword, () => {
  void loadTraders();
});

watch(days, () => {
  if (selected.value) void selectTrader(selected.value);
});

onMounted(() => {
  void loadTraders();
});

onActivated(() => {
  void restoreReturnPoint();
});

onBeforeUnmount(() => {
  listAbort?.abort();
  tradeAbort?.abort();
  quoteAbort?.abort();
});
</script>

<template>
  <div class="hm-track">
    <aside class="hm-side">
      <div class="hm-side-head">
        <strong>游资名录</strong>
        <input
          v-model="keyword"
          type="search"
          class="hm-search"
          placeholder="搜：章盟主 / 欢乐海岸 / 溧阳路"
        />
      </div>

      <div v-if="featured.length" class="hm-chips">
        <button
          v-for="t in featured.slice(0, 8)"
          :key="'chip-' + t.id"
          type="button"
          class="hm-chip"
          :class="{ active: selectedId === t.id }"
          @click="selectTrader(t)"
        >
          <span v-if="t.tier" class="tier">{{ t.tier }}</span>
          {{ t.name }}
        </button>
      </div>

      <div class="hm-list" ref="sideListRef">
        <div v-if="listLoading" class="hm-empty">加载名录…</div>
        <button
          v-for="t in traders"
          :key="t.id"
          type="button"
          class="hm-item"
          :class="{ active: selectedId === t.id }"
          @click="selectTrader(t)"
        >
          <div class="row1">
            <strong>{{ t.name }}</strong>
            <em v-if="t.tier">{{ t.tier }}级</em>
          </div>
          <div class="row2" :title="t.seat">{{ t.seat }}</div>
        </button>
        <div v-if="!traders.length && !listLoading" class="hm-empty">无匹配游资</div>
      </div>
    </aside>

    <section class="hm-main">
      <header class="hm-main-head" v-if="selected">
        <div>
          <h3>
            {{ selected.name }}
            <span v-if="selected.tier" class="tier-pill">{{ selected.tier }}</span>
          </h3>
          <p>{{ selected.intro }}</p>
          <p class="seat">主席位：{{ selected.seat }}</p>
        </div>
        <div class="hm-tools">
          <label class="hm-split-toggle" title="与龙虎榜首页一致：代码、名称分列">
            <input v-model="splitCodeName" type="checkbox" />
            代码/名称分列
          </label>
          <label>
            近
            <select v-model.number="days">
              <option :value="3">3</option>
              <option :value="7">7</option>
              <option :value="14">14</option>
              <option :value="30">30</option>
            </select>
            日
          </label>
          <span class="meta" v-if="rangeText">{{ rangeText }} · {{ tradeSource || "—" }}</span>
        </div>
      </header>
      <div v-else class="hm-empty big">请选择左侧游资，查看其近期龙虎榜交易</div>

      <div v-if="error" class="hm-error">{{ error }}</div>
      <div v-if="tradeLoading" class="hm-empty">正在拉取交易…</div>

      <div v-else-if="selected" ref="tableWrapRef" class="hm-table-wrap">
        <table class="hm-table">
          <thead>
            <tr>
              <th>日期</th>
              <th class="sortable" @click="toggleSort('side')">
                方向 {{ sortMark("side") }}
              </th>
              <template v-if="splitCodeName">
                <th>代码</th>
                <th>名称</th>
              </template>
              <th v-else>股票</th>
              <th class="sortable num" @click="toggleSort('buy_amount')">
                买入 {{ sortMark("buy_amount") }}
              </th>
              <th class="sortable num" @click="toggleSort('sell_amount')">
                卖出 {{ sortMark("sell_amount") }}
              </th>
              <th class="sortable num" @click="toggleSort('net_amount')">
                净额 {{ sortMark("net_amount") }}
              </th>
              <th
                class="sortable num"
                title="盘中为最新价，收盘后即为当日收盘价"
                @click="toggleSort('price')"
              >
                股价 {{ sortMark("price") }}
              </th>
              <th>营业部</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!sortedTrades.length">
              <td :colspan="splitCodeName ? 10 : 9" class="hm-empty">
                该区间暂无匹配交易（可扩大天数或换游资）
              </td>
            </tr>
            <tr
              v-for="(row, idx) in sortedTrades"
              :key="tradeRowKey(row, idx)"
              :data-row-key="tradeFocusKey(row)"
              class="hm-row"
              :class="{
                disabled: !row.code && (!row.name || row.name.startsWith('（')),
                focused: focusKey === tradeFocusKey(row),
              }"
              title="双击进入K线复盘并加入自选；K线页按 Backspace 返回此处"
              @dblclick="openKline(row, idx)"
            >
              <td>{{ row.trade_date }}</td>
              <td :class="row.side === 'buy' ? 'up' : 'down'">
                {{ row.side === "buy" ? "买" : "卖" }}
              </td>
              <template v-if="splitCodeName">
                <td class="code">{{ displayCode(row) }}</td>
                <td class="name-cell">{{ displayName(row) }}</td>
              </template>
              <td v-else class="stock-cell">
                <span class="stock-label">{{ formatStockLabel(row) }}</span>
              </td>
              <td class="num up">{{ formatAmount(row.buy_amount) }}</td>
              <td class="num down">{{ formatAmount(row.sell_amount) }}</td>
              <td class="num" :class="row.net_amount >= 0 ? 'up' : 'down'">
                {{ formatAmount(row.net_amount) }}
              </td>
              <td class="num" :class="priceClass(row)">{{ formatPrice(rowPrice(row)) }}</td>
              <td class="seat-cell" :title="row.seat_name">{{ row.seat_name }}</td>
              <td class="muted">{{ row.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hm-track {
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--v3-bg);
  color: var(--v3-text);
}

.hm-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--v3-border);
  background: var(--v3-panel);
}

.hm-side-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--v3-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hm-search {
  width: 100%;
  border: 1px solid var(--v3-border);
  background: var(--v3-bg);
  color: var(--v3-text);
  border-radius: 2px;
  padding: 6px 8px;
  font-size: 12px;
}

.hm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--v3-border);
}

.hm-chip {
  appearance: none;
  border: 1px solid var(--v3-border);
  background: var(--v3-bg);
  color: var(--v3-text);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}

.hm-chip.active {
  border-color: var(--v3-accent);
  color: var(--v3-accent);
  background: color-mix(in srgb, var(--v3-accent) 10%, var(--v3-bg));
}

.hm-chip .tier {
  font-size: 10px;
  font-weight: 700;
  margin-right: 2px;
  color: var(--v3-accent);
}

.hm-list {
  overflow: auto;
  flex: 1;
}

.hm-item {
  width: 100%;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--v3-border);
  background: transparent;
  color: var(--v3-text);
  padding: 10px 12px;
  cursor: pointer;
}

.hm-item:hover {
  background: var(--v3-row-hover);
}

.hm-item.active {
  background: var(--v3-row-active);
}

.hm-item .row1 {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.hm-item .row1 em {
  font-style: normal;
  color: var(--v3-muted);
  font-size: 11px;
}

.hm-item .row2 {
  margin-top: 4px;
  color: var(--v3-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hm-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.hm-main-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--v3-border);
  background: var(--v3-panel);
}

.hm-main-head h3 {
  margin: 0 0 6px;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hm-main-head p {
  margin: 0 0 4px;
  color: var(--v3-muted);
}

.hm-main-head .seat {
  color: var(--v3-text);
}

.tier-pill {
  font-size: 11px;
  border: 1px solid var(--v3-accent);
  color: var(--v3-accent);
  border-radius: 2px;
  padding: 0 5px;
  font-weight: 700;
}

.hm-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px 14px;
  font-size: 12px;
  color: var(--v3-muted);
}

.hm-tools select {
  border: 1px solid var(--v3-border);
  background: var(--v3-bg);
  color: var(--v3-text);
  margin: 0 4px;
}

.hm-split-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--v3-text);
  user-select: none;
}

.hm-split-toggle input {
  accent-color: var(--v3-accent, #2563eb);
}

.hm-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.hm-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 960px;
}

.hm-table th,
.hm-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--v3-border);
  text-align: left;
  white-space: nowrap;
}

.hm-table th {
  position: sticky;
  top: 0;
  background: var(--v3-thead);
  color: var(--v3-muted);
  font-weight: 500;
}

.hm-table th.sortable {
  cursor: pointer;
  color: var(--v3-link, var(--v3-accent, #2563eb));
  user-select: none;
}

.hm-table th.sortable:hover {
  color: var(--v3-accent, #2563eb);
}

.hm-table tbody tr.hm-row {
  cursor: pointer;
}

.hm-table tbody tr.hm-row.disabled {
  cursor: default;
  opacity: 0.7;
}

.hm-table tbody tr:hover {
  background: var(--v3-row-hover);
}

.hm-table tbody tr.hm-row.focused {
  outline: 1px solid color-mix(in srgb, var(--v3-accent, #2563eb) 55%, transparent);
  background: color-mix(in srgb, var(--v3-accent, #2563eb) 12%, transparent);
}

.stock-cell .stock-label {
  color: var(--v3-code);
  font-weight: 600;
}

.name-cell {
  font-weight: 500;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.code {
  color: var(--v3-code);
  font-weight: 400;
}

.up {
  color: var(--v3-up);
}

.down {
  color: var(--v3-down);
}

.muted {
  color: var(--v3-muted);
}

.seat-cell {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hm-empty {
  color: var(--v3-muted);
  text-align: center;
  padding: 24px 12px;
}

.hm-empty.big {
  padding: 48px 12px;
}

.hm-error {
  margin: 8px 12px;
  padding: 8px 10px;
  color: var(--v3-up);
  border: 1px solid color-mix(in srgb, var(--v3-up) 25%, transparent);
  background: color-mix(in srgb, var(--v3-up) 8%, transparent);
}

@media (max-width: 960px) {
  .hm-track {
    grid-template-columns: 1fr;
  }
}
</style>
