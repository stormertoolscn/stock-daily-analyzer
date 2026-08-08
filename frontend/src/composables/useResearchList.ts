import { computed, ref, watch } from "vue";

export interface ResearchStock {
  code: string;
  name: string;
  price: number;
  changePct: number;
  addedAt: string;
}

const STORAGE_KEY = "sda-research-list";

function normalizeStockCode(code: string): string | null {
  let s = code.trim().toUpperCase();
  if (!s) return null;
  const paren = s.match(/\((?:SH|SZ|BJ)[:：]?(\d{6})\)/);
  if (paren) return paren[1];
  s = s.replace(/^(?:SH|SZ|BJ|A)[:：]?/, "");
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 6) return digits.slice(-6);
  return null;
}

function loadInitial(): ResearchStock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ResearchStock[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** 重点研究清单（与 K 线自选分离，localStorage 持久化） */
export function useResearchList() {
  const list = ref<ResearchStock[]>(loadInitial());
  const activeCode = ref(list.value[0]?.code ?? "");

  watch(
    list,
    (next) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    { deep: true },
  );

  const active = computed(
    () => list.value.find((s) => s.code === activeCode.value) ?? list.value[0] ?? null,
  );

  function select(code: string) {
    activeCode.value = code;
  }

  function has(code: string): boolean {
    const n = normalizeStockCode(code);
    return Boolean(n && list.value.some((s) => s.code === n));
  }

  function addStock(
    code: string,
    name?: string | null,
    quote?: { price?: number; changePct?: number },
  ): { ok: boolean; message: string } {
    const normalized = normalizeStockCode(code);
    if (!normalized) {
      return { ok: false, message: "无效股票代码" };
    }
    const displayName = (name && name.trim()) || normalized;
    const existed = list.value.find((s) => s.code === normalized);
    if (existed) {
      if (name) existed.name = displayName;
      if (quote?.price != null) existed.price = quote.price;
      if (quote?.changePct != null) existed.changePct = quote.changePct;
      activeCode.value = normalized;
      return { ok: true, message: `${existed.name} 已在重点研究中` };
    }
    list.value = [
      {
        code: normalized,
        name: displayName,
        price: quote?.price ?? 0,
        changePct: quote?.changePct ?? 0,
        addedAt: new Date().toISOString(),
      },
      ...list.value,
    ];
    activeCode.value = normalized;
    return { ok: true, message: `已加入重点研究：${displayName}` };
  }

  function remove(code: string) {
    const n = normalizeStockCode(code) || code;
    list.value = list.value.filter((s) => s.code !== n);
    if (activeCode.value === n) {
      activeCode.value = list.value[0]?.code ?? "";
    }
  }

  function updateQuote(
    code: string,
    price: number,
    changePct: number,
    name?: string | null,
  ) {
    const item = list.value.find((s) => s.code === code);
    if (!item) return;
    item.price = price;
    item.changePct = changePct;
    if (name) item.name = name;
  }

  return {
    list,
    activeCode,
    active,
    select,
    has,
    addStock,
    remove,
    updateQuote,
  };
}
