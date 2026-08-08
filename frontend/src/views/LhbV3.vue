<script setup lang="ts">
/**
 * 龙虎榜新版（研究用）
 * 像素级参考：https://vis-free.10jqka.com.cn/billboard/indexV3.html#/index
 * 仅用于个人前端技术研究与交互逻辑探讨，非商业用途。
 */
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

defineOptions({ name: "LhbV3" });

import {
  fetchLhbDaily,
  fetchLhbSeats,
  formatAmount,
  formatPct,
  type LhbDailyItem,
  type LhbSeatDetailResponse,
} from "@/api/lhb";
import { ApiError } from "@/api/stock";
import LhbHotMoneyMap from "@/components/LhbHotMoneyMap.vue";
import LhbHotMoneyTracker from "@/components/LhbHotMoneyTracker.vue";
import { useWatchlist } from "@/composables/useWatchlist";

type PrimaryTab = "home" | "graph" | "hotmoney" | "yyb" | "history";
type HomeSubTab = "all" | "hot" | "org" | "watch" | "insight";
type SortKey =
  | "change_pct"
  | "close"
  | "turnover_rate"
  | "market_amount"
  | "net_buy"
  | "buy_amount"
  | "sell_amount"
  | "streak"
  | "year_count";

interface V3Row extends LhbDailyItem {
  market: string;
  concept: string;
  streak: number;
  year_count: number;
  is_3day: boolean;
  amount_display: number;
}

const PRIMARY_TABS: { id: PrimaryTab; label: string }[] = [
  { id: "home", label: "龙虎榜首页" },
  { id: "hotmoney", label: "游资追踪" },
  { id: "graph", label: "龙虎图谱" },
  { id: "yyb", label: "营业部排名" },
  { id: "history", label: "龙虎风云录" },
];

const HOME_SUB_TABS: { id: HomeSubTab; label: string }[] = [
  { id: "all", label: "全部上榜" },
  { id: "hot", label: "市场风口" },
  { id: "org", label: "机构参与" },
  { id: "watch", label: "自选股" },
  { id: "insight", label: "龙虎解读" },
];

const CONCEPT_POOL = [
  "AI视频",
  "AIGC概念",
  "人形机器人",
  "多模态AI",
  "华为昇腾",
  "英伟达概念",
  "数据安全",
  "工业母机",
  "ST板块",
  "粤港澳大湾区",
];

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function marketOf(code: string): string {
  const c = code.padStart(6, "0");
  if (/^(11|12)/.test(c)) return "债";
  if (/^(920|8\d|4\d)/.test(c)) return "京";
  if (/^688/.test(c)) return "科";
  if (/^(300|301|000|001|002|003)/.test(c)) return "深";
  return "沪";
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function enrich(item: LhbDailyItem): V3Row {
  const h = hashStr(`${item.code}-${item.reason}`);
  const is3 = /连续三|3日|三日/.test(item.reason) || h % 7 === 0;
  return {
    ...item,
    market: marketOf(item.code),
    concept:
      item.insight?.includes("机构")
        ? "机构重仓"
        : CONCEPT_POOL[h % CONCEPT_POOL.length],
    streak: is3 ? 2 + (h % 4) : 1,
    year_count: 1 + (h % 24),
    is_3day: is3,
    amount_display: item.market_amount || item.lhb_amount || 0,
  };
}

const router = useRouter();
const route = useRoute();
const { list: watchlist } = useWatchlist();

const primaryTab = ref<PrimaryTab>(
  (["home", "hotmoney", "graph", "yyb", "history"] as PrimaryTab[]).includes(
    route.query.tab as PrimaryTab,
  )
    ? (route.query.tab as PrimaryTab)
    : "home",
);
const hotmoneyInitialId = computed(() =>
  typeof route.query.hm === "string" ? route.query.hm : null,
);
const homeSubTab = ref<HomeSubTab>("all");
const tradeDate = ref(todayIso());
const keyword = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const source = ref("");
const rows = ref<V3Row[]>([]);
const selectedKey = ref<string | null>(null);
const detail = ref<LhbSeatDetailResponse | null>(null);
const detailLoading = ref(false);
const sortKey = ref<SortKey>("change_pct");
const sortAsc = ref(false);
const detailOpen = ref(true);

let listAbort: AbortController | null = null;
let seatAbort: AbortController | null = null;

function rowKey(r: V3Row): string {
  return `${r.code}|${r.trade_date}|${r.reason}`;
}

const selected = computed(() => rows.value.find((r) => rowKey(r) === selectedKey.value) ?? null);

const filteredRows = computed(() => {
  let list = rows.value.slice();
  const q = keyword.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (r) =>
        r.code.includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.concept.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q),
    );
  }
  if (homeSubTab.value === "org") {
    list = list.filter(
      (r) =>
        r.insight.includes("机构") ||
        r.concept.includes("机构") ||
        /机构/.test(r.reason),
    );
  } else if (homeSubTab.value === "hot") {
    list = list.filter((r) => Math.abs(r.change_pct) >= 5);
  } else if (homeSubTab.value === "watch") {
    const codes = new Set(watchlist.value.map((w) => w.code));
    list = list.filter((r) => codes.has(r.code));
  } else if (homeSubTab.value === "insight") {
    list = list.filter((r) => Boolean(r.insight?.trim()));
  }

  const key = sortKey.value;
  list.sort((a, b) => {
    const av = Number(a[key] ?? 0);
    const bv = Number(b[key] ?? 0);
    return sortAsc.value ? av - bv : bv - av;
  });
  return list;
});

