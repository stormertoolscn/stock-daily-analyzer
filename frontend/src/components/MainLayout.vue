<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

type ThemeMode =
  | "light"
  | "dark"
  | "apple"
  | "apple-dark"
  | "gemini-light"
  | "gemini"
  | "goose"
  | "github"
  | "chrome"
  | "abi"
  | "auto";

const THEME_STORAGE_KEY = "sda-theme-mode";
const HEADER_PIN_KEY = "sda-header-pinned";
const HEADER_MODE_KEY = "sda-header-mode";

const navItems = [
  { path: "/", label: "首页" },
  { path: "/lhb", label: "龙虎榜分析" },
  { path: "/lhb-v3", label: "龙虎榜新版" },
  { path: "/kline", label: "K线复盘" },
  { path: "/capital-flow", label: "资金复盘" },
  { path: "/quant", label: "数据量化" },
  { path: "/research", label: "重点研究" },
  { path: "/backtest", label: "策略回测" },
];
const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "apple", label: "浅色苹果" },
  { value: "apple-dark", label: "深色苹果" },
  { value: "gemini-light", label: "浅色Gemini" },
  { value: "gemini", label: "深色Gemini" },
  { value: "goose", label: "鹅黄" },
  { value: "github", label: "GitHub" },
  { value: "chrome", label: "Chrome" },
  { value: "abi", label: "ABi研究" },
  { value: "auto", label: "跟随系统" },
];

const route = useRoute();
const themeMode = ref<ThemeMode>("auto");
const isLhbV3 = computed(() => route.path === "/lhb-v3");
const isResearch = computed(() => route.path === "/research");
const isCapitalFlow = computed(() => route.path === "/capital-flow");
const isKline = computed(() => route.path === "/kline");
const isBacktest = computed(() => route.path === "/backtest");
const isQuant = computed(() => route.path === "/quant");
const flushMain = computed(
  () =>
    isLhbV3.value ||
    isResearch.value ||
    isCapitalFlow.value ||
    isKline.value ||
    isQuant.value ||
    isBacktest.value,
);

/** 版头布局：left=左侧抽屉（feature），top=原顶部版头 */
const headerMode = ref<"left" | "top">(
  localStorage.getItem(HEADER_MODE_KEY) === "top" ? "top" : "left",
);

/** 钉子锁定后占位下沉；未锁定则为顶部浮动覆盖 */
const headerPinned = ref(localStorage.getItem(HEADER_PIN_KEY) === "1");
const headerRevealed = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** 左侧版头：默认收起，鼠标悬停左边缘拉出 */
const leftVisible = ref(false);
let leftHideTimer: ReturnType<typeof setTimeout> | null = null;

const brandVisible = computed(
  () => headerPinned.value || headerRevealed.value,
);

