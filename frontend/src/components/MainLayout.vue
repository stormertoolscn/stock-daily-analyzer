<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

type ThemeMode = "light" | "dark" | "github" | "chrome" | "auto";

const THEME_STORAGE_KEY = "sda-theme-mode";

const navItems = [
  { path: "/", label: "首页" },
  { path: "/lhb", label: "龙虎榜分析" },
  { path: "/kline", label: "K线复盘" },
];

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "github", label: "GitHub" },
  { value: "chrome", label: "Chrome" },
  { value: "auto", label: "跟随系统" },
];

const route = useRoute();
const themeMode = ref<ThemeMode>("auto");

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
});

onBeforeUnmount(() => {
  systemPrefersDark.removeEventListener("change", handleSystemChange);
});
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-bg">
    <header class="shrink-0 bg-bg-elevated px-6 pt-5">
      <div class="flex items-start justify-between gap-4 pb-4">
        <div>
          <h1 class="text-xl font-semibold text-text">股票日报助手</h1>
          <p class="mt-1 text-sm text-text-muted">A股每日量化 + LLM 选股分析</p>
        </div>

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
      </div>

      <nav class="tab-bar">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="tab-item"
          :class="{ 'tab-item-active': route.path === item.path }"
        >
          {{ item.label }}
        </router-link>
      </nav>
    </header>

    <main class="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <router-view />
    </main>
  </div>
</template>