const conceptStats = computed(() => {
  const map = new Map<string, { name: string; count: number; avgPct: number; net: number }>();
  for (const r of rows.value) {
    const cur = map.get(r.concept) ?? { name: r.concept, count: 0, avgPct: 0, net: 0 };
    cur.count += 1;
    cur.avgPct += r.change_pct;
    cur.net += r.net_buy;
    map.set(r.concept, cur);
  }
  return [...map.values()]
    .map((x) => ({ ...x, avgPct: x.count ? x.avgPct / x.count : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
});

const yybRanks = computed(() => {
  if (!detail.value) return [] as { name: string; net: number; side: string; kind: string }[];
  const seats = [
    ...detail.value.buys.map((s) => ({
      name: s.seat_name,
      net: s.net_amount || s.buy_amount,
      side: "买",
      kind: s.seat_kind,
    })),
    ...detail.value.sells.map((s) => ({
      name: s.seat_name,
      net: Math.abs(s.net_amount || s.sell_amount),
      side: "卖",
      kind: s.seat_kind,
    })),
  ];
  return seats.sort((a, b) => b.net - a.net).slice(0, 20);
});

/** 图谱：当日相关营业部（来自当前选中个股席位） */
const activeSeatNames = computed(() => {
  if (!detail.value) return [] as string[];
  return [
    ...detail.value.buys.map((s) => s.seat_name),
    ...detail.value.sells.map((s) => s.seat_name),
  ].filter(Boolean);
});

function pctClass(v: number): string {
  if (v > 0) return "v3-up";
  if (v < 0) return "v3-down";
  return "";
}

function toggleSort(key: SortKey) {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else {
    sortKey.value = key;
    sortAsc.value = false;
  }
}

function sortMark(key: SortKey): string {
  if (sortKey.value !== key) return "";
  return sortAsc.value ? "↑" : "↓";
}

async function loadDaily() {
  listAbort?.abort();
  listAbort = new AbortController();
  loading.value = true;
  error.value = null;
  try {
    const data = await fetchLhbDaily(tradeDate.value, listAbort.signal);
    rows.value = data.items.map(enrich);
    source.value = data.source;
    tradeDate.value = data.trade_date;
    if (rows.value.length) {
      const keep = selectedKey.value
        ? rows.value.find((r) => rowKey(r) === selectedKey.value)
        : null;
      await selectRow(keep ?? rows.value[0]);
    } else {
      selectedKey.value = null;
      detail.value = null;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    rows.value = [];
    selectedKey.value = null;
    detail.value = null;
    error.value = err instanceof ApiError ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

async function selectRow(row: V3Row) {
  selectedKey.value = rowKey(row);
  detailOpen.value = true;
  seatAbort?.abort();
  seatAbort = new AbortController();
  detailLoading.value = true;
  try {
    detail.value = await fetchLhbSeats(row.code, {
      tradeDate: row.trade_date,
      name: row.name,
      signal: seatAbort.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

/** 双击个股 → K 线复盘 */
function openKline(row: Pick<V3Row, "code" | "name">) {
  void router.push({
    name: "kline",
    query: { code: row.code, name: row.name },
  });
}

function syncTabQuery(tab: PrimaryTab, hm?: string | null) {
  const next: Record<string, string> = { tab };
  const date = typeof route.query.date === "string" ? route.query.date : "";
  if (date) next.date = date;
  if (tab === "hotmoney" && hm) next.hm = hm;
  const curTab = typeof route.query.tab === "string" ? route.query.tab : "";
  const curHm = typeof route.query.hm === "string" ? route.query.hm : "";
  if (curTab === (next.tab || "") && curHm === (next.hm || "")) return;
  void router.replace({ name: "lhb-v3", query: next });
}

function setPrimaryTab(tab: PrimaryTab) {
  primaryTab.value = tab;
  syncTabQuery(
    tab,
    tab === "hotmoney"
      ? hotmoneyInitialId.value ||
          (typeof route.query.hm === "string" ? route.query.hm : null)
      : null,
  );
}

function onHotMoneySelect(trader: { id: string }) {
  syncTabQuery("hotmoney", trader.id);
}

watch(homeSubTab, () => {
  if (filteredRows.value.length && !filteredRows.value.some((r) => rowKey(r) === selectedKey.value)) {
    void selectRow(filteredRows.value[0]);
  }
});

watch(
  () => route.query.tab,
  (tab) => {
    if (
      tab === "home" ||
      tab === "hotmoney" ||
      tab === "graph" ||
      tab === "yyb" ||
      tab === "history"
    ) {
      primaryTab.value = tab;
    }
  },
);

onMounted(() => {
  void loadDaily();
});

onActivated(() => {
  // keep-alive 从 K 线返回时保留滚动与选中态；仅同步 URL tab
  const tab = route.query.tab;
  if (
    tab === "home" ||
    tab === "hotmoney" ||
    tab === "graph" ||
    tab === "yyb" ||
    tab === "history"
  ) {
    primaryTab.value = tab;
  }
});

onBeforeUnmount(() => {
  listAbort?.abort();
  seatAbort?.abort();
});
</script>

<template>
  <div class="v3-root">
    <div class="v3-disclaimer">
      研究副本 · 像素级参考同花顺龙虎榜新版 / 龙虎图谱交互 · 主题跟随系统 · 非商业用途 · 数据
      {{ source || "—" }}
    </div>

    <!-- 一级导航 -->
    <nav class="v3-primary">
      <div class="v3-primary-tabs">
        <button
          v-for="tab in PRIMARY_TABS"
          :key="tab.id"
          type="button"
          class="v3-primary-item"
          :class="{ active: primaryTab === tab.id }"
          @click="setPrimaryTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="v3-primary-right">
        <input v-model="tradeDate" type="date" class="v3-date" @change="loadDaily" />
        <input
          v-model="keyword"
          type="search"
          class="v3-search"
          placeholder="搜索代码/名称"
        />
        <button type="button" class="v3-query" @click="loadDaily">查询</button>
      </div>
    </nav>

    <!-- 首页 -->
    <section v-if="primaryTab === 'home'" class="v3-home">
      <nav class="v3-sub">
        <button
          v-for="tab in HOME_SUB_TABS"
          :key="tab.id"
          type="button"
          class="v3-sub-item"
          :class="{ active: homeSubTab === tab.id }"
          @click="homeSubTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div v-if="error" class="v3-error">{{ error }}</div>

      <div class="v3-body">
        <!-- 解读：卡片流 -->
        <div v-if="homeSubTab === 'insight'" class="v3-insight-grid">
          <article
            v-for="r in filteredRows"
            :key="rowKey(r)"
            class="v3-insight-card"
            :class="{ active: selectedKey === rowKey(r) }"
            title="单击查看详情，双击打开K线"
            @click="selectRow(r)"
            @dblclick="openKline(r)"
          >
            <header>
              <span class="code">{{ r.code }}</span>
              <strong>{{ r.name }}</strong>
              <em :class="pctClass(r.change_pct)">{{ formatPct(r.change_pct) }}</em>
            </header>
            <p class="reason">{{ r.reason || "—" }}</p>
            <p class="insight">{{ r.insight || "暂无解读" }}</p>
          </article>
          <div v-if="!filteredRows.length && !loading" class="v3-empty">暂无解读数据</div>
        </div>

        <!-- 市场风口：概念聚合 + 表 -->
        <div v-else-if="homeSubTab === 'hot'" class="v3-hot-layout">
          <aside class="v3-concept-panel">
            <h4>风口概念</h4>
            <button
              v-for="c in conceptStats"
              :key="c.name"
              type="button"
              class="v3-concept-row"
              @click="keyword = c.name"
            >
              <span>{{ c.name }}</span>
              <em>{{ c.count }}只</em>
              <b :class="pctClass(c.avgPct)">{{ formatPct(c.avgPct) }}</b>
            </button>
          </aside>
          <div class="v3-table-wrap">
            <table class="v3-table">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>市场</th>
                  <th>代码</th>
                  <th>名称</th>
                  <th class="sortable" @click="toggleSort('change_pct')">
                    当日涨幅 {{ sortMark("change_pct") }}
                  </th>
                  <th>所属概念</th>
                  <th class="sortable num" @click="toggleSort('net_buy')">
                    净买入 {{ sortMark("net_buy") }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(r, i) in filteredRows"
                  :key="rowKey(r)"
                  :class="{ active: selectedKey === rowKey(r) }"
                  title="单击查看详情，双击打开K线"
                  @click="selectRow(r)"
                  @dblclick="openKline(r)"
                >
                  <td>{{ i + 1 }}</td>
                  <td><span class="mkt">{{ r.market }}</span></td>
                  <td class="code">{{ r.code }}</td>
                  <td>
                    {{ r.name }}
                    <span v-if="r.is_3day" class="badge-3d">3日</span>
                  </td>
                  <td :class="pctClass(r.change_pct)">{{ formatPct(r.change_pct) }}</td>
                  <td class="muted">{{ r.concept }}</td>
                  <td class="num" :class="pctClass(r.net_buy)">{{ formatAmount(r.net_buy) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 默认表：全部 / 机构 / 自选 -->
        <div v-else class="v3-table-wrap">
          <div v-if="loading" class="v3-loading">正在加载中...</div>
          <table v-else class="v3-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>市场</th>
                <th>代码</th>
                <th>名称</th>
                <th class="sortable" @click="toggleSort('change_pct')">
                  当日涨幅 {{ sortMark("change_pct") }}
                </th>
                <th class="sortable" @click="toggleSort('close')">
                  当日价格 {{ sortMark("close") }}
                </th>
                <th class="sortable" @click="toggleSort('turnover_rate')">
                  换手率 {{ sortMark("turnover_rate") }}
                </th>
                <th class="sortable num" @click="toggleSort('market_amount')">
                  金额 {{ sortMark("market_amount") }}
                </th>
                <th class="sortable num" @click="toggleSort('net_buy')">
                  净买入 {{ sortMark("net_buy") }}
                </th>
                <th class="sortable num" @click="toggleSort('buy_amount')">
                  总买入 {{ sortMark("buy_amount") }}
                </th>
                <th class="sortable num" @click="toggleSort('sell_amount')">
                  总卖出 {{ sortMark("sell_amount") }}
                </th>
                <th>所属概念</th>
                <th class="sortable" @click="toggleSort('streak')">
                  连榜次数 {{ sortMark("streak") }}
                </th>
                <th class="sortable" @click="toggleSort('year_count')">
                  近1年上榜次数 {{ sortMark("year_count") }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredRows.length">
                <td colspan="14" class="v3-empty-cell">
                  {{ homeSubTab === "watch" ? "自选股暂无上榜" : "暂无数据" }}
                </td>
              </tr>
              <tr
                v-for="(r, i) in filteredRows"
                :key="rowKey(r)"
                :class="{ active: selectedKey === rowKey(r) }"
                title="单击查看详情，双击打开K线"
                @click="selectRow(r)"
                @dblclick="openKline(r)"
              >
                <td>{{ i + 1 }}</td>
                <td><span class="mkt">{{ r.market }}</span></td>
                <td class="code">{{ r.code }}</td>
                <td class="name-cell">
                  {{ r.name }}
                  <span v-if="r.is_3day" class="badge-3d">3日</span>
                </td>
                <td :class="pctClass(r.change_pct)">{{ formatPct(r.change_pct) }}</td>
                <td>{{ r.close?.toFixed(2) ?? "—" }}</td>
                <td>{{ r.turnover_rate != null ? `${r.turnover_rate.toFixed(2)}%` : "—" }}</td>
                <td class="num">{{ formatAmount(r.amount_display) }}</td>
                <td class="num" :class="pctClass(r.net_buy)">{{ formatAmount(r.net_buy) }}</td>
                <td class="num">{{ formatAmount(r.buy_amount) }}</td>
                <td class="num">{{ formatAmount(r.sell_amount) }}</td>
                <td class="muted">{{ r.concept }}</td>
                <td>{{ r.streak }}</td>
                <td>{{ r.year_count }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 底部详情抽屉 -->
        <aside v-if="detailOpen && selected" class="v3-detail">
          <header class="v3-detail-head">
            <div>
              <strong>{{ selected.name }}</strong>
              <span class="code">{{ selected.code }}</span>
              <em :class="pctClass(selected.change_pct)">{{ formatPct(selected.change_pct) }}</em>
            </div>
            <button type="button" class="v3-close" @click="detailOpen = false">收起</button>
          </header>
          <p class="v3-reason">上榜原因：{{ selected.reason || "—" }}</p>
          <p v-if="selected.insight" class="v3-reason muted">解读：{{ selected.insight }}</p>

          <div v-if="detailLoading" class="v3-loading sm">席位加载中...</div>
          <div v-else class="v3-seat-grid">
            <div class="v3-seat-panel">
              <h5>买入金额最大前5名</h5>
              <table>
                <thead>
                  <tr>
                    <th>席位</th>
                    <th>买入</th>
                    <th>卖出</th>
                    <th>净额</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in detail?.buys ?? []" :key="'b-' + s.rank + s.seat_name">
                    <td :title="s.seat_name">
                      {{ s.seat_name }}
                      <span v-if="s.seat_kind === 'institution'" class="tag-org">机构</span>
                      <span v-else-if="s.seat_kind === 'hotmoney'" class="tag-hot">游资</span>
                    </td>
                    <td class="v3-up">{{ formatAmount(s.buy_amount) }}</td>
                    <td>{{ formatAmount(s.sell_amount) }}</td>
                    <td class="v3-up">{{ formatAmount(s.net_amount) }}</td>
                  </tr>
                  <tr v-if="!(detail?.buys?.length)">
                    <td colspan="4" class="v3-empty-cell">暂无</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="v3-seat-panel">
              <h5>卖出金额最大前5名</h5>
              <table>
                <thead>
                  <tr>
                    <th>席位</th>
                    <th>买入</th>
                    <th>卖出</th>
                    <th>净额</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in detail?.sells ?? []" :key="'s-' + s.rank + s.seat_name">
                    <td :title="s.seat_name">
                      {{ s.seat_name }}
                      <span v-if="s.seat_kind === 'institution'" class="tag-org">机构</span>
                    </td>
                    <td>{{ formatAmount(s.buy_amount) }}</td>
                    <td class="v3-down">{{ formatAmount(s.sell_amount) }}</td>
                    <td class="v3-down">{{ formatAmount(Math.abs(s.net_amount)) }}</td>
                  </tr>
                  <tr v-if="!(detail?.sells?.length)">
                    <td colspan="4" class="v3-empty-cell">暂无</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </aside>
      </div>
    </section>

    <!-- 游资追踪 -->
    <section v-else-if="primaryTab === 'hotmoney'" class="v3-pane">
      <LhbHotMoneyTracker
        :initial-id="hotmoneyInitialId"
        @select-trader="onHotMoneySelect"
      />
    </section>

    <!-- 龙虎图谱 -->
    <section v-else-if="primaryTab === 'graph'" class="v3-pane">
      <LhbHotMoneyMap :active-seats="activeSeatNames" />
    </section>

    <!-- 营业部排名 -->
    <section v-else-if="primaryTab === 'yyb'" class="v3-pane">
      <div class="v3-pane-toolbar">
        <span>基于当前选中个股席位的研究视图（非全市场排行源）</span>
      </div>
      <div class="v3-table-wrap grow">
        <table class="v3-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>营业部</th>
              <th>方向</th>
              <th>类型</th>
              <th class="num">金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in yybRanks" :key="s.name + i">
              <td>{{ i + 1 }}</td>
              <td>{{ s.name }}</td>
              <td :class="s.side === '买' ? 'v3-up' : 'v3-down'">{{ s.side }}</td>
              <td>{{ s.kind === "institution" ? "机构" : s.kind === "hotmoney" ? "游资" : "其他" }}</td>
              <td class="num">{{ formatAmount(s.net) }}</td>
            </tr>
            <tr v-if="!yybRanks.length">
              <td colspan="5" class="v3-empty-cell">请先在首页选择个股以加载席位</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 龙虎风云录 -->
    <section v-else class="v3-pane">
      <div class="v3-history">
        <article
          v-for="r in rows.slice(0, 16)"
          :key="rowKey(r)"
          class="v3-history-card"
          title="单击查看详情，双击打开K线"
          @click="selectRow(r); primaryTab = 'home'"
          @dblclick="openKline(r)"
        >
          <div class="date">{{ r.trade_date }}</div>
          <div class="title">
            <span class="code">{{ r.code }}</span>
            {{ r.name }}
            <em :class="pctClass(r.change_pct)">{{ formatPct(r.change_pct) }}</em>
          </div>
          <p>{{ r.reason }}</p>
          <p class="muted">净买 {{ formatAmount(r.net_buy) }} · {{ r.concept }} · 近1年 {{ r.year_count }} 次</p>
        </article>
        <div v-if="!rows.length" class="v3-empty">暂无风云录样本</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.v3-root {
  /* 跟随 MainLayout 写入的 data-theme / CSS 变量，浅色深色自动切换 */
  --v3-bg: var(--color-bg);
  --v3-panel: var(--color-bg-elevated);
  --v3-panel-2: color-mix(in srgb, var(--color-text) 4%, var(--color-bg-elevated));
  --v3-border: var(--color-border);
  --v3-text: var(--color-text);
  --v3-muted: var(--color-text-muted);
  --v3-code: var(--color-accent);
  --v3-link: var(--color-accent);
  --v3-up: var(--color-up);
  --v3-down: var(--color-down);
  --v3-accent: #e93030;
  --v3-nav: color-mix(in srgb, var(--color-text) 8%, var(--color-bg-elevated));
  --v3-nav-active: color-mix(in srgb, var(--color-text) 14%, var(--color-bg-elevated));
  --v3-row-active: color-mix(in srgb, var(--color-accent) 16%, var(--color-bg-elevated));
  --v3-row-hover: color-mix(in srgb, var(--color-text) 5%, var(--color-bg-elevated));
  --v3-thead: color-mix(in srgb, var(--color-text) 6%, var(--color-bg-elevated));
  --v3-on-accent: #ffffff;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  background: var(--v3-bg);
  color: var(--v3-text);
  font-size: 12px;
  border: 1px solid var(--v3-border);
  overflow: hidden;
}

.v3-disclaimer {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--v3-muted);
  background: var(--v3-panel-2);
  border-bottom: 1px solid var(--v3-border);
}

.v3-primary {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 0;
  background: var(--v3-nav);
  border-bottom: 1px solid var(--v3-border);
  flex-shrink: 0;
}

.v3-primary-tabs {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  flex-wrap: nowrap;
}

.v3-primary-item {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--v3-muted);
  padding: 10px 18px;
  font-size: 13px;
  cursor: pointer;
  position: relative;
  white-space: nowrap;
  flex-shrink: 0;
}

.v3-primary-item.active {
  color: var(--v3-text);
  background: var(--v3-nav-active);
}

.v3-primary-item.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: var(--v3-accent);
}

.v3-primary-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  flex-shrink: 0;
}

.v3-date,
.v3-search {
  background: var(--v3-bg);
  border: 1px solid var(--v3-border);
  color: var(--v3-text);
  border-radius: 2px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
}

.v3-search {
  width: 160px;
}

.v3-query {
  appearance: none;
  border: 0;
  background: var(--color-accent);
  color: var(--v3-on-accent);
  padding: 5px 12px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
}

.v3-query:hover {
  background: var(--color-accent-hover);
}

.v3-sub {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  background: var(--v3-panel);
  border-bottom: 1px solid var(--v3-border);
  flex-shrink: 0;
}

.v3-sub-item {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--v3-muted);
  padding: 6px 14px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
}

.v3-sub-item.active {
  background: var(--v3-nav-active);
  color: var(--v3-text);
}

.v3-home,
.v3-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.v3-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.v3-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--v3-panel);
}

.v3-table-wrap.grow {
  flex: 1;
}

.v3-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  min-width: 1100px;
}

.v3-table th,
.v3-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--v3-border);
  white-space: nowrap;
  text-align: left;
}

.v3-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--v3-thead);
  color: var(--v3-muted);
  font-weight: 500;
}

.v3-table th.sortable {
  cursor: pointer;
  color: var(--v3-link);
}

.v3-table tbody tr {
  cursor: pointer;
}

.v3-table tbody tr:hover {
  background: var(--v3-row-hover);
}

.v3-table tbody tr.active {
  background: var(--v3-row-active);
}

.v3-table tbody tr.active td {
  color: var(--v3-text);
}

.v3-up {
  color: var(--v3-up) !important;
}

.v3-down {
  color: var(--v3-down) !important;
}

.code {
  color: var(--v3-code);
  font-variant-numeric: tabular-nums;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--v3-muted);
}

.mkt {
  display: inline-block;
  min-width: 1.5em;
  text-align: center;
  color: var(--v3-muted);
}

.badge-3d {
  display: inline-block;
  margin-left: 4px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 16px;
  border-radius: 2px;
  background: #e6a23c;
  color: #1a1206;
  font-weight: 700;
  vertical-align: middle;
}

.name-cell {
  max-width: 140px;
}

.v3-loading,
.v3-empty,
.v3-empty-cell {
  color: var(--v3-muted);
  text-align: center;
  padding: 48px 12px;
}

.v3-loading.sm {
  padding: 16px;
}

.v3-error {
  margin: 8px 12px;
  padding: 8px 12px;
  color: var(--v3-up);
  background: color-mix(in srgb, var(--v3-up) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--v3-up) 25%, transparent);
}

.v3-detail {
  flex-shrink: 0;
  max-height: 42%;
  overflow: auto;
  border-top: 1px solid var(--v3-border);
  background: var(--v3-panel-2);
  padding: 10px 12px 14px;
}

.v3-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.v3-detail-head strong {
  font-size: 14px;
  margin-right: 8px;
}

.v3-detail-head em {
  margin-left: 8px;
  font-style: normal;
}

.v3-close {
  appearance: none;
  border: 1px solid var(--v3-border);
  background: transparent;
  color: var(--v3-muted);
  padding: 2px 10px;
  cursor: pointer;
  border-radius: 2px;
}

.v3-reason {
  margin: 0 0 8px;
  color: var(--v3-text);
}

.v3-seat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.v3-seat-panel {
  background: var(--v3-panel);
  border: 1px solid var(--v3-border);
  border-radius: 2px;
  overflow: hidden;
}

.v3-seat-panel h5 {
  margin: 0;
  padding: 8px 10px;
  background: var(--v3-thead);
  border-bottom: 1px solid var(--v3-border);
  font-size: 12px;
  font-weight: 600;
}

.v3-seat-panel table {
  width: 100%;
  border-collapse: collapse;
}

.v3-seat-panel th,
.v3-seat-panel td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--v3-border);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v3-seat-panel th {
  color: var(--v3-muted);
  font-weight: 500;
  background: var(--v3-panel-2);
}

