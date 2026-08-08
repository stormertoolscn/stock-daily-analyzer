import { computed, ref, watch } from "vue";

export interface WatchStock {
  code: string;
  name: string;
  /** 最新价（展示用） */
  price: number;
  /** 涨跌幅 % */
  changePct: number;
}

const STORAGE_KEY = "sda-kline-watchlist";
const ACTIVE_KEY = "sda-kline-active";

/** 记住上次查看的股票，避免每次打开都回到默认股 */
function loadLastActive(): string {
  try {
    return (localStorage.getItem(ACTIVE_KEY) || "").trim();
  } catch {
    return "";
  }
}

/** 支持 688825 / SH:688825 / N长鑫(SH:688825) / A06978 */
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

function loadInitial(): WatchStock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WatchStock[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return [
    { code: "600221", name: "海航控股", price: 1.34, changePct: 0.75 },
    { code: "600519", name: "贵州茅台", price: 1688.0, changePct: -0.42 },
    { code: "000001", name: "平安银行", price: 11.26, changePct: 1.08 },
    { code: "300750", name: "宁德时代", price: 198.5, changePct: -1.22 },
  ];
}

export function useWatchlist(initialCode = "") {
  const list = ref<WatchStock[]>(loadInitial());
  const savedActive = loadLastActive();
  const savedInList = savedActive && list.value.some((s) => s.code === savedActive);
  const initial =
    initialCode.trim() || (savedInList ? savedActive : "") || list.value[0]?.code || "600221";
  const activeCode = ref(initial);

  watch(
    activeCode,
    (code) => {
      try {
        localStorage.setItem(ACTIVE_KEY, code);
      } catch {
        /* ignore */
      }
    },
  );

  watch(
    list,
    (next) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    { deep: true },
  );

  const active = computed(
    () => list.value.find((s) => s.code === activeCode.value) ?? list.value[0],
  );

  function select(code: string) {
    activeCode.value = code;
  }

  /** 用代码 + 中文名加入自选；名称缺失时先用代码占位，后续行情会回填。 */
  function addStock(
    code: string,
    name?: string | null,
  ): { ok: boolean; message: string } {
    const normalized = normalizeStockCode(code);
    if (!normalized) {
      return { ok: false, message: "请输入有效股票代码或拼音首字母" };
    }
    const displayName = (name && name.trim()) || normalized;
    const existed = list.value.find((s) => s.code === normalized);
    if (existed) {
      if (name) existed.name = name;
      activeCode.value = normalized;
      return { ok: true, message: `已切换到 ${existed.name}` };
    }
    list.value = [
      {
        code: normalized,
        name: displayName,
        price: 0,
        changePct: 0,
      },
      ...list.value,
    ];
    activeCode.value = normalized;
    return { ok: true, message: `已加入 ${displayName}` };
  }

  function remove(code: string) {
    list.value = list.value.filter((s) => s.code !== code);
    if (activeCode.value === code && list.value.length) {
      activeCode.value = list.value[0].code;
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
    addStock,
    remove,
    updateQuote,
  };
}
