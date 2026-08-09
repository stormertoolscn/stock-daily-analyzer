<script setup lang="ts">
/**
 * 策略回测工作台
 * 功能组构像素参考：https://www.stockbacktest.cn/strategies
 * （策略回测 / 策略选股 / 策略实盘 / 策略盯盘 + 指标卡 + 收益曲线 + 交易明细）
 * 主题沿用项目默认主题变量。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import {
  fetchBacktestSignals,
  fetchBacktestStrategies,
  formatMoney,
  formatPct2,
  runBacktest,
  type BacktestParams,
  type BacktestRunResult,
  type BacktestSignal,
  type BacktestStrategy,
} from "@/api/backtest";

defineOptions({ name: "Backtest" });

const router = useRouter();

type TabId = "backtest" | "pick" | "sim" | "watch";

const tabs: { id: TabId; label: string; desc: string }[] = [
  { id: "backtest", label: "策略回测", desc: "历史数据验证策略，查看收益、胜率、最大回撤等专业指标" },
  { id: "pick", label: "策略选股", desc: "符合策略条件的股票一键筛选，每日盘后自动更新" },
  { id: "sim", label: "策略实盘", desc: "模拟真实交易，跟踪策略收益，记录买卖订单与持仓" },
  { id: "watch", label: "策略盯盘", desc: "交易时段实时监控，信号触发即时提醒" },
];

const activeTab = ref<TabId>("backtest");
const strategies = ref<BacktestStrategy[]>([]);
const activeStrategyId = ref("ma_cross");
const codes = ref("600519");
const startDate = ref("2023-01-01");
const initialCash = ref(1000000);
const maShort = ref(20);
const maLong = ref(60);
const takeProfit = ref(30);
const stopLoss = ref(10);

const running = ref(false);
const runError = ref("");
const result = ref<BacktestRunResult | null>(null);
const signals = ref<BacktestSignal[]>([]);
const signalsLoading = ref(false);
const signalsError = ref("");

let abort: AbortController | null = null;

const activeStrategy = computed(
  () => strategies.value.find((s) => s.id === activeStrategyId.value) ?? null,
);

const statsCards = computed(() => {
  const s = result.value?.stats ?? {};
  return [
    { label: "年化收益率", value: formatPct2(s.annual_return), cls: "up" },
    { label: "累计收益", value: formatPct2(s.total_return), cls: "up" },
    { label: "夏普比率", value: (s.sharpe ?? 0).toFixed(2), cls: "" },
    { label: "最大回撤", value: formatPct2(s.max_drawdown), cls: "down" },
    { label: "胜率", value: `${(s.win_rate ?? 0).toFixed(1)}%`, cls: "" },
    { label: "交易次数", value: String(s.trade_count ?? 0), cls: "" },
    { label: "基准收益", value: formatPct2(s.benchmark_return), cls: "" },
    { label: "期末资金", value: formatMoney(s.final_equity), cls: "" },
  ];
});

const CURVE_W = 680;
const CURVE_H = 230;
const CURVE_PAD = 12;

function curveBounds(): { min: number; max: number } {
  const eq = result.value?.equity_curve ?? [];
  const be = result.value?.benchmark_curve ?? [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of [...eq, ...be]) {
    const v = Number(p.equity ?? 0);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max - min < 1) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function linePath(points: { equity?: number }[], min: number, max: number): string {
  if (!points.length) return "";
  const span = max - min || 1;
  return points
    .map((p, i) => {
      const x = CURVE_PAD + (i / (points.length - 1)) * (CURVE_W - CURVE_PAD * 2);
      const y =
        CURVE_PAD + (1 - (Number(p.equity ?? 0) - min) / span) * (CURVE_H - CURVE_PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const equityPath = computed(() => {
  const b = curveBounds();
  return linePath(result.value?.equity_curve ?? [], b.min, b.max);
});
const benchmarkPath = computed(() => {
  const b = curveBounds();
  return linePath(result.value?.benchmark_curve ?? [], b.min, b.max);
});

const drawdownPath = computed(() => {
  const points = result.value?.drawdown_curve ?? [];
  if (!points.length) return "";
  let min = 0;
  for (const p of points) {
    const v = Number(p.drawdown ?? 0);
    if (v < min) min = v;
  }
  const lo = min * 1.1;
  const span = 0 - lo || 1;
  return points
    .map((p, i) => {
      const x = CURVE_PAD + (i / (points.length - 1)) * (CURVE_W - CURVE_PAD * 2);
      const y = CURVE_PAD + (1 - (Number(p.drawdown ?? 0) - lo) / span) * (CURVE_H - CURVE_PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
});

const curveFirstDate = computed(() => result.value?.equity_curve?.[0]?.date ?? "");
const curveLastDate = computed(
  () => result.value?.equity_curve?.[result.value?.equity_curve.length - 1]?.date ?? "",
);

function syncParamsFromStrategy() {
  const p = activeStrategy.value?.params;
  if (!p) return;
  maShort.value = p.ma_short;
  maLong.value = p.ma_long;
  takeProfit.value = p.take_profit_pct;
  stopLoss.value = p.stop_loss_pct;
  initialCash.value = p.initial_cash;
}

watch(activeStrategyId, () => {
  syncParamsFromStrategy();
  result.value = null;
  runError.value = "";
  void loadSignals();
});

function currentParams(): BacktestParams {
  return {
    ma_short: Number(maShort.value) || 20,
    ma_long: Number(maLong.value) || 60,
    take_profit_pct: Number(takeProfit.value) || 0,
    stop_loss_pct: Number(stopLoss.value) || 0,
    initial_cash: Number(initialCash.value) || 1000000,
    start_date: startDate.value.trim(),
  };
}

async function run() {
  abort?.abort();
  abort = new AbortController();
  running.value = true;
  runError.value = "";
  result.value = null;
  try {
    const res = await runBacktest(
      {
        strategy: activeStrategyId.value,
        codes: codes.value,
        params: currentParams(),
      },
      abort.signal,
    );
    if (!res.ok) {
      runError.value = res.error || "回测失败";
      return;
    }
    result.value = res;
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    runError.value = e instanceof Error ? e.message : "回测失败";
  } finally {
    if (!abort.signal.aborted) running.value = false;
  }
}

async function loadSignals() {
  if (!codes.value.trim()) return;
  signalsLoading.value = true;
  signalsError.value = "";
  try {
    signals.value = await fetchBacktestSignals(
      codes.value,
      activeStrategyId.value,
      abort?.signal,
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    signalsError.value = e instanceof Error ? e.message : "信号加载失败";
    signals.value = [];
  } finally {
    signalsLoading.value = false;
  }
}

function openKline(code: string, name: string) {
  void router.push({ name: "kline", query: { code, name } });
}

function signalClass(signal: string): string {
  if (signal === "买入") return "up";
  if (signal === "卖出") return "down";
  return "";
}

const simHoldings = computed(() => {
  const per = (Number(initialCash.value) || 1000000) / Math.max(signals.value.length, 1);
  return signals.value.map((s) => ({
    ...s,
    nominal: s.signal === "买入" ? per : 0,
  }));
});

const watchRules = [
  { name: "均线死叉预警", desc: "短均线下穿长均线时提醒减仓", icon: "✂" },
  { name: "放量突破预警", desc: "涨幅超 3% 且量比放大 1.5 倍时提醒关注", icon: "⚡" },
  { name: "超卖反弹预警", desc: "RSI 低于 30 时提醒波段机会", icon: "↧" },
  { name: "止盈止损提醒", desc: "持仓浮盈浮亏触及阈值时提醒", icon: "◎" },
];

onMounted(async () => {
  try {
    strategies.value = await fetchBacktestStrategies();
    const first = strategies.value[0];
    if (first) {
      activeStrategyId.value = first.id;
      syncParamsFromStrategy();
    }
  } catch {
    /* 策略列表失败不阻塞页面 */
  }
  void run();
  void loadSignals();
});