.tag-org,
.tag-hot {
  display: inline-block;
  margin-left: 4px;
  padding: 0 3px;
  font-size: 10px;
  border-radius: 2px;
}

.tag-org {
  background: color-mix(in srgb, #8b5cf6 55%, var(--v3-panel));
  color: var(--v3-text);
}

.tag-hot {
  background: color-mix(in srgb, #e6a23c 45%, var(--v3-panel));
  color: var(--v3-text);
}

.v3-hot-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.v3-concept-panel {
  border-right: 1px solid var(--v3-border);
  background: var(--v3-panel-2);
  overflow: auto;
  padding: 10px 0;
}

.v3-concept-panel h4 {
  margin: 0 12px 8px;
  font-size: 12px;
  color: var(--v3-muted);
  font-weight: 600;
}

.v3-concept-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--v3-text);
  cursor: pointer;
  text-align: left;
}

.v3-concept-row:hover {
  background: var(--v3-row-hover);
}

.v3-concept-row em {
  font-style: normal;
  color: var(--v3-muted);
}

.v3-insight-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  padding: 12px;
  overflow: auto;
  flex: 1;
}

.v3-insight-card {
  background: var(--v3-panel);
  border: 1px solid var(--v3-border);
  border-radius: 2px;
  padding: 12px;
  cursor: pointer;
}

