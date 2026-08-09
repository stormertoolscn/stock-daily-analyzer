<script setup lang="ts"></script>

<template>
  <div class="home-page">
    <section class="home-hero">
      <p class="home-kicker">Stock Daily Analyzer</p>
      <h1>A股每日量化 + LLM 选股分析</h1>
      <p class="home-sub">
        龙虎榜席位、主力资金、数据量化工作台、策略回测、重点研究一屏尽览 —— 让数据驱动您的投资决策。
      </p>
      <div class="home-cta">
        <router-link class="home-btn home-btn-accent" to="/backtest">策略回测</router-link>
        <router-link class="home-btn home-btn-ghost" to="/capital-flow">资金复盘</router-link>
        <router-link class="home-btn home-btn-ghost" to="/quant">数据量化</router-link>
      </div>
    </section>

    <section class="home-banner">
      <div>
        <strong>10+ 功能模块</strong>
        <span>龙虎榜分析 · 资金复盘 · 数据量化 · 策略回测 · 重点研究 · K线复盘</span>
      </div>
      <router-link class="home-banner-link" to="/quant">进入数据量化 →</router-link>
    </section>

    <section class="home-grid">
      <div class="home-card">
        <h3>策略回测</h3>
        <p>双均线 / 放量突破 / 超卖反弹，历史数据验证收益、胜率与回撤。</p>
        <router-link class="home-card-link" to="/backtest">开始回测 →</router-link>
      </div>
      <div class="home-card">
        <h3>资金复盘</h3>
        <p>主力净流入榜、板块资金轮动、龙虎榜霸榜与游资动向。</p>
        <router-link class="home-card-link" to="/capital-flow">查看资金 →</router-link>
      </div>
      <div class="home-card">
        <h3>龙虎榜席位</h3>
        <p>日榜筛选 + 席位关系气泡图，机构 / 游资 / 通道一屏看清。</p>
        <router-link class="home-card-link" to="/lhb">查看龙虎榜 →</router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.home-hero {
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 36px 32px 30px;
  background: var(--color-bg-elevated);
  color: var(--color-text);
}

.home-kicker {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.home-hero h1 {
  margin: 8px 0 0;
  font-size: 34px;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.home-sub {
  margin: 12px 0 0;
  max-width: 44rem;
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text-muted);
}

.home-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.home-btn {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 10px 20px;
  font-size: 13.5px;
  font-weight: 650;
  text-decoration: none;
  transition:
    transform 0.2s ease,
    opacity 0.15s ease;
}

.home-btn:active {
  transform: scale(0.98);
}

.home-btn-accent {
  background: var(--color-accent);
  color: #fff;
}

.home-btn-accent:hover {
  opacity: 0.9;
}

.home-btn-ghost {
  border: 1px solid var(--color-border);
  color: var(--color-text);
  background: transparent;
}

.home-btn-ghost:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.home-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
  border-radius: 14px;
  padding: 16px 22px;
  background: color-mix(in srgb, var(--color-accent) 9%, var(--color-bg-elevated));
}

.home-banner strong {
  display: block;
  font-size: 15px;
  font-weight: 700;
}

.home-banner span {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.home-banner-link {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-accent);
  text-decoration: none;
}

.home-banner-link:hover {
  text-decoration: underline;
}

.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.home-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 18px 20px;
  background: var(--color-bg-elevated);
}

.home-card h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.home-card p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-muted);
}

.home-card-link {
  margin-top: 6px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--color-accent);
  text-decoration: none;
}

.home-card-link:hover {
  text-decoration: underline;
}
</style>