onBeforeUnmount(() => {
  abort?.abort();
});
</script><template>
  <div class="bt-page">
    <header class="bt-hero">
      <div class="bt-hero-text">
        <p class="bt-kicker">Strategy Backtest</p>
        <h1>策略回测</h1>
        <p class="bt-sub">
          用历史数据验证您的交易策略，查看收益率、胜率、最大回撤等专业指标。
          功能组构像素参考
          <a href="https://www.stockbacktest.cn/strategies" target="_blank" rel="noreferrer">易回测</a>
          ，主题沿用本项目默认主题；数据为本项目 A 股日线（前复权）。
        </p>
      </div>
      <div class="bt-hero-meta">
        <span>10 年历史数据</span>
        <span>20+ 评估指标</span>
        <span>可视化收益曲线</span>
        <span>交易明细记录</span>
      </div>
    </header>

    <nav class="bt-tabs" aria-label="回测功能页签">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="bt-tab"
        :class="{ 'bt-tab-active': activeTab === t.id }"
        @click="activeTab = t.id"
      >
        <strong>{{ t.label }}</strong>
        <span>{{ t.desc }}</span>
      </button>
    </nav>

    <!-- 策略回测 -->
    <section v-if="activeTab === 'backtest'" class="bt-main">
      <div v-if="result" class="bt-cards">
        <div v-for="c in statsCards" :key="c.label" class="bt-card">
          <span>{{ c.label }}</span>
          <strong :class="c.cls">{{ c.value }}</strong>
        </div>
      </div>

      <div class="bt-workspace">
        <aside class="bt-config">
          <div class="bt-config-head">
            <h2>策略配置</h2>
            <span>{{ activeStrategy?.name ?? "" }}</span>
          </div>

          <div class="bt-strategies">
            <button
              v-for="s in strategies"
              :key="s.id"
              type="button"
              class="bt-strategy"
              :class="{ 'bt-strategy-active': activeStrategyId === s.id }"
              @click="activeStrategyId = s.id"
            >
              <strong>{{ s.name }}</strong>
              <span>{{ s.desc }}</span>
            </button>
          </div>

          <div class="bt-field">
            <label>股票代码（逗号分隔）</label>
            <input v-model="codes" type="text" placeholder="如 600519,000001" />
          </div>

          <div class="bt-grid2">
            <div class="bt-field">
              <label>短均线</label>
              <input v-model.number="maShort" type="number" min="2" max="120" />
            </div>
            <div class="bt-field">
              <label>长均线</label>
              <input v-model.number="maLong" type="number" min="5" max="250" />
            </div>
            <div class="bt-field">
              <label>止盈 %</label>
              <input v-model.number="takeProfit" type="number" min="0" max="200" />
            </div>
            <div class="bt-field">
              <label>止损 %</label>
              <input v-model.number="stopLoss" type="number" min="0" max="100" />
            </div>
            <div class="bt-field">
              <label>初始资金</label>
              <input v-model.number="initialCash" type="number" min="10000" step="100000" />
            </div>
            <div class="bt-field">
              <label>起始日期</label>
              <input v-model="startDate" type="date" />
            </div>
          </div>

          <button type="button" class="bt-run" :disabled="running" @click="run">
            {{ running ? "回测中…" : "开始回测" }}
          </button>
          <p v-if="runError" class="bt-error">{{ runError }}</p>
          <p v-if="result?.errors?.length" class="bt-error">
            部分标的数据不可用：{{ result.errors.join("；") }}
          </p>
        </aside>

        <div class="bt-result">
          <div v-if="running" class="bt-empty">正在拉取历史数据并运行回测…</div>
          <div v-else-if="!result" class="bt-empty">
            选择策略与标的，点击「开始回测」。<br />
            也可在选股 / 实盘 / 盯盘页签中查看当前信号。
          </div>
          <template v-else>
            <div class="bt-chart-card">
              <header>
                <h3>收益曲线 · {{ result.strategy_name }}</h3>
                <span>{{ curveFirstDate }} → {{ curveLastDate }}</span>
              </header>
              <svg
                class="bt-chart"
                :viewBox="`0 0 ${CURVE_W} ${CURVE_H}`"
                preserveAspectRatio="none"
              >
                <path class="bt-grid-line" :d="`M${CURVE_PAD},${CURVE_H / 2} H${CURVE_W - CURVE_PAD}`" />
                <path class="bt-bench" :d="benchmarkPath" />
                <path class="bt-equity" :d="equityPath" />
              </svg>
              <div class="bt-legend">
                <span class="bt-legend-equity">策略净值</span>
                <span class="bt-legend-bench">买入持有基准</span>
              </div>
            </div>

            <div class="bt-chart-card">
              <header>
                <h3>回撤曲线</h3>
                <span>最大回撤 {{ formatPct2(result.stats.max_drawdown) }}</span>
              </header>
              <svg
                class="bt-chart"
                :viewBox="`0 0 ${CURVE_W} ${CURVE_H}`"
                preserveAspectRatio="none"
              >
                <path class="bt-grid-line" :d="`M${CURVE_PAD},${CURVE_PAD} H${CURVE_W - CURVE_PAD}`" />
                <path class="bt-drawdown" :d="drawdownPath" />
              </svg>
            </div>

            <div v-if="result.per_stock.length" class="bt-table-card">
              <header>
                <h3>分标的绩效</h3>
              </header>
              <table class="bt-table">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>累计收益</th>
                    <th>最大回撤</th>
                    <th>胜率</th>
                    <th>交易次数</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="p in result.per_stock"
                    :key="p.code"
                    @dblclick="openKline(p.code, p.name)"
                  >
                    <td class="bt-code">{{ p.code }}</td>
                    <td>{{ p.name }}</td>
                    <td :class="p.total_return >= 0 ? 'up' : 'down'">{{ formatPct2(p.total_return) }}</td>
                    <td class="down">{{ formatPct2(p.max_drawdown) }}</td>
                    <td>{{ p.win_rate.toFixed(1) }}%</td>
                    <td>{{ p.trade_count }}</td>
                  </tr>
                </tbody>
              </table>
            </div>            <div class="bt-table-card">
              <header>
                <h3>交易明细</h3>
                <span>共 {{ result.trades.length }} 笔，双击行查看 K 线</span>
              </header>
              <table class="bt-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>代码</th>
                    <th>名称</th>
                    <th>方向</th>
                    <th>价格</th>
                    <th>数量</th>
                    <th>金额</th>
                    <th>收益</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(t, i) in result.trades"
                    :key="t.date + t.code + i"
                    @dblclick="openKline(t.code, t.name)"
                  >
                    <td>{{ t.date }}</td>
                    <td class="bt-code">{{ t.code }}</td>
                    <td>{{ t.name }}</td>
                    <td :class="t.action === 'buy' ? 'up' : 'down'">
                      {{ t.action === "buy" ? "买入" : "卖出" }}
                    </td>
                    <td>{{ t.price.toFixed(2) }}</td>
                    <td>{{ t.shares }}</td>
                    <td>{{ formatMoney(t.amount) }}</td>
                    <td :class="t.return_pct >= 0 ? 'up' : 'down'">{{ formatPct2(t.return_pct) }}</td>
                    <td class="bt-muted">{{ t.reason }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </section>

    <!-- 策略选股 -->
    <section v-else-if="activeTab === 'pick'" class="bt-panel">
      <div class="bt-panel-head">
        <h2>策略选股</h2>
        <p>今日符合「{{ activeStrategy?.name ?? "" }}」条件的股票信号，双击进入 K 线复盘。</p>
      </div>
      <div class="bt-panel-actions">
        <input v-model="codes" type="text" placeholder="股票代码，逗号分隔" @change="loadSignals" />
        <button type="button" class="bt-run" :disabled="signalsLoading" @click="loadSignals">
          {{ signalsLoading ? "扫描中…" : "刷新信号" }}
        </button>
      </div>
      <p v-if="signalsError" class="bt-error">{{ signalsError }}</p>
      <div v-if="signals.length" class="bt-signal-grid">
        <button
          v-for="s in signals"
          :key="s.code"
          type="button"
          class="bt-signal"
          :class="signalClass(s.signal)"
          @dblclick="openKline(s.code, s.name)"
        >
          <span class="bt-signal-name"><strong>{{ s.name }}</strong><em>{{ s.code }}</em></span>
          <span class="bt-signal-state">{{ s.signal }}</span>
          <span class="bt-signal-meta">{{ s.date }} · 现价 {{ s.close.toFixed(2) }}</span>
          <span class="bt-signal-detail">{{ s.detail }}</span>
        </button>
      </div>
      <div v-else-if="signalsLoading" class="bt-empty">正在扫描标的信号…</div>
      <div v-else class="bt-empty">输入标的后点击「刷新信号」</div>
    </section>

    <!-- 策略实盘 -->
    <section v-else-if="activeTab === 'sim'" class="bt-panel">
      <div class="bt-panel-head">
        <h2>策略实盘 · 模拟账户</h2>
        <p>模拟真实交易（简化等权）：初始 {{ formatMoney(Number(initialCash)) }}，买入信号等权分配名义仓位。</p>
      </div>
      <div v-if="simHoldings.length" class="bt-table-card">
        <table class="bt-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>信号</th>
              <th>信号日</th>
              <th>现价</th>
              <th>名义仓位</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in simHoldings" :key="h.code" @dblclick="openKline(h.code, h.name)">
              <td class="bt-code">{{ h.code }}</td>
              <td>{{ h.name }}</td>
              <td :class="signalClass(h.signal)">{{ h.signal }}</td>
              <td>{{ h.date }}</td>
              <td>{{ h.close.toFixed(2) }}</td>
              <td>{{ h.nominal ? formatMoney(h.nominal) : "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="bt-empty">暂无持仓（无买入信号或未刷新）</div>
    </section>

    <!-- 策略盯盘 -->
    <section v-else class="bt-panel">
      <div class="bt-panel-head">
        <h2>策略盯盘</h2>
        <p>交易时段实时监控所选标的，信号触发即时提醒；下方为最近信号快照。</p>
      </div>
      <div class="bt-rules">
        <div v-for="r in watchRules" :key="r.name" class="bt-rule">
          <span class="bt-rule-icon">{{ r.icon }}</span>
          <span><strong>{{ r.name }}</strong><em>{{ r.desc }}</em></span>
        </div>
      </div>
      <div class="bt-panel-actions">
        <input v-model="codes" type="text" placeholder="股票代码，逗号分隔" @change="loadSignals" />
        <button type="button" class="bt-run" :disabled="signalsLoading" @click="loadSignals">
          {{ signalsLoading ? "刷新中…" : "刷新信号" }}
        </button>
      </div>
      <div v-if="signals.length" class="bt-signal-grid">
        <button
          v-for="s in signals"
          :key="s.code"
          type="button"
          class="bt-signal"
          :class="signalClass(s.signal)"
          @dblclick="openKline(s.code, s.name)"
        >
          <span class="bt-signal-name"><strong>{{ s.name }}</strong><em>{{ s.code }}</em></span>
          <span class="bt-signal-state">{{ s.signal }}</span>
          <span class="bt-signal-meta">{{ s.date }} · {{ s.detail }}</span>
        </button>
      </div>
      <div v-else-if="signalsLoading" class="bt-empty">正在刷新信号…</div>
      <div v-else class="bt-empty">暂无信号日志</div>
    </section>
  </div>
</template>
<style scoped>
.bt-page {
  height: 100%;
  overflow: auto;
  padding: 22px 26px 48px;
  background: var(--color-bg);
  color: var(--color-text);
}

.bt-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  padding: 16px 0 18px;
  border-bottom: 1px solid var(--color-border);
}

.bt-kicker {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.bt-hero h1 {
  margin: 4px 0 0;
  font-size: 34px;
  font-weight: 750;
  letter-spacing: -0.03em;
}

.bt-sub {
  margin: 8px 0 0;
  max-width: 46rem;
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1.6;
}

.bt-sub a {
  color: var(--color-accent);
  text-decoration: none;
}

.bt-hero-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  max-width: 420px;
}

.bt-hero-meta span {
  font-size: 12px;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 5px 11px;
  background: var(--color-bg-elevated);
}

.bt-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}

.bt-tab {
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg-elevated);
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--color-text);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.2s ease;
}

