<script setup lang="ts">
/**
 * 重点研究工作台
 * 像素级对照：https://github.com/ZhuLinsen/daily_stock_analysis 首页决策报告
 * （左侧标的轨 + 概览双栏 + 策略点位 + 风险/催化 + 数据视角 + Markdown）
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  ApiError,
  fetchStockResearch,
  type StockResearchReport,
} from "@/api/stock";
import { useResearchList } from "@/composables/useResearchList";

const route = useRoute();
const router = useRouter();
const { list, activeCode, active, select, remove, updateQuote, addStock } =
  useResearchList();

const loading = ref(false);
const error = ref<string | null>(null);
const report = ref<StockResearchReport | null>(null);
const showMarkdown = ref(false);
const toast = ref("");

let abort: AbortController | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const adviceTone = computed(() => {
  const a = report.value?.operation_advice || "";
  if (a.includes("买")) return "buy";
  if (a.includes("卖")) return "sell";
  return "hold";
});

function flash(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = "";
  }, 2200);
}

function signedPct(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

async function loadReport(code: string) {
  if (!code) {
    report.value = null;
    return;
  }
  abort?.abort();
  abort = new AbortController();
  loading.value = true;
  error.value = null;
  try {
    const data = await fetchStockResearch(code, abort.signal);
    report.value = data;
    updateQuote(data.code, data.price, data.change_pct, data.name);
    if (!list.value.some((s) => s.code === data.code)) {
      addStock(data.code, data.name, {
        price: data.price,
        changePct: data.change_pct,
      });
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    report.value = null;
    error.value = err instanceof ApiError ? err.message : "加载研究报告失败";
  } finally {
    loading.value = false;
  }
}

function openKline() {
  const s = active.value;
  if (!s) return;
  void router.push({ name: "kline", query: { code: s.code, name: s.name } });
}

function removeCurrent() {
  if (!active.value) return;
  remove(active.value.code);
  flash("已移出重点研究");
}

watch(
  activeCode,
  (code) => {
    void loadReport(code);
    if (code && route.query.code !== code) {
      void router.replace({ name: "research", query: { code } });
    }
  },
  { immediate: true },
);

watch(
  () => route.query.code,
  (code) => {
    if (typeof code === "string" && code && code !== activeCode.value) {
      if (list.value.some((s) => s.code === code)) {
        select(code);
      } else {
        // 深链进入：先占位再拉报告
        addStock(code, code);
        select(code);
      }
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  abort?.abort();
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<template>
  <div class="dsa-root">
    <div class="dsa-disclaimer">
      重点研究布局像素参考
      <a
        href="https://github.com/ZhuLinsen/daily_stock_analysis"
        target="_blank"
        rel="noreferrer"
      >Daily Stock Analysis</a>
      决策仪表盘；报告由本地技术面启发式生成，非投资建议。
      可在「K线复盘」左侧自选上<strong>右键 → 加入重点研究</strong>。
    </div>

    <div class="dsa-workspace">
      <aside class="dsa-rail">
        <div class="dsa-rail-head">
          <strong>重点研究</strong>
          <span>{{ list.length }}</span>
        </div>
        <div v-if="!list.length" class="dsa-empty">
          暂无标的。请到 K 线复盘左侧列表右键添加。
        </div>
        <button
          v-for="s in list"
          :key="s.code"
          type="button"
          class="dsa-rail-item"
          :class="{ selected: s.code === activeCode }"
          @click="select(s.code)"
        >
          <div class="row1">
            <em>{{ s.name }}</em>
            <span
              class="pct"
              :class="s.changePct >= 0 ? 'up' : 'down'"
            >{{ signedPct(s.changePct) }}</span>
          </div>
          <div class="row2">
            <span>{{ s.code }}</span>
            <span>{{ s.price ? s.price.toFixed(2) : "—" }}</span>
          </div>
        </button>
      </aside>

      <section class="dsa-main">
        <div v-if="!active" class="dsa-empty big">选择左侧股票查看决策研究</div>

        <template v-else>
          <div class="dsa-toolbar">
            <button type="button" class="btn ghost" :disabled="loading" @click="loadReport(activeCode)">
              重新分析
            </button>
            <button type="button" class="btn ai" @click="openKline">打开 K 线</button>
            <button type="button" class="btn report" @click="showMarkdown = !showMarkdown">
              {{ showMarkdown ? "收起报告" : "完整报告" }}
            </button>
            <button type="button" class="btn danger" @click="removeCurrent">移出</button>
            <span v-if="toast" class="toast">{{ toast }}</span>
          </div>

          <div v-if="loading" class="dsa-loading">正在生成决策研究…</div>
          <div v-else-if="error" class="dsa-error">{{ error }}</div>

          <template v-else-if="report">
            <!-- 概览：左叙事 + 右评分（对照 DSA ReportOverview） -->
            <div class="dsa-overview">
              <div class="dsa-overview-left">
                <header class="dsa-stock-head">
                  <div class="title-row">
                    <h2>{{ report.name }}</h2>
                    <div class="price-block" :class="report.change_pct >= 0 ? 'up' : 'down'">
                      <strong>{{ report.price.toFixed(2) }}</strong>
                      <span>{{ signedPct(report.change_pct) }}</span>
                    </div>
                  </div>
                  <div class="meta-row">
                    <span class="code">{{ report.code }}</span>
                    <span v-if="report.phase_label" class="badge">{{ report.phase_label }}</span>
                    <span class="time">{{ report.created_at }}</span>
                  </div>
                </header>

                <article class="dsa-card insight">
                  <h3>核心结论</h3>
                  <p>{{ report.analysis_summary }}</p>
                </article>

                <div class="dsa-two">
                  <article class="dsa-card">
                    <h3>操作建议</h3>
                    <p class="advice" :data-tone="adviceTone">{{ report.operation_advice }}</p>
                  </article>
                  <article class="dsa-card">
                    <h3>趋势预测</h3>
                    <p>{{ report.trend_prediction }}</p>
                  </article>
                </div>

                <article v-if="report.boards?.length" class="dsa-card">
                  <h3>关联板块</h3>
                  <div class="chips">
                    <span v-for="b in report.boards" :key="b" class="chip">{{ b }}</span>
                  </div>
                </article>
              </div>

              <aside class="dsa-overview-right">
                <div class="score-panel">
                  <div class="score-label">市场情绪 / 评分</div>
                  <div class="score-gauge" :style="{ '--score': report.score }">
                    <svg viewBox="0 0 120 120" aria-hidden="true">
                      <circle class="track" cx="60" cy="60" r="48" />
                      <circle
                        class="head"
                        cx="60"
                        cy="60"
                        r="48"
                        :style="{
                          strokeDasharray: `${(report.score / 100) * 301.6} 301.6`,
                        }"
                      />
                    </svg>
                    <div class="score-num">
                      <strong>{{ report.score }}</strong>
                      <span>{{ report.sentiment || "—" }}</span>
                    </div>
                  </div>
                  <div class="advice-pill" :data-tone="adviceTone">
                    {{ report.operation_advice }} · {{ report.trend_prediction }}
                  </div>
                </div>
              </aside>
            </div>

            <!-- 策略点位（对照 DSA ReportStrategy） -->
            <div class="dsa-strategy">
              <div class="strategy-item buy">
                <span>理想买点</span>
                <strong>{{ report.strategy.ideal_buy }}</strong>
              </div>
              <div class="strategy-item secondary">
                <span>次优买点</span>
                <strong>{{ report.strategy.secondary_buy }}</strong>
              </div>
              <div class="strategy-item stop">
                <span>止损</span>
                <strong>{{ report.strategy.stop_loss }}</strong>
              </div>
              <div class="strategy-item take">
                <span>止盈</span>
                <strong>{{ report.strategy.take_profit }}</strong>
              </div>
            </div>

            <div class="dsa-intel">
              <article class="dsa-card">
                <h3>风险警报</h3>
                <ul>
                  <li v-for="(r, i) in report.risks" :key="'r' + i">{{ r }}</li>
                </ul>
              </article>
              <article class="dsa-card">
                <h3>利好催化</h3>
                <ul>
                  <li v-for="(c, i) in report.catalysts" :key="'c' + i">{{ c }}</li>
                </ul>
              </article>
            </div>

            <article class="dsa-card">
              <h3>数据视角</h3>
              <div class="data-grid">
                <div v-for="d in report.data_view" :key="d.label" class="data-cell">
                  <span>{{ d.label }}</span>
                  <em>{{ d.value }}</em>
                </div>
              </div>
            </article>

            <article class="dsa-card">
              <h3>操作检查清单</h3>
              <ul class="check">
                <li v-for="(c, i) in report.checklist" :key="'k' + i">{{ c }}</li>
              </ul>
            </article>

            <article v-if="showMarkdown" class="dsa-card markdown">
              <h3>完整报告</h3>
              <pre>{{ report.markdown }}</pre>
            </article>

            <footer class="dsa-foot">
              {{ report.model_used }} · 数据源 {{ report.source }}
            </footer>
          </template>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.dsa-root {
  --dsa-accent: var(--color-accent);
  --dsa-buy: var(--color-down);
  --dsa-stop: var(--color-up);
  --dsa-take: #ca8a04;
  --dsa-up: var(--color-up);
  --dsa-down: var(--color-down);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-bg);
  color: var(--color-text);
}

.dsa-disclaimer {
  flex-shrink: 0;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
}

.dsa-disclaimer a {
  color: var(--dsa-accent);
  text-decoration: underline;
}

.dsa-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 0;
}

.dsa-rail {
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-sidebar);
  overflow: auto;
  padding: 10px 8px 16px;
}

.dsa-rail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px 10px;
  font-size: 13px;
}

.dsa-rail-head span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.dsa-rail-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: var(--color-bg-elevated);
  border-radius: 10px;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  color: inherit;
}

.dsa-rail-item:hover {
  border-color: color-mix(in srgb, var(--dsa-accent) 28%, transparent);
  background: color-mix(in srgb, var(--dsa-accent) 6%, var(--color-bg-elevated));
}

.dsa-rail-item.selected {
  border-color: color-mix(in srgb, var(--dsa-accent) 45%, transparent);
  background: color-mix(in srgb, var(--dsa-accent) 10%, var(--color-bg-elevated));
}

.dsa-rail-item .row1,
.dsa-rail-item .row2 {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.dsa-rail-item em {
  font-style: normal;
  font-weight: 650;
  font-size: 13px;
}

.dsa-rail-item .row2 {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.dsa-rail-item .pct.up {
  color: var(--dsa-up);
}
.dsa-rail-item .pct.down {
  color: var(--dsa-down);
}

.dsa-main {
  min-width: 0;
  overflow: auto;
  padding: 12px 16px 28px;
  background: var(--color-bg);
}

.dsa-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.btn {
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 6px 14px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.btn:hover:not(:disabled) {
  color: var(--color-text);
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.btn.ai,
.btn.report {
  border-color: var(--dsa-accent);
  background: color-mix(in srgb, var(--dsa-accent) 12%, transparent);
  color: var(--dsa-accent);
}

.btn.danger {
  border-color: color-mix(in srgb, var(--dsa-stop) 40%, transparent);
  background: color-mix(in srgb, var(--dsa-stop) 8%, transparent);
  color: var(--dsa-stop);
}

.toast {
  font-size: 12px;
  color: var(--dsa-accent);
}

.dsa-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px;
  gap: 12px;
  margin-bottom: 12px;
}

.dsa-stock-head {
  margin-bottom: 10px;
}

.title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
}

.title-row h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.price-block {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.price-block strong {
  font-size: 22px;
}

.price-block.up,
.up {
  color: var(--dsa-up);
}
.price-block.down,
.down {
  color: var(--dsa-down);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.badge {
  border: 1px solid color-mix(in srgb, var(--dsa-accent) 30%, transparent);
  background: color-mix(in srgb, var(--dsa-accent) 10%, transparent);
  color: var(--dsa-accent);
  border-radius: 999px;
  padding: 1px 8px;
}

.dsa-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-elevated);
  box-shadow: 0 1px 3px rgb(15 23 42 / 4%);
  padding: 12px 14px;
  margin-bottom: 10px;
}

.dsa-card h3 {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--dsa-accent);
  font-weight: 650;
}

.dsa-card p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
}

.dsa-card.insight p {
  font-size: 14px;
}

.dsa-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.advice[data-tone="buy"] {
  color: var(--dsa-buy);
  font-weight: 700;
  font-size: 18px !important;
}
.advice[data-tone="sell"] {
  color: var(--dsa-stop);
  font-weight: 700;
  font-size: 18px !important;
}
.advice[data-tone="hold"] {
  color: var(--dsa-take);
  font-weight: 700;
  font-size: 18px !important;
}

.score-panel {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 14px 12px;
  background: var(--color-bg-elevated);
  text-align: center;
  position: sticky;
  top: 8px;
}

.score-label {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.score-gauge {
  position: relative;
  width: 128px;
  height: 128px;
  margin: 0 auto 10px;
}

.score-gauge svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.score-gauge .track {
  fill: none;
  stroke: color-mix(in srgb, var(--dsa-accent) 18%, transparent);
  stroke-width: 10;
}

.score-gauge .head {
  fill: none;
  stroke: var(--dsa-accent);
  stroke-width: 10;
  stroke-linecap: round;
  transition: stroke-dasharray 0.4s ease;
}

.score-num {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.score-num strong {
  font-size: 28px;
  line-height: 1;
}

.score-num span {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.advice-pill {
  font-size: 12px;
  border-radius: 999px;
  padding: 4px 10px;
  display: inline-block;
  border: 1px solid var(--color-border);
}

.advice-pill[data-tone="buy"] {
  color: var(--dsa-buy);
  border-color: color-mix(in srgb, var(--dsa-buy) 35%, transparent);
  background: color-mix(in srgb, var(--dsa-buy) 10%, transparent);
}
.advice-pill[data-tone="sell"] {
  color: var(--dsa-stop);
  border-color: color-mix(in srgb, var(--dsa-stop) 35%, transparent);
  background: color-mix(in srgb, var(--dsa-stop) 10%, transparent);
}
.advice-pill[data-tone="hold"] {
  color: var(--dsa-take);
  border-color: color-mix(in srgb, var(--dsa-take) 35%, transparent);
  background: color-mix(in srgb, var(--dsa-take) 10%, transparent);
}

.dsa-strategy {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.strategy-item {
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.strategy-item span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.strategy-item strong {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.strategy-item.buy {
  border-top: 3px solid var(--dsa-buy);
}
.strategy-item.secondary {
  border-top: 3px solid var(--dsa-accent);
}
.strategy-item.stop {
  border-top: 3px solid var(--dsa-stop);
}
.strategy-item.take {
  border-top: 3px solid var(--dsa-take);
}

.dsa-intel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.dsa-card ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
}

.data-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.data-cell {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--color-bg);
}

.data-cell span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.data-cell em {
  font-style: normal;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.check li {
  margin-bottom: 4px;
}

.markdown pre {
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.55;
  margin: 0;
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.dsa-foot {
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.dsa-empty {
  padding: 16px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.dsa-empty.big {
  padding: 48px 16px;
  text-align: center;
}

.dsa-loading,
.dsa-error {
  padding: 20px;
  font-size: 13px;
}

.dsa-error {
  color: var(--dsa-stop);
}

@media (max-width: 960px) {
  .dsa-workspace {
    grid-template-columns: 1fr;
  }
  .dsa-rail {
    max-height: 180px;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }
  .dsa-overview,
  .dsa-intel,
  .dsa-strategy,
  .dsa-two,
  .data-grid {
    grid-template-columns: 1fr 1fr;
  }
  .dsa-strategy {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
