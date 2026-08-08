<script setup lang="ts">
/**
 * 同花顺海航版风格 K 线窗口：
 * 顶部代码输入 → 左侧自选清单 → 右侧清晰轻盈三栏图（K+MA / 量 / MACD）。
 * 行情走 /api/stock/{code}/kline（market_data 真源）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { fetchStockKline, searchStocks, type StockSearchItem } from "@/api/stock";
import ChipDistribution from "@/components/ChipDistribution.vue";
import IntradayFundPanel from "@/components/IntradayFundPanel.vue";
import IntradayRangeScrubber from "@/components/IntradayRangeScrubber.vue";
import KlineChart from "@/components/KlineChart.vue";
import { useResearchList } from "@/composables/useResearchList";
import { useWatchlist } from "@/composables/useWatchlist";
import {
  createKlineEngine,
  getAShareTheme,
  roundPrice,
  type ChartMode,
  type KlineBar,
  type KlineQuoteSnapshot,
} from "@/kline-engine";
import { useMaConfig } from "@/composables/useMaConfig";
import { computeIntradayFundStats } from "@/utils/intradayFundFlow";
import type { KlinePeriod } from "@/utils/mockKline";

const route = useRoute();
const router = useRouter();

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

const PERIODS: { id: KlinePeriod; label: string }[] = [
  { id: "intraday", label: "分时" },
  { id: "day", label: "日K" },
  { id: "week", label: "周K" },
  { id: "month", label: "月K" },
];

const INDICATORS = ["MACD", "KDJ", "BOLL", "BIAS", "RSI", "WR", "VR", "MA"];

const ADJUST_MAP = {
  前复权: "qfq",
  后复权: "hfq",
  不复权: "none",
} as const;

function routeStockCode(): string {
  const c = typeof route.query.code === "string" ? route.query.code.trim() : "";
  return /^\d{4,6}$/.test(c) ? c.padStart(6, "0") : "";
}

const {
  list,
  activeCode,
  active,
  select,
  addStock,
  remove,
  updateQuote,
} = useWatchlist(routeStockCode());

const { addStock: addResearch, has: hasResearch } = useResearchList();

const ctxMenu = ref<{
  x: number;
  y: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
} | null>(null);

function openStockContextMenu(
  e: MouseEvent,
  stock: { code: string; name: string; price: number; changePct: number },
) {
  e.preventDefault();
  ctxMenu.value = {
    x: e.clientX,
    y: e.clientY,
    code: stock.code,
    name: stock.name,
    price: stock.price,
    changePct: stock.changePct,
  };
}

function closeStockContextMenu() {
  ctxMenu.value = null;
}

function addToResearchFromMenu() {
  const m = ctxMenu.value;
  if (!m) return;
  if (hasResearch(m.code)) {
    closeStockContextMenu();
    void router.push({ name: "research", query: { code: m.code } });
    return;
  }
  const result = addResearch(m.code, m.name, {
    price: m.price,
    changePct: m.changePct,
  });
  hint.value = result.message;
  closeStockContextMenu();
  void router.push({ name: "research", query: { code: m.code } });
}

function openResearchOnly() {
  const m = ctxMenu.value;
  if (!m) return;
  closeStockContextMenu();
  void router.push({ name: "research", query: { code: m.code } });
}

const codeInput = ref("");
const hint = ref("");
/** 当前正在加载/等待的目标股票名称（避免标题闪旧股） */
const pendingName = ref<string | null>(null);
const period = ref<KlinePeriod>("day");
/** 分时指定交易日（YYYY-MM-DD）；空则最新交易日 */
const intradayDate = ref<string | null>(null);
const activeIndicator = ref("MACD");
const adjustMode = ref<keyof typeof ADJUST_MAP>("前复权");
/** 跳空缺口显示，默认打开（同花顺「显示缺口」） */
const showGaps = ref(localStorage.getItem("sda-show-gaps") !== "0");
const showFeatures = ref(localStorage.getItem("sda-show-features") !== "0");
/** K 线特征文字/色块提示，默认打开；关闭后只保留红绿 K + 均线 */
const showTips = ref(localStorage.getItem("sda-show-tips") !== "0");
/** 分时集合竞价，默认打开（同花顺「竞」） */
const showAuction = ref(localStorage.getItem("sda-show-auction") !== "0");
/** 分时顶部资金参考图（实时龙虎榜）；推拉进度条后出现 */
const showFundPanel = ref(false);
const rangeStart = ref(0);
const rangeEnd = ref(0);
const hoverIndex = ref<number | null>(null);
const bars = ref<KlineBar[]>([]);
const chartMode = ref<ChartMode>("candle");
const prevClose = ref<number | null>(null);
const loading = ref(false);
const loadError = ref("");
const dataSource = ref("");
const dataCount = ref(0);
const chipOpen = ref(localStorage.getItem("sda-chip-open") !== "0");
const chipWidth = ref(Number(localStorage.getItem("sda-chip-width") || 168));
const priceExtent = ref<{ min: number; max: number } | null>(null);
/** 左侧自选清单宽度，可拖拽调节 */
const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 420;
const sidebarWidth = ref(
  Math.min(
    SIDEBAR_MAX,
    Math.max(SIDEBAR_MIN, Number(localStorage.getItem("sda-sidebar-width") || 200)),
  ),
);

watch(chipOpen, (v) => localStorage.setItem("sda-chip-open", v ? "1" : "0"));
watch(chipWidth, (v) => localStorage.setItem("sda-chip-width", String(v)));
watch(showGaps, (v) => localStorage.setItem("sda-show-gaps", v ? "1" : "0"));
watch(showFeatures, (v) => localStorage.setItem("sda-show-features", v ? "1" : "0"));
watch(showTips, (v) => localStorage.setItem("sda-show-tips", v ? "1" : "0"));
watch(showAuction, (v) => localStorage.setItem("sda-show-auction", v ? "1" : "0"));
watch(sidebarWidth, (v) => localStorage.setItem("sda-sidebar-width", String(v)));

