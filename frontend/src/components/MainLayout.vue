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
  <div class="flex h-screen overflow-hidden">
    <aside
      class="flex w-56 shrink-0 flex-col border-r border-border bg-bg-sidebar"
    >
      <div class="px-5 py-4 text-lg font-semibold">股票日报助手</div>
      <nav class="flex flex-col gap-1 px-3">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="rounded-md px-3 py-2 text-sm transition-colors"
          :class="
            route.path === item.path
              ? 'bg-accent text-white'
              : 'text-text hover:bg-bg'
          "
        >
          {{ item.label }}
        </router-link>
      </nav>
    </aside>

    <div class="flex flex-1 flex-col overflow-hidden">
      <header
        class="flex h-14 shrink-0 items-center justify-end border-b border-border bg-bg-elevated px-6"
      >
        <label class="flex items-center gap-2 text-sm text-text-muted">
          主题
          <select
            v-model="themeMode"
            class="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option
              v-for="opt in themeOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </label>
      </header>

      <main class="flex-1 overflow-auto bg-bg p-6">
        <router-view />
      </main>
    </div>
  </div>
</template>