function clearHideTimer() {
  if (hideTimer != null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function revealHeader() {
  clearHideTimer();
  headerRevealed.value = true;
}

function scheduleHideHeader() {
  if (headerPinned.value) return;
  clearHideTimer();
  hideTimer = setTimeout(() => {
    headerRevealed.value = false;
    hideTimer = null;
  }, 220);
}

function toggleHeaderPin() {
  headerPinned.value = !headerPinned.value;
  if (headerPinned.value) {
    headerRevealed.value = true;
    leftVisible.value = true;
    clearHideTimer();
    clearLeftHideTimer();
  }
}

function clearLeftHideTimer() {
  if (leftHideTimer != null) {
    clearTimeout(leftHideTimer);
    leftHideTimer = null;
  }
}

function revealLeft() {
  clearLeftHideTimer();
  leftVisible.value = true;
}

function scheduleHideLeft() {
  if (headerPinned.value) return;
  clearLeftHideTimer();
  leftHideTimer = setTimeout(() => {
    leftVisible.value = false;
    leftHideTimer = null;
  }, 260);
}

function toggleHeaderMode() {
  headerMode.value = headerMode.value === "left" ? "top" : "left";
}

watch(headerPinned, (v) => {
  localStorage.setItem(HEADER_PIN_KEY, v ? "1" : "0");
});

watch(headerMode, (m) => {
  localStorage.setItem(HEADER_MODE_KEY, m);
});

const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function resolveTheme(mode: ThemeMode): Exclude<ThemeMode, "auto"> {
  if (mode === "auto") {
    return systemPrefersDark.matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", resolveTheme(mode));
}

function handleSystemChange() {
  if (themeMode.value === "auto") {
    applyTheme("auto");
  }
}

function selectTheme(mode: ThemeMode) {
  themeMode.value = mode;
}

watch(themeMode, (mode) => {
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyTheme(mode);
});

onMounted(() => {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  themeMode.value = saved ?? "auto";
  applyTheme(themeMode.value);
  systemPrefersDark.addEventListener("change", handleSystemChange);
  if (!headerPinned.value) headerRevealed.value = false;
});

onBeforeUnmount(() => {
  systemPrefersDark.removeEventListener("change", handleSystemChange);
  clearHideTimer();
  clearLeftHideTimer();
});
</script>

<template>
  <div
    class="app-shell flex h-screen flex-col overflow-hidden bg-bg"
    :class="{ 'app-shell-left-pinned': headerMode === 'left' && headerPinned }"
  >
    <!-- 顶部热区：顶部版头模式，未钉住时划入唤出 -->
    <div
      v-show="headerMode === 'top' && !headerPinned"
      class="header-hit"
      aria-hidden="true"
      @mouseenter="revealHeader"
    />

    <!-- 左侧热区：左侧版头模式，未钉住时悬停拉出 -->
    <div
      v-show="headerMode === 'left' && !headerPinned"
      class="left-hit"
      aria-hidden="true"
      @mouseenter="revealLeft"
    />

    <!-- 顶部版头：默认浮动覆盖；钉子锁定后才占位下沉 -->
    <div
      v-if="headerMode === 'top'"
      class="brand-bar shrink-0 bg-bg-elevated px-6 pt-5"
      :class="{
        'brand-bar-hidden': !brandVisible,
        'brand-bar-pinned': headerPinned,
        'brand-bar-float': !headerPinned,
      }"
      @mouseenter="revealHeader"
      @mouseleave="scheduleHideHeader"
    >
      <div class="flex items-start justify-between gap-4 pb-3">
        <div>
          <h1 class="text-xl font-semibold text-text">股票日报助手</h1>
          <p class="mt-1 text-sm text-text-muted">A股每日量化 + LLM 选股分析</p>
        </div>

        <div class="header-right">
          <div class="pill-group">
            <button
              v-for="opt in themeOptions"
              :key="opt.value"
              type="button"
              class="pill"
              :class="{ 'pill-active': themeMode === opt.value }"
              @click="selectTheme(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
          <button
            type="button"
            class="header-pin"
            :class="{ 'header-pin-on': headerPinned }"
            :title="headerPinned ? '取消固定（恢复浮动消隐）' : '固定顶栏（页面下沉衔接）'"
            :aria-pressed="headerPinned"
            @click="toggleHeaderPin"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M16 3a1 1 0 0 1 .8 1.6L14.4 9H17a1 1 0 0 1 .7 1.7L12.4 16v4.3a.7.7 0 0 1-1.4 0V16L6.3 10.7A1 1 0 0 1 7 9h2.6L7.2 4.6A1 1 0 0 1 8 3h8z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 左侧版头（feature）：默认收起，悬停左边缘拉出；钉子可固定 -->
    <aside
      v-if="headerMode === 'left'"
      class="left-header"
      :class="{ 'left-header-hidden': !leftVisible && !headerPinned }"
      @mouseenter="revealLeft"
      @mouseleave="scheduleHideLeft"
    >
      <div class="left-brand">
        <h1 class="text-xl font-semibold">股票日报助手</h1>
        <p class="mt-1 text-sm left-sub">A股每日量化 + LLM 选股分析</p>
      </div>

      <div class="left-themes">
        <span class="left-label">主题切换</span>
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          type="button"
          class="pill left-pill"
          :class="{ 'pill-active': themeMode === opt.value }"
          @click="selectTheme(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <div class="left-actions">
        <button
          type="button"
          class="header-pin"
          :class="{ 'header-pin-on': headerPinned }"
          :title="headerPinned ? '取消固定' : '固定左侧版头'"
          :aria-pressed="headerPinned"
          @click="toggleHeaderPin"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16 3a1 1 0 0 1 .8 1.6L14.4 9H17a1 1 0 0 1 .7 1.7L12.4 16v4.3a.7.7 0 0 1-1.4 0V16L6.3 10.7A1 1 0 0 1 7 9h2.6L7.2 4.6A1 1 0 0 1 8 3h8z"
            />
          </svg>
        </button>
        <button
          type="button"
          class="left-mode-btn"
          :title="'切换回顶部版头'"
          @click="toggleHeaderMode"
        >
          顶部版头
        </button>
      </div>
    </aside>

    <!-- 导航：始终可见 -->
    <nav class="nav-pills shrink-0 bg-bg-elevated px-6 py-2.5" aria-label="主导航">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-pill"
        :class="{ 'nav-pill-active': route.path === item.path }"
      >
        {{ item.label }}
      </router-link>
      <button
        type="button"
        class="nav-mode-btn"
        :title="headerMode === 'left' ? '切换到顶部版头' : '切换到左侧版头'"
        @click="toggleHeaderMode"
      >
        {{ headerMode === 'left' ? '顶部版头' : '左侧版头' }}
      </button>
    </nav>

    <main
      class="flex min-h-0 flex-1 flex-col overflow-auto"
      :class="flushMain ? 'p-0' : 'p-6'"
    >
      <router-view v-slot="{ Component }">
        <keep-alive :include="['LhbV3']">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
}

/* 左侧版头钉住：主窗体右移给侧栏让位，避免内容被遮 */
.app-shell-left-pinned {
  padding-left: 180px;
}

.header-hit {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 12px;
  z-index: 70;
}

.left-hit {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 12px;
  z-index: 70;
}

.brand-bar {
  z-index: 60;
  background: var(--color-bg-elevated);
  transition:
    transform 0.26s ease,
    opacity 0.2s ease,
    box-shadow 0.26s ease,
    background 0.26s ease;
}

/* 未钉住：绝对定位浮动，不占文档流 → 下面页面不下沉 */
.brand-bar-float {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  /* 浮出时下边缘小阴影，表示盖在页面上 */
  box-shadow:
    0 4px 14px rgb(15 23 42 / 16%),
    0 1px 0 color-mix(in srgb, var(--color-border) 80%, transparent);
}

.brand-bar-float.brand-bar-hidden {
  box-shadow: none;
}

/* 钉住：回到文档流，页面自动下沉衔接 */
.brand-bar-pinned {
  position: relative;
  box-shadow: none;
  border-bottom: 1px solid var(--color-border);
}

.brand-bar-hidden {
  transform: translateY(calc(-100% - 4px));
  opacity: 0;
  pointer-events: none;
}

/* ---------- 左侧版头（feature） ---------- */
.left-header {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 65;
  width: 180px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 18px 18px;
  background: var(--color-bg-elevated);
  border-right: 1px solid var(--color-border);
  box-shadow:
    8px 0 24px rgb(15 23 42 / 14%),
    1px 0 0 color-mix(in srgb, var(--color-border) 80%, transparent);
  overflow-y: auto;
  transition:
    transform 0.26s ease,
    opacity 0.2s ease,
    box-shadow 0.26s ease;
}

.left-header-hidden {
  transform: translateX(-180px);
  opacity: 0;
  pointer-events: none;
  box-shadow: none;
}

.left-brand h1 {
  margin: 0;
  color: var(--color-text);
}

.left-sub {
  color: var(--color-text-muted);
  line-height: 1.5;
}

.left-themes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.left-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
}