let sidebarDragging = false;
let sidebarStartX = 0;
let sidebarStartW = 0;
const sidebarResizing = ref(false);

function onSidebarResizeDown(e: MouseEvent) {
  sidebarDragging = true;
  sidebarResizing.value = true;
  sidebarStartX = e.clientX;
  sidebarStartW = sidebarWidth.value;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", onSidebarResizeMove);
  window.addEventListener("mouseup", onSidebarResizeUp);
  e.preventDefault();
}

function onSidebarResizeMove(e: MouseEvent) {
  if (!sidebarDragging) return;
  const next = Math.min(
    SIDEBAR_MAX,
    Math.max(SIDEBAR_MIN, sidebarStartW + (e.clientX - sidebarStartX)),
  );
  sidebarWidth.value = next;
}

function onSidebarResizeUp() {
  sidebarDragging = false;
  sidebarResizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("mousemove", onSidebarResizeMove);
  window.removeEventListener("mouseup", onSidebarResizeUp);
}

const suggestions = ref<StockSearchItem[]>([]);
const showSuggest = ref(false);
const suggestActive = ref(0);
const searching = ref(false);

const { maLines, volMaLines, macdParams, resetMa, resetVolMa, resetMacd } =
  useMaConfig();
const maSettingsOpen = ref(false);

function closeMaSettings() {
  maSettingsOpen.value = false;
}

function onMaSettingsKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && maSettingsOpen.value) {
    e.preventDefault();
    closeMaSettings();
  }
}

/** Backspace / Alt+←：返回上一页（游资追踪等） */
function onHistoryBackKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;
  const backspace = e.key === "Backspace" && !e.altKey && !e.ctrlKey && !e.metaKey;
  const altLeft = e.altKey && e.key === "ArrowLeft";
  if (!backspace && !altLeft) return;
  e.preventDefault();
  router.back();
}

onMounted(() => {
  window.addEventListener("keydown", onMaSettingsKeydown);
  window.addEventListener("keydown", onHistoryBackKey);
  applyRouteStock();
});

/** 龙虎榜等页面双击跳转：/kline?code=000021&name=深科技 */
async function applyRouteStock() {
  let code = typeof route.query.code === "string" ? route.query.code.trim() : "";
  let name = typeof route.query.name === "string" ? route.query.name.trim() : "";
  // 名称里可能已带代码：平煤股份（601666）
  const embedded = name.match(/（(\d{6})）|\((\d{6})\)$/);
  if (!code && embedded) {
    code = embedded[1] || embedded[2] || "";
    name = name.replace(/（\d{6}）|\(\d{6}\)$/, "").trim();
  }
  if (!code && name) {
    try {
      const hits = await searchStocks(name, 5);
      const hit =
        hits.find((h) => h.name === name) ||
        hits.find((h) => name.includes(h.name) || h.name.includes(name)) ||
        hits[0];
      if (hit) {
        code = hit.code;
        name = hit.name;
      }
    } catch {
      /* ignore */
    }
  }
  if (!code) return;
  pendingName.value = name || code || null;
  addStock(code, name || undefined);
}

watch(
  () => [route.query.code, route.query.name] as const,
  () => applyRouteStock(),
);

const visibleMaLines = computed(() =>
  maLines.value.filter((l) => l.period > 0 && (l.width ?? 1) > 0),
);
const visibleVolMaLines = computed(() =>
  volMaLines.value.filter((l) => l.period > 0 && (l.width ?? 1) > 0),
);

const engine = createKlineEngine({ theme: getAShareTheme() });

/** 标题展示：加载中优先显示目标股票，避免显示自选列表兜底股 */
const displayStock = computed(() => {
  if (pendingName.value) {
    return { code: activeCode.value, name: pendingName.value };
  }
  return active.value ?? { code: activeCode.value, name: activeCode.value };
});
const isIntraday = computed(() => period.value === "intraday");

function resetIntradayRange(n: number) {
  rangeStart.value = 0;
  rangeEnd.value = Math.max(0, n - 1);
}

const fundStats = computed(() => {
  if (!isIntraday.value || !bars.value.length) return null;
  return computeIntradayFundStats(
    bars.value,
    rangeStart.value,
    rangeEnd.value,
    prevClose.value,
  );
});

function onFundScrub() {
  showFundPanel.value = true;
}

const scrubberLabels = computed(() => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return bars.value.map((b) => {
    const d = new Date(b.timestamp);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
});

let abortCtrl: AbortController | null = null;
let searchCtrl: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
/** 防止切换股票时旧请求回写，造成「名称是 A、K 线是 B」 */
let loadSeq = 0;
/** 当前 bars 对应的股票代码（用于切股时立刻清空旧图） */
let barsCode = "";

async function loadBars() {
  const code = activeCode.value;
  const seq = ++loadSeq;
  abortCtrl?.abort();
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;
  loading.value = true;
  loadError.value = "";
  hoverIndex.value = null;
  if (code !== barsCode) {
    bars.value = [];
    prevClose.value = null;
    dataSource.value = "";
    dataCount.value = 0;
    hint.value = "加载中…";
  }

  try {
    const data = await fetchStockKline(
      code,
      period.value,
      ADJUST_MAP[adjustMode.value],
      signal,
      {
        tradeDate:
          period.value === "intraday" ? intradayDate.value : null,
      },
    );
    if (seq !== loadSeq || code !== activeCode.value || signal.aborted) return;
    // 防御：接口返回代码与请求不一致时拒绝写盘
    if (data.code && data.code !== code) {
      loadError.value = `行情串号：请求 ${code}，返回 ${data.code}`;
      hint.value = loadError.value;
      return;
    }
    barsCode = code;
    bars.value = data.bars;
    chartMode.value =
      data.chart_type ?? (period.value === "intraday" ? "intraday" : "candle");
    prevClose.value = data.prev_close;
    dataSource.value = data.source;
    dataCount.value = data.count;
    if (period.value === "intraday") {
      resetIntradayRange(data.bars.length);
      // 仅在服务端回写不同日期时更新，避免 watch(intradayDate) 重复拉取
      if (data.trade_date && data.trade_date !== intradayDate.value) {
        intradayDate.value = data.trade_date;
      }
    }
    const last = data.bars[data.bars.length - 1];
    if (last) {
      const baseline =
        chartMode.value === "intraday" && data.prev_close
          ? data.prev_close
          : (data.bars[data.bars.length - 2]?.close ?? last.open);
      const changePct =
        baseline === 0 ? 0 : ((last.close - baseline) / baseline) * 100;
      updateQuote(code, last.close, changePct, data.name);
    }
    const dayHint = data.trade_date ? ` · ${data.trade_date}` : "";
    hint.value = `${data.name ?? code} · ${data.count} 根 · ${data.source}${dayHint}`;
    pendingName.value = null;
    scheduleWatchlistPrefetch(code);
  } catch (err) {
    if ((err as Error).name === "AbortError" || seq !== loadSeq) return;
    bars.value = [];
    barsCode = "";
    chartMode.value = "candle";
    prevClose.value = null;
    dataSource.value = "";
    dataCount.value = 0;
    loadError.value = err instanceof Error ? err.message : "行情加载失败";
    hint.value = loadError.value;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function setPeriod(next: KlinePeriod) {
  if (next !== "intraday") {
    intradayDate.value = null;
  } else if (period.value !== "intraday") {
    // 点工具栏「分时」：最新交易日
    intradayDate.value = null;
  }
  period.value = next;
}

function onCandleDblClick(index: number) {
  if (period.value !== "day") return;
  // 优先用十字线位置（dataZoom filter 时 dataIndex 可能对不齐）
  const idx =
    hoverIndex.value != null && hoverIndex.value >= 0
      ? hoverIndex.value
      : index;
  const bar = bars.value[idx] ?? bars.value[index];
  if (!bar) return;
  const dateStr = shanghaiDate(bar.timestamp);
  if (!dateStr) return;
  intradayDate.value = dateStr;
  period.value = "intraday";
}

/** K 线时间戳按上海日历日格式化为 YYYY-MM-DD */
function shanghaiDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ts));
  } catch {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

watch([activeCode, period, adjustMode], loadBars, { immediate: true });

function scheduleSearch(raw: string) {
  if (searchTimer) clearTimeout(searchTimer);
  const q = raw.trim();
  if (!q) {
    suggestions.value = [];
    showSuggest.value = false;
    return;
  }
  searchTimer = setTimeout(() => void runSearch(q), 180);
}

async function runSearch(q: string) {
  searchCtrl?.abort();
  searchCtrl = new AbortController();
  searching.value = true;
  try {
    const items = await searchStocks(q, 12, searchCtrl.signal);
    suggestions.value = items;
    suggestActive.value = 0;
    showSuggest.value = items.length > 0;
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    suggestions.value = [];
    showSuggest.value = false;
  } finally {
    searching.value = false;
  }
}

watch(codeInput, (v) => scheduleSearch(v));

function selectStock(stock: { code: string; name?: string | null }) {
  pendingName.value = stock.name || stock.code || null;
  select(stock.code);
}

function pickSuggestion(item: StockSearchItem) {
  showSuggest.value = false;
  suggestions.value = [];
  codeInput.value = "";
  pendingName.value = item.name || null;
  const result = addStock(item.code, item.name);
  hint.value = result.message;
}

async function onSubmit() {
  const raw = codeInput.value.trim();
  if (!raw) {
    hint.value = "请输入代码、简称或拼音首字母，如 601666 / 平煤 / PMGF";
    return;
  }

  // 已有联想结果时，回车选中高亮项
  if (showSuggest.value && suggestions.value.length) {
    const item =
      suggestions.value[suggestActive.value] ?? suggestions.value[0];
    pickSuggestion(item);
    return;
  }

  try {
    searching.value = true;
    const items = await searchStocks(raw, 8);
    if (!items.length) {
      hint.value = `未找到「${raw}」`;
      return;
    }
    pickSuggestion(items[0]);
  } catch (err) {
    hint.value = err instanceof Error ? err.message : "搜索失败";
  } finally {
    searching.value = false;
  }
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!showSuggest.value || !suggestions.value.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    suggestActive.value = (suggestActive.value + 1) % suggestions.value.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    suggestActive.value =
      (suggestActive.value - 1 + suggestions.value.length) %
      suggestions.value.length;
  } else if (e.key === "Escape") {
    showSuggest.value = false;
  }
}

function onSearchBlur() {
  window.setTimeout(() => {
    showSuggest.value = false;
  }, 150);
}

let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
let prefetchAbort: AbortController | null = null;

/** 加载完成后，后台预热自选里其他股票的日 K 缓存（服务端 CSV + 前端内存），切换时秒开 */
function scheduleWatchlistPrefetch(currentCode: string) {
  if (prefetchTimer) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    prefetchTimer = null;
    void prefetchWatchlist(currentCode);
  }, 1200);
}

async function prefetchWatchlist(currentCode: string) {
  prefetchAbort?.abort();
  prefetchAbort = new AbortController();
  const targets = list.value.filter((s) => s.code !== currentCode).slice(0, 3);
  for (const s of targets) {
    if (prefetchAbort.signal.aborted) return;
    try {
      await fetchStockKline(s.code, "day", "qfq", prefetchAbort.signal);
    } catch {
      /* 预热失败静默，不影响主流程 */
    }
  }
}

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onMaSettingsKeydown);
  window.removeEventListener("keydown", onHistoryBackKey);
  abortCtrl?.abort();
  searchCtrl?.abort();
  prefetchAbort?.abort();
  if (prefetchTimer) clearTimeout(prefetchTimer);
  if (searchTimer) clearTimeout(searchTimer);
  onSidebarResizeUp();
});