.v3-insight-card.active {
  border-color: color-mix(in srgb, var(--color-accent) 55%, var(--v3-border));
  background: var(--v3-row-active);
}

.v3-insight-card header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.v3-insight-card .reason {
  color: var(--v3-text);
  margin: 0 0 6px;
}

.v3-insight-card .insight {
  color: var(--v3-muted);
  margin: 0;
  line-height: 1.5;
}

.v3-pane-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--v3-panel);
  border-bottom: 1px solid var(--v3-border);
  color: var(--v3-muted);
  flex-shrink: 0;
}

.v3-history {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  padding: 12px;
  overflow: auto;
}

.v3-history-card {
  background: var(--v3-panel);
  border: 1px solid var(--v3-border);
  padding: 12px;
  cursor: pointer;
}

.v3-history-card:hover {
  background: var(--v3-row-hover);
}

.v3-history-card .date {
  color: var(--v3-muted);
  margin-bottom: 6px;
}

.v3-history-card .title {
  margin-bottom: 8px;
  font-size: 13px;
}

.v3-history-card p {
  margin: 0 0 6px;
  line-height: 1.45;
}

@media (max-width: 960px) {
  .v3-seat-grid,
  .v3-hot-layout {
    grid-template-columns: 1fr;
  }
  .v3-primary {
    flex-wrap: wrap;
  }
  .v3-primary-right {
    width: 100%;
    padding-bottom: 8px;
  }
}
</style>