.bt-tab:hover {
  border-color: var(--color-accent);
}

.bt-tab:active {
  transform: scale(0.99);
}

.bt-tab strong {
  font-size: 15px;
}

.bt-tab span {
  font-size: 11.5px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.bt-tab-active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-elevated));
}

.bt-tab-active strong {
  color: var(--color-accent);
}

.bt-main {
  padding-top: 16px;
}

.bt-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.bt-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--color-bg-elevated);
}

.bt-card span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.bt-card strong {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.bt-workspace {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.bt-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 16px;
  background: var(--color-bg-elevated);
  position: sticky;
  top: 0;
}

.bt-config-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.bt-config-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.bt-config-head span {
  font-size: 12px;
  color: var(--color-accent);
}

.bt-strategies {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bt-strategy {
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg);
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--color-text);
  transition: border-color 0.15s ease;
}

.bt-strategy strong {
  font-size: 13.5px;
}

.bt-strategy span {
  font-size: 11.5px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.bt-strategy-active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg));
}

.bt-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bt-field label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.bt-field input {
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
}

.bt-field input:focus {
  border-color: var(--color-accent);
}

.bt-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.bt-run {
  appearance: none;
  border: 0;
  border-radius: 12px;
  background: var(--color-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  padding: 11px 14px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    transform 0.2s ease;
}

.bt-run:hover {
  background: var(--color-accent-hover);
}

.bt-run:active {
  transform: scale(0.99);
}

.bt-run:disabled {
  opacity: 0.6;
  cursor: default;
}

.bt-error {
  margin: 0;
  font-size: 12px;
  color: var(--color-up);
  line-height: 1.5;
}

.bt-result {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.bt-empty {
  padding: 28px 20px;
  border: 1px dashed var(--color-border);
  border-radius: 14px;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.8;
  text-align: center;
}
.bt-chart-card,
.bt-table-card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 14px 16px;
  background: var(--color-bg-elevated);
  min-width: 0;
}

.bt-chart-card header,
.bt-table-card header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.bt-chart-card h3,
.bt-table-card h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.bt-chart-card header span,
.bt-table-card header span {
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.bt-chart {
  width: 100%;
  height: 220px;
  display: block;
}

.bt-grid-line {
  stroke: var(--color-border);
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.bt-equity {
  fill: none;
  stroke: var(--color-up);
  stroke-width: 2;
}

.bt-bench {
  fill: none;
  stroke: var(--color-text-muted);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
}

.bt-drawdown {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 2;
}

.bt-legend {
  display: flex;
  gap: 16px;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.bt-legend span::before {
  content: "";
  display: inline-block;
  width: 16px;
  height: 3px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
}

.bt-legend-equity::before {
  background: var(--color-up);
}

.bt-legend-bench::before {
  background: var(--color-text-muted);
}

.bt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.bt-table th {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  padding: 7px 8px;
  white-space: nowrap;
}

.bt-table td {
  padding: 7px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
  white-space: nowrap;
}

.bt-table tbody tr {
  cursor: pointer;
}

.bt-table tbody tr:hover {
  background: color-mix(in srgb, var(--color-accent) 7%, transparent);
}

.bt-code {
  color: var(--color-accent);
}

.bt-muted {
  color: var(--color-text-muted);
}

.bt-panel {
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bt-panel-head h2 {
  margin: 0;
  font-size: 18px;
}

.bt-panel-head p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.bt-panel-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.bt-panel-actions input {
  flex: 1;
  max-width: 420px;
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
  font-size: 13px;
  padding: 9px 11px;
  outline: none;
}

.bt-panel-actions input:focus {
  border-color: var(--color-accent);
}

.bt-signal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.bt-signal {
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg-elevated);
  padding: 12px 14px;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--color-text);
  transition: border-color 0.15s ease;
}

.bt-signal:hover {
  border-color: var(--color-accent);
}

.bt-signal-name {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.bt-signal-name strong {
  font-size: 15px;
}

.bt-signal-name em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--color-accent);
}

.bt-signal-state {
  align-self: flex-start;
  font-size: 12px;
  font-weight: 700;
  border-radius: 999px;
  padding: 3px 10px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.bt-signal-state.up {
  color: var(--color-up);
  border-color: color-mix(in srgb, var(--color-up) 45%, var(--color-border));
}

.bt-signal-state.down {
  color: var(--color-down);
  border-color: color-mix(in srgb, var(--color-down) 45%, var(--color-border));
}

.bt-signal-meta {
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.bt-signal-detail {
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.bt-rules {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.bt-rule {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--color-bg-elevated);
}

.bt-rule-icon {
  font-size: 18px;
  line-height: 1;
}

.bt-rule strong {
  display: block;
  font-size: 13px;
  margin-bottom: 3px;
}

.bt-rule em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.up {
  color: var(--color-up);
}

.down {
  color: var(--color-down);
}

/* Apple / Gemini 玻璃主题 */
:global(html[data-theme="apple"]) .bt-page,
:global(html[data-theme="apple-dark"]) .bt-page,
:global(html[data-theme="gemini-light"]) .bt-page,
:global(html[data-theme="gemini"]) .bt-page,
:global(html[data-theme="goose"]) .bt-page {
  background: transparent;
}

:global(html[data-theme="apple"]) .bt-card,
:global(html[data-theme="apple-dark"]) .bt-card,
:global(html[data-theme="gemini-light"]) .bt-card,
:global(html[data-theme="gemini"]) .bt-card,
:global(html[data-theme="apple"]) .bt-config,
:global(html[data-theme="apple-dark"]) .bt-config,
:global(html[data-theme="gemini-light"]) .bt-config,
:global(html[data-theme="gemini"]) .bt-config,
:global(html[data-theme="apple"]) .bt-chart-card,
:global(html[data-theme="apple-dark"]) .bt-chart-card,
:global(html[data-theme="gemini-light"]) .bt-chart-card,
:global(html[data-theme="gemini"]) .bt-chart-card,
:global(html[data-theme="apple"]) .bt-table-card,
:global(html[data-theme="apple-dark"]) .bt-table-card,
:global(html[data-theme="gemini-light"]) .bt-table-card,
:global(html[data-theme="gemini"]) .bt-table-card,
:global(html[data-theme="apple"]) .bt-signal,
:global(html[data-theme="apple-dark"]) .bt-signal,
:global(html[data-theme="gemini-light"]) .bt-signal,
:global(html[data-theme="gemini"]) .bt-signal,
:global(html[data-theme="apple"]) .bt-rule,
:global(html[data-theme="apple-dark"]) .bt-rule,
:global(html[data-theme="gemini-light"]) .bt-rule,
:global(html[data-theme="gemini"]) .bt-rule,
:global(html[data-theme="apple"]) .bt-tab,
:global(html[data-theme="apple-dark"]) .bt-tab,
:global(html[data-theme="gemini-light"]) .bt-tab,
:global(html[data-theme="gemini"]) .bt-tab {
  background: var(--glass-bg);
  background-color: var(--color-bg-elevated);
  border-color: var(--glass-border);
  border-radius: var(--radius-surface);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
}

:global(html[data-theme="goose"]) .bt-card,
:global(html[data-theme="goose"]) .bt-config,
:global(html[data-theme="goose"]) .bt-chart-card,
:global(html[data-theme="goose"]) .bt-table-card,
:global(html[data-theme="goose"]) .bt-signal,
:global(html[data-theme="goose"]) .bt-rule,
:global(html[data-theme="goose"]) .bt-tab {
  background: #fffceb;
  border-color: color-mix(in srgb, #96939b 42%, #faf4d3);
}

@media (max-width: 1080px) {
  .bt-workspace {
    grid-template-columns: 1fr;
  }

  .bt-config {
    position: static;
  }
}

@media (max-width: 860px) {
  .bt-hero {
    flex-direction: column;
    align-items: stretch;
  }

  .bt-hero-meta {
    justify-content: flex-start;
  }

  .bt-tabs {
    grid-template-columns: 1fr 1fr;
  }
}
</style>