const quoteParams = computed(() => ({
  mode: chartMode.value,
  prevClose: prevClose.value,
  maLines: maLines.value,
  volMaLines: volMaLines.value,
}));

const quote = computed<KlineQuoteSnapshot | null>(() => {
  if (!bars.value.length) return null;
  const idx =
    hoverIndex.value != null && hoverIndex.value >= 0
      ? hoverIndex.value
      : bars.value.length - 1;
  return engine.getQuoteSnapshot(bars.value, idx, quoteParams.value);
});

const headerChange = computed(() => {
  if (!bars.value.length) return { price: 0, change: 0, pct: 0, up: true };
  const last = bars.value[bars.value.length - 1];
  const baseline =
    chartMode.value === "intraday" && prevClose.value
      ? prevClose.value
      : (bars.value[bars.value.length - 2]?.close ?? last.open);
  const change = last.close - baseline;
  const pct = baseline === 0 ? 0 : (change / baseline) * 100;
  return { price: last.close, change, pct, up: change >= 0 };
});

const quoteUp = computed(() => (quote.value?.change ?? 0) >= 0);

function signed(n: number, digits = 2): string {
  const abs = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${abs}` : n < 0 ? `-${abs}` : abs;
}

function formatVolMa(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toFixed(0);
}

function priceColor(up: boolean): string {
  return up ? "var(--color-up)" : "var(--color-down)";
}
</script>

<template>
  <div class="ths-window">
    <!-- 顶部：代码 / 名称 / 拼音首字母搜索 -->
    <form class="ths-search" @submit.prevent="onSubmit">
      <div class="ths-search-wrap">
        <div class="ths-search-field">
          <span class="ths-search-label">代码</span>
          <input
            v-model="codeInput"
            class="ths-search-input"
            type="text"
            maxlength="16"
            placeholder="代码 / 简称 / 拼音首字母，如 601666、平煤、PMGF"
            autocomplete="off"
            @keydown="onSearchKeydown"
            @focus="showSuggest = suggestions.length > 0"
            @blur="onSearchBlur"
          />
        </div>
        <ul v-if="showSuggest && suggestions.length" class="ths-suggest">
          <li
            v-for="(item, idx) in suggestions"
            :key="item.code"
            class="ths-suggest-item"
            :class="{ 'ths-suggest-active': idx === suggestActive }"
            @mousedown.prevent="pickSuggestion(item)"
          >
            <span class="ths-suggest-name">{{ item.name }}</span>
            <span class="ths-suggest-code">{{
              item.market ? `${item.market}:${item.code}` : item.code
            }}</span>
            <span class="ths-suggest-py">{{ item.initials }}</span>
          </li>
        </ul>
      </div>
      <button type="submit" class="ths-search-btn" :disabled="loading || searching">
        {{ loading || searching ? "加载中" : "查询" }}
      </button>
      <span v-if="hint" class="ths-search-hint">{{ hint }}</span>
      <span v-if="dataSource" class="ths-source-pill">{{ dataSource }} · {{ dataCount }}</span>
    </form>

    <div class="ths-body">
      <!-- 左侧：自选清单 -->
      <aside class="ths-sidebar" :style="{ width: `${sidebarWidth}px` }">
        <div class="ths-sidebar-head">
          <span>自选清单</span>
          <span class="ths-sidebar-count">{{ list.length }}</span>
        </div>
        <ul class="ths-stock-list">
          <li
            v-for="stock in list"
            :key="stock.code"
            class="ths-stock-item"
            :class="{ 'ths-stock-item-active': stock.code === activeCode }"
            @click="selectStock(stock)"
            @contextmenu="openStockContextMenu($event, stock)"
          >
            <div class="ths-stock-main">
              <span class="ths-stock-name">{{ stock.name }}</span>
              <span class="ths-stock-code">{{ stock.code }}</span>
            </div>
            <div class="ths-stock-quote">
              <span
                class="ths-stock-price"
                :style="{ color: priceColor(stock.changePct >= 0) }"
              >
                {{ stock.price ? roundPrice(stock.price, stock.price >= 100 ? 2 : 3) : "—" }}
              </span>
              <span
                class="ths-stock-pct"
                :style="{ color: priceColor(stock.changePct >= 0) }"
              >
                {{ signed(stock.changePct) }}%
              </span>
            </div>
            <button
              type="button"
              class="ths-stock-remove"
              title="移除"
              @click.stop="remove(stock.code)"
            >
              ×
            </button>
          </li>
        </ul>
      </aside>

      <div
        class="ths-split"
        :class="{ 'ths-split-active': sidebarResizing }"
        title="拖拽调节左右宽度"
        @mousedown="onSidebarResizeDown"
      />

      <!-- 右侧：同花顺风格主窗口 -->
      <section class="ths-panel">
        <header class="ths-header">
          <div class="ths-identity">
            <div class="ths-name-row">
              <h2 class="ths-name">{{ displayStock.name }}</h2>
              <span class="ths-code">{{ displayStock.code }}</span>
            </div>
            <div class="ths-price-block">
              <span
                class="ths-last"
                :style="{ color: priceColor(headerChange.up) }"
              >
                {{ roundPrice(headerChange.price, headerChange.price >= 100 ? 2 : 3) }}
              </span>
              <div
                class="ths-change"
                :style="{ color: priceColor(headerChange.up) }"
              >
                <span>{{
                  signed(headerChange.change, headerChange.price >= 100 ? 2 : 3)
                }}</span>
                <span>{{ signed(headerChange.pct) }}%</span>
              </div>
            </div>
          </div>

          <div class="ths-period-row">
            <button
              v-for="p in PERIODS"
              :key="p.id"
              type="button"
              class="ths-period"
              :class="{ 'ths-period-active': period === p.id }"
              @click="setPeriod(p.id)"
            >
              {{ p.label }}
            </button>
            <select v-model="adjustMode" class="ths-adjust">
              <option>前复权</option>
              <option>后复权</option>
              <option>不复权</option>
            </select>
            <button
              v-if="!isIntraday"
              type="button"
              class="ths-gap-btn"
              :class="{ 'ths-gap-btn-on': maSettingsOpen }"
              title="均线设置（主图/量能）"
              @click="maSettingsOpen = !maSettingsOpen"
            >
              均线
            </button>
            <button
              v-if="!isIntraday"
              type="button"
              class="ths-gap-btn"
              :class="{ 'ths-gap-btn-on': showFeatures }"
              title="涨停/破板/倍量/壹泽洗盘/一阳穿线/多空排列"
              @click="showFeatures = !showFeatures"
            >
              特征
            </button>
            <button
              v-if="!isIntraday"
              type="button"
              class="ths-gap-btn"
              :class="{ 'ths-gap-btn-on': showGaps }"
              title="显示跳空缺口"
              @click="showGaps = !showGaps"
            >
              缺口
            </button>
            <button
              v-if="!isIntraday"
              type="button"
              class="ths-gap-btn"
              :class="{ 'ths-gap-btn-on': showTips }"
              title="日K：涨停/破板等；各周期：岛型反转/壹泽洗（关闭后仅红绿K与均线）"
              @click="showTips = !showTips"
            >
              提示
            </button>
            <button
              v-if="isIntraday"
              type="button"
              class="ths-gap-btn"
              :class="{ 'ths-gap-btn-on': showAuction }"
              title="显示集合竞价（09:15–09:25）"
              @click="showAuction = !showAuction"
            >
              竞
            </button>
            <button
              v-if="isIntraday"
              type="button"
              class="ths-gap-btn"
              :class="{ 'ths-gap-btn-on': showFundPanel }"
              title="分时资金参考图（推拉底部进度条动态更新）"
              @click="showFundPanel = !showFundPanel"
            >
              资金
            </button>
          </div>
        </header>

        <!-- OHLC + MA 图例（远航版：一行密集） -->
        <div v-if="quote" class="ths-legend">
          <div class="ths-ohlc">
            <span class="ths-ohlc-date">{{ quote.date }}</span>
            <span>
              开:<em>{{ roundPrice(quote.open) }}</em>
            </span>
            <span>
              高:<em style="color: var(--color-up)">{{
                roundPrice(quote.high)
              }}</em>
            </span>
            <span>
              低:<em style="color: var(--color-down)">{{
                roundPrice(quote.low)
              }}</em>
            </span>
            <span>
              收:<em :style="{ color: priceColor(quoteUp) }">{{
                roundPrice(quote.close)
              }}</em>
            </span>
            <span>
              涨跌:<em :style="{ color: priceColor(quoteUp) }">{{
                signed(quote.change)
              }}</em>
            </span>
            <span>
              涨幅:<em :style="{ color: priceColor(quoteUp) }"
                >{{ signed(quote.changePct) }}%</em
              >
            </span>
            <template v-if="isIntraday">
              <span class="ths-sep">|</span>
              <span class="ths-ma" style="color: var(--color-accent)">
                分时:{{ roundPrice(quote.close) }}
              </span>
              <span class="ths-ma" style="color: #e6a23c">
                均价:{{ quote.avg != null ? roundPrice(quote.avg) : "—" }}
              </span>
              <span class="ths-ma" style="color: var(--color-text-muted)">
                昨收:{{ prevClose != null ? roundPrice(prevClose) : "—" }}
              </span>
            </template>
            <template v-else>
              <span class="ths-sep">|</span>
              <span
                v-for="line in visibleMaLines"
                :key="line.name ?? line.period"
                class="ths-ma"
                :style="{ color: line.color }"
              >
                {{ line.name ?? `MA${line.period}` }}:{{
                  quote.ma[line.name ?? `MA${line.period}`] != null
                    ? roundPrice(quote.ma[line.name ?? `MA${line.period}`] as number)
                    : "—"
                }}
              </span>
            </template>
          </div>
        </div>

        <!-- 均线设置：浮动窗口 -->
        <Teleport to="body">
          <div
            v-if="maSettingsOpen && !isIntraday"
            class="ths-ma-float-mask"
            @click.self="closeMaSettings"
          >
            <div
              class="ths-ma-float"
              role="dialog"
              aria-modal="true"
              aria-label="均线设置"
              @click.stop
            >
              <header class="ths-ma-float-hd">
                <strong>均线设置</strong>
                <button
                  type="button"
                  class="ths-ma-float-close"
                  title="关闭"
                  @click="closeMaSettings"
                >
                  ×
                </button>
              </header>
              <div class="ths-ma-settings">
                <div class="ths-ma-settings-col">
                  <div class="ths-ma-settings-title">
                    <span>主图均线（12）</span>
                    <button type="button" class="ths-ma-reset" @click="resetMa">
                      恢复默认
                    </button>
                  </div>
                  <div
                    v-for="(line, idx) in maLines"
                    :key="`ma-${idx}`"
                    class="ths-ma-row"
                  >
                    <span class="ths-ma-idx">{{ idx + 1 }}</span>
                    <label>
                      周期
                      <input
                        v-model.number="line.period"
                        type="number"
                        min="0"
                        max="9999"
                        @change="line.name = `MA${line.period}`"
                      />
                    </label>
                    <label>
                      宽
                      <input
                        v-model.number="line.width"
                        type="number"
                        min="0"
                        max="8"
                        step="0.5"
                      />
                    </label>
                    <input
                      v-model="line.color"
                      type="color"
                      class="ths-ma-color"
                      title="颜色"
                    />
                    <span class="ths-ma-hint" :style="{ color: line.color }">{{
                      (line.width ?? 1) <= 0
                        ? "隐"
                        : line.name || `MA${line.period}`
                    }}</span>
                  </div>
                </div>
                <div class="ths-ma-settings-col">
                  <div class="ths-ma-settings-title">
                    <span>量能均线</span>
                    <button type="button" class="ths-ma-reset" @click="resetVolMa">
                      恢复默认
                    </button>
                  </div>
                  <div
                    v-for="(line, idx) in volMaLines"
                    :key="`vma-${idx}`"
                    class="ths-ma-row"
                  >
                    <span class="ths-ma-idx">V{{ idx + 1 }}</span>
                    <label>
                      周期
                      <input
                        v-model.number="line.period"
                        type="number"
                        min="0"
                        max="9999"
                        @change="line.name = `MA${line.period}`"
                      />
                    </label>
                    <label>
                      宽
                      <input
                        v-model.number="line.width"
                        type="number"
                        min="0"
                        max="8"
                        step="0.5"
                      />
                    </label>
                    <input
                      v-model="line.color"
                      type="color"
                      class="ths-ma-color"
                      title="颜色"
                    />
                    <span class="ths-ma-hint" :style="{ color: line.color }">{{
                      (line.width ?? 1) <= 0
                        ? "隐"
                        : line.name || `MA${line.period}`
                    }}</span>
                  </div>
                  <p class="ths-ma-tip">
                    线宽=0 表示不可见；量柱红绿仍按涨跌默认。
                  </p>
                  <div class="ths-ma-settings-title" style="margin-top: 14px">
                    <span>MACD 线</span>
                    <button type="button" class="ths-ma-reset" @click="resetMacd">
                      恢复默认
                    </button>
                  </div>
                  <div class="ths-ma-row">
                    <span class="ths-ma-idx">S</span>
                    <label>
                      SHORT
                      <input
                        v-model.number="macdParams.short"
                        type="number"
                        min="2"
                        max="200"
                      />
                    </label>
                  </div>
                  <div class="ths-ma-row">
                    <span class="ths-ma-idx">L</span>
                    <label>
                      LONG
                      <input
                        v-model.number="macdParams.long"
                        type="number"
                        min="3"
                        max="300"
                      />
                    </label>
                  </div>
                  <div class="ths-ma-row">
                    <span class="ths-ma-idx">M</span>
                    <label>
                      MM
                      <input
                        v-model.number="macdParams.mm"
                        type="number"
                        min="2"
                        max="100"
                      />
                    </label>
                  </div>
                  <p class="ths-ma-tip">
                    DIF=EMA(C,S)-EMA(C,L)；DEA=EMA(DIF,MM)；MACD=(DIF-DEA)×2。默认
                    12 / 26 / 9。柱：红+/青-；获利盘&gt;82% 洋红。
                  </p>
                </div>
              </div>
              <footer class="ths-ma-float-ft">
                <button type="button" class="ths-ma-float-ok" @click="closeMaSettings">
                  完成
                </button>
              </footer>
            </div>
          </div>
        </Teleport>

        <!-- 量 / MACD 小图例 -->
        <div v-if="quote" class="ths-sub-legends">
          <span class="ths-vol-legend">
            VOLUME:
            <em :style="{ color: priceColor(quoteUp) }">{{ quote.volumeLabel }}</em>
            <template v-if="!isIntraday">
              <span
                v-for="line in visibleVolMaLines"
                :key="line.name ?? line.period"
                class="ths-ma"
                :style="{ color: line.color, marginLeft: '8px' }"
              >
                {{ line.name ?? `MA${line.period}` }}:{{
                  quote.volMa?.[line.name ?? `MA${line.period}`] != null
                    ? formatVolMa(quote.volMa[line.name ?? `MA${line.period}`] as number)
                    : "—"
                }}
              </span>
            </template>
          </span>
          <span v-if="!isIntraday" class="ths-macd-legend">
            <em style="color: var(--color-accent)">MACD</em>
            :
            <em
              :style="{
                color:
                  quote.macd.macd >= 0 ? 'var(--color-up)' : '#00c2d4',
              }"
              >{{ roundPrice(quote.macd.macd, 3) }}</em
            >
            DIF:
            <em style="color: #e6a23c">{{ roundPrice(quote.macd.dif, 3) }}</em>
            DEA:
            <em style="color: #9ca3af">{{ roundPrice(quote.macd.dea, 3) }}</em>
          </span>
        </div>

        <IntradayFundPanel
          v-if="isIntraday && showFundPanel && !loading && !loadError"
          :stats="fundStats"
        />

        <div class="ths-chart-wrap">
          <!-- 浮动半透明关闭：K 线区右侧 -->
          <button
            v-if="isIntraday && showFundPanel && !loading && !loadError"
            type="button"
            class="ths-fund-close"
            title="关闭资金图"
            aria-label="关闭资金图"
            @click="showFundPanel = false"
          >
            ×
          </button>
          <div v-if="loading" class="ths-chart-state">正在加载 {{ displayStock.name }}…</div>
          <div v-else-if="loadError" class="ths-chart-state ths-chart-error">
            {{ loadError }}
            <button type="button" class="ths-retry" @click="loadBars">重试</button>
          </div>
          <div v-else class="ths-chart-row">
            <div class="ths-chart-main">
              <KlineChart
                :bars="bars"
                :mode="chartMode"
                :prev-close="prevClose"
                :show-gaps="showGaps"
                :show-auction="showAuction"
                :show-features="showTips && showFeatures"
                :kline-period="period"
                :stock-code="activeCode"
                :stock-name="active?.name"
                :ma-lines="maLines"
                :vol-ma-lines="volMaLines"
                :macd-short="macdParams.short"
                :macd-long="macdParams.long"
                :macd-mm="macdParams.mm"
                :range-start="isIntraday && showFundPanel ? rangeStart : null"
                :range-end="isIntraday && showFundPanel ? rangeEnd : null"
                @update:hover-index="hoverIndex = $event"
                @update:price-extent="priceExtent = $event"
                @dblclick-bar="onCandleDblClick"
              />
              <IntradayRangeScrubber
                v-if="isIntraday && bars.length"
                v-model:start="rangeStart"
                v-model:end="rangeEnd"
                :length="bars.length"
                :labels="scrubberLabels"
                @scrub="onFundScrub"
              />
            </div>
            <ChipDistribution
              v-if="!isIntraday"
              :bars="bars"
              :as-of-index="hoverIndex"
              :price-min="priceExtent?.min"
              :price-max="priceExtent?.max"
              v-model:open="chipOpen"
              v-model:width="chipWidth"
            />
          </div>
        </div>

        <div v-if="!isIntraday" class="ths-indicator-bar">
          <button
            v-for="name in INDICATORS"
            :key="name"
            type="button"
            class="ths-ind"
            :class="{ 'ths-ind-active': activeIndicator === name }"
            @click="activeIndicator = name"
          >
            {{ name }}
          </button>
        </div>

        <footer class="ths-actions">
          <button type="button" class="ths-action" @click="onSubmit">
            + 加自选
          </button>
          <button type="button" class="ths-action">+ 加板块</button>
          <button type="button" class="ths-action">个股资讯</button>
          <button type="button" class="ths-action">个股资料</button>
        </footer>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="ths-ctx-backdrop"
        @click="closeStockContextMenu"
        @contextmenu.prevent="closeStockContextMenu"
      >
        <div
          class="ths-ctx-menu"
          :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
          @click.stop
        >
          <div class="ths-ctx-title">{{ ctxMenu.name }} {{ ctxMenu.code }}</div>
          <button type="button" class="ths-ctx-item" @click="addToResearchFromMenu">
            {{ hasResearch(ctxMenu.code) ? "打开重点研究" : "加入重点研究" }}
          </button>
          <button
            v-if="hasResearch(ctxMenu.code)"
            type="button"
            class="ths-ctx-item"
            @click="openResearchOnly"
          >
            仅跳转重点研究
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ths-window {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 9.5rem);
  min-height: 640px;
  border-radius: 14px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  box-shadow:
    0 1px 2px rgb(15 23 42 / 4%),
    0 12px 32px rgb(15 23 42 / 6%);
  overflow: hidden;
}

.ths-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-bg) 55%, transparent),
    transparent
  );
}

.ths-search-wrap {
  position: relative;
  flex: 1;
  max-width: 420px;
}

.ths-search-field {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.ths-search-field:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 18%, transparent);
}

.ths-suggest {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 30;
  margin: 0;
  padding: 6px;
  list-style: none;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  box-shadow: 0 10px 28px rgb(15 23 42 / 12%);
  max-height: 280px;
  overflow-y: auto;
}

.ths-suggest-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.ths-suggest-item:hover,
.ths-suggest-active {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}

.ths-suggest-name {
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ths-suggest-code {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.ths-suggest-py {
  color: var(--color-accent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  min-width: 2.5rem;
  text-align: right;
}

.ths-search-label {
  margin-right: 10px;
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.ths-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--color-text);
  letter-spacing: 0.04em;
}

.ths-search-input::placeholder {
  color: var(--color-text-muted);
  letter-spacing: 0;
}

.ths-search-btn {
  height: 36px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: var(--color-accent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.ths-search-btn:hover {
  background: var(--color-accent-hover);
}

.ths-search-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}

.ths-source-pill {
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ths-search-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}

.ths-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.ths-sidebar {
  width: 200px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  border-right: 0;
  background: var(--color-bg-sidebar);
  min-width: 0;
}

/* 分栏：默认细线；悬停超细；按住微加粗；颜色跟主题 --color-accent */
.ths-split {
  flex: 0 0 8px;
  width: 8px;
  margin: 0 -3px;
  cursor: col-resize;
  position: relative;
  z-index: 3;
  background: transparent;
}

.ths-split::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: color-mix(in srgb, var(--color-accent) 45%, transparent);
  border-radius: 1px;
  pointer-events: none;
  transition:
    width 0.12s ease,
    background 0.12s ease,
    opacity 0.12s ease;
}

.ths-split:hover::before {
  width: 1px;
  background: var(--color-accent);
}

.ths-split-active::before {
  width: 3px;
  background: var(--color-accent);
}

.ths-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  letter-spacing: 0.02em;
}

.ths-sidebar-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: var(--color-accent);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.ths-stock-list {
  list-style: none;
  margin: 0;
  padding: 4px 8px 12px;
  overflow-y: auto;
  flex: 1;
  /* 细滚动条（Firefox） */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-text-muted) 45%, transparent)
    transparent;
}

/* 细滚动条（Chromium / WebKit） */
.ths-stock-list::-webkit-scrollbar {
  width: 5px;
}

.ths-stock-list::-webkit-scrollbar-track {
  background: transparent;
}

.ths-stock-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-text-muted) 40%, transparent);
  border-radius: 3px;
}

.ths-stock-list::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-text-muted) 65%, transparent);
}

.ths-stock-list::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}

.ths-stock-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 12px;
  margin-bottom: 2px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.ths-stock-item:hover {
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
}

.ths-stock-item-active {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  box-shadow: inset 2px 0 0 var(--color-accent);
}

.ths-stock-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.ths-stock-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ths-stock-code {
  font-size: 11px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.ths-stock-quote {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.ths-stock-price {
  font-size: 12px;
  font-weight: 600;
}

.ths-stock-pct {
  font-size: 11px;
}

.ths-stock-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.ths-stock-item:hover .ths-stock-remove {
  opacity: 1;
}

.ths-stock-remove:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.ths-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 10px;
  background: var(--color-bg-elevated);
}

.ths-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.ths-identity {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}

.ths-name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ths-name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-text);
  line-height: 1.15;
}

.ths-code {
  font-size: 13px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.ths-price-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-variant-numeric: tabular-nums;
}

.ths-last {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.05;
}

.ths-change {
  display: flex;
  gap: 10px;
  font-size: 13px;
  font-weight: 500;
}

.ths-period-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-top: 2px;
}

.ths-period {
  border: 0;
  background: transparent;
  padding: 5px 9px;
  font-size: 13px;
  color: var(--color-text-muted);
  cursor: pointer;
  position: relative;
  border-radius: 0;
  transition: color 0.12s ease;
}

.ths-period:hover {
  color: var(--color-text);
}

.ths-period-active {
  color: var(--color-accent);
  font-weight: 600;
}

.ths-period-active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 1px;
  height: 2px;
  background: var(--color-accent);
}

.ths-adjust {
  margin-left: 6px;
  height: 26px;
  padding: 0 6px;
  border-radius: 2px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.ths-gap-btn {
  margin-left: 4px;
  height: 26px;
  padding: 0 10px;
  border-radius: 2px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
}

.ths-gap-btn-on {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  font-weight: 600;
}

.ths-legend {
  margin-bottom: 2px;
}

.ths-ohlc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.45;
}

.ths-ohlc em {
  font-style: normal;
  font-weight: 600;
  margin-left: 1px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.ths-ohlc-date {
  font-weight: 600;
  color: var(--color-text);
  margin-right: 2px;
}

.ths-sep {
  color: var(--color-border);
  margin: 0 2px;
}

.ths-ma {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.ths-sub-legends {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding-right: 48px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.ths-sub-legends em {
  font-style: normal;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ths-ma-float-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(2px);
}

.ths-ma-float {
  width: min(720px, 96vw);
  max-height: min(78vh, 640px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-elevated);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.ths-ma-float-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
}

.ths-ma-float-hd strong {
  font-size: 14px;
  font-weight: 650;
}

.ths-ma-float-close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.ths-ma-float-close:hover {
  background: color-mix(in srgb, var(--color-border) 55%, transparent);
  color: var(--color-text);
}

.ths-ma-settings {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
  margin: 0;
  padding: 12px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  max-height: none;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.ths-ma-float-ft {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--color-border);
}

.ths-ma-float-ok {
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: var(--color-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ths-ma-float-ok:hover {
  filter: brightness(1.05);
}

.ths-ma-settings-col {
  min-width: 0;
}

.ths-ma-settings-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.ths-ma-reset {
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font-size: 11px;
  cursor: pointer;
}

.ths-ma-row {
  display: grid;
  grid-template-columns: 28px 1fr 1fr 28px minmax(48px, auto);
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.ths-ma-row label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ths-ma-row input[type="number"] {
  width: 100%;
  min-width: 0;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: 11px;
}

.ths-ma-color {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.ths-ma-idx {
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.ths-ma-hint {
  font-size: 10px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ths-ma-tip {
  margin: 8px 0 0;
  font-size: 10px;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.ths-chart-wrap {
  flex: 1;
  min-height: 420px;
  margin-top: 2px;
  position: relative;
}

/* 资金图关闭：浮在分时图右侧，半透明 */
.ths-fund-close {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 20;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgb(80 80 80 / 38%);
  color: rgb(255 255 255 / 92%);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
  backdrop-filter: blur(4px);
  box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
  transition: background 0.15s ease, transform 0.15s ease;
}

.ths-fund-close:hover {
  background: rgb(80 80 80 / 58%);
  transform: scale(1.05);
}

.ths-chart-row {
  display: flex;
  align-items: stretch;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  width: 100%;
}

.ths-chart-main {
  flex: 1 1 auto;
  min-width: 0;
  width: 0; /* 配合 flex:1，强制把剩余宽度让给图表，避免画布撑破 */
  height: 100%;
  /* 避免裁掉 dataZoom 两侧拖动头 */
  overflow: visible;
  position: relative;
  display: flex;
  flex-direction: column;
}

.ths-chart-main :deep(.ths-chart-canvas) {
  flex: 1 1 auto;
  min-height: 0;
  height: auto !important;
}

.ths-chart-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  min-height: 420px;
  color: var(--color-text-muted);
  font-size: 14px;
}

.ths-chart-error {
  color: var(--color-up);
}

.ths-retry {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.ths-retry:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.ths-indicator-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 6px 0 4px;
  border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
}

.ths-ind {
  border: 0;
  background: transparent;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 6px;
}

.ths-ind:hover {
  color: var(--color-text);
  background: var(--color-bg);
}

.ths-ind-active {
  color: var(--color-accent);
  font-weight: 600;
}

.ths-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding-top: 8px;
}

.ths-action {
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}

.ths-action:hover {
  background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg));
  border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
}

@media (max-width: 960px) {
  .ths-window {
    height: auto;
    min-height: 0;
  }

  .ths-body {
    flex-direction: column;
  }

  .ths-sidebar {
    width: 100% !important;
    max-height: 160px;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .ths-split {
    display: none;
  }

  .ths-stock-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 10px;
  }

  .ths-stock-item {
    min-width: 140px;
    flex-shrink: 0;
  }

  .ths-header {
    flex-direction: column;
  }

  .ths-actions {
    grid-template-columns: repeat(2, 1fr);
  }
}

.ths-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
}

.ths-ctx-menu {
  position: fixed;
  min-width: 168px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 16%, transparent);
  z-index: 81;
}

.ths-ctx-title {
  padding: 6px 10px 8px;
  font-size: 11px;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 4px;
}

.ths-ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.ths-ctx-item:hover {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: var(--color-accent);
}
</style>