.left-pill {
  width: 100%;
  justify-content: flex-start;
}

.left-actions {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.left-mode-btn {
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 7px 12px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}

.left-mode-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.nav-mode-btn {
  margin-left: auto;
  appearance: none;
  border: 1px dashed var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}

.nav-mode-btn:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

/* Apple / Gemini：版头与导航使用 Liquid Glass */
:global(html[data-theme="apple"]) .brand-bar,
:global(html[data-theme="apple-dark"]) .brand-bar,
:global(html[data-theme="gemini-light"]) .brand-bar,
:global(html[data-theme="gemini"]) .brand-bar,
:global(html[data-theme="apple"]) .left-header,
:global(html[data-theme="apple-dark"]) .left-header,
:global(html[data-theme="gemini-light"]) .left-header,
:global(html[data-theme="gemini"]) .left-header,
:global(html[data-theme="apple"]) .nav-pills,
:global(html[data-theme="apple-dark"]) .nav-pills,
:global(html[data-theme="gemini-light"]) .nav-pills,
:global(html[data-theme="gemini"]) .nav-pills {
  background: var(--glass-bg);
  background-color: var(--color-bg-elevated);
  border-color: var(--glass-border);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
}

:global(html[data-theme="apple"]) .brand-bar-float,
:global(html[data-theme="apple-dark"]) .brand-bar-float,
:global(html[data-theme="gemini-light"]) .brand-bar-float,
:global(html[data-theme="gemini"]) .brand-bar-float {
  box-shadow: var(--glass-shadow);
}

:global(html[data-theme="apple"]) .nav-pill,
:global(html[data-theme="apple-dark"]) .nav-pill,
:global(html[data-theme="gemini-light"]) .nav-pill,
:global(html[data-theme="gemini"]) .nav-pill {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
}

:global(html[data-theme="apple"]) .nav-pill:active,
:global(html[data-theme="apple-dark"]) .nav-pill:active,
:global(html[data-theme="gemini-light"]) .nav-pill:active,
:global(html[data-theme="gemini"]) .nav-pill:active {
  transform: scale(0.98);
}

:global(html[data-theme="apple"]) .app-shell,
:global(html[data-theme="apple-dark"]) .app-shell,
:global(html[data-theme="gemini-light"]) .app-shell,
:global(html[data-theme="gemini"]) .app-shell,
:global(html[data-theme="goose"]) .app-shell {
  background: transparent;
}

:global(html[data-theme="goose"]) .brand-bar,
:global(html[data-theme="goose"]) .left-header,
:global(html[data-theme="goose"]) .nav-pills {
  background: #fffceb;
  border-color: color-mix(in srgb, #96939b 42%, #faf4d3);
}

.header-right {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.header-pin {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-top: 2px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.2s ease;
}

.header-pin svg {
  transform: rotate(45deg);
  transition: transform 0.2s ease;
}

.header-pin:hover {
  color: var(--color-text);
  border-color: var(--color-accent);
}

.header-pin-on {
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
  background: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg));
}

.header-pin-on svg {
  transform: rotate(0deg);
}

.nav-pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  border-bottom: 1px solid var(--color-border);
  z-index: 40;
}

.nav-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.nav-pill:hover {
  color: var(--color-text);
}

.nav-pill-active {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  font-weight: 600;
}
</style>
