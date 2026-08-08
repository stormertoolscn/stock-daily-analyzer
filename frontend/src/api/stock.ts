import type { ChartMode, KlineBar } from "@/kline-engine";
import type { KlinePeriod } from "@/utils/mockKline";

export interface KlineApiResponse {
  code: string;
  name: string | null;
  period: KlinePeriod;
  chart_type: ChartMode;
  adjust: "qfq" | "hfq" | "none";
  adjust_applied: "qfq" | "hfq" | "none";
  source: string;
  prev_close: number | null;
  trade_date: string | null;
  count: number;
  bars: KlineBar[];
}

/** 会话内 K 线内存缓存：切回看过的股票秒开；日/周/月 K 10 分钟内不过期 */
const KLINE_CACHE_TTL_MS = 10 * 60 * 1000;
const klineCache = new Map<string, { at: number; data: KlineApiResponse }>();

function klineCacheKey(
  code: string,
  period: KlinePeriod,
  adjust: string,
  tradeDate?: string | null,
): string {
  return `${code}|${period}|${adjust}|${tradeDate ?? ""}`;
}

export interface StockSearchItem {
  code: string;
  name: string;
  pinyin: string;
  initials: string;
  market?: string | null;
}

export interface StockSearchResponse {
  query: string;
  items: StockSearchItem[];
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function readError(res: Response): Promise<string> {
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { detail?: string };
    if (body.detail) detail = body.detail;
  } catch {
    /* ignore */
  }
  return detail;
}

export async function fetchStockKline(
  code: string,
  period: KlinePeriod,
  adjust: "qfq" | "hfq" | "none" = "qfq",
  signal?: AbortSignal,
  opts?: { tradeDate?: string | null },
): Promise<KlineApiResponse> {
  const params = new URLSearchParams({ period, adjust });
  if (period === "intraday" && opts?.tradeDate) {
    params.set("trade_date", opts.tradeDate);
  }
  const cacheable = period !== "intraday";
  const key = klineCacheKey(code, period, adjust, opts?.tradeDate);
  if (cacheable) {
    const hit = klineCache.get(key);
    if (hit && Date.now() - hit.at < KLINE_CACHE_TTL_MS) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return hit.data;
    }
  }
  const res = await fetch(`/api/stock/${encodeURIComponent(code)}/kline?${params}`, {
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  const payload = (await res.json()) as KlineApiResponse;
  if (cacheable && payload.bars?.length) {
    klineCache.set(key, { at: Date.now(), data: payload });
  }
  return payload;
}

export async function searchStocks(
  query: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<StockSearchItem[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, limit: String(limit) });
  const res = await fetch(`/api/stock/search?${params}`, { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  const data = (await res.json()) as StockSearchResponse;
  return data.items;
}

export interface StockBasicInfo {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  turnover: number;
  source: string;
}

export interface StockResearchReport {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  score: number;
  sentiment: string;
  operation_advice: string;
  trend_prediction: string;
  analysis_summary: string;
  strategy: {
    ideal_buy: string;
    secondary_buy: string;
    stop_loss: string;
    take_profit: string;
  };
  risks: string[];
  catalysts: string[];
  checklist: string[];
  data_view: { label: string; value: string }[];
  boards: string[];
  markdown: string;
  created_at: string;
  source: string;
  phase_label: string;
  model_used: string;
}

export async function fetchStockBasic(
  code: string,
  signal?: AbortSignal,
): Promise<StockBasicInfo> {
  const res = await fetch(`/api/stock/${encodeURIComponent(code)}/basic`, { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as StockBasicInfo;
}

export interface StockQuoteItem {
  code: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  source: string;
}

export async function fetchStockQuotes(
  codes: string[],
  signal?: AbortSignal,
): Promise<StockQuoteItem[]> {
  const uniq = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (!uniq.length) return [];
  const params = new URLSearchParams({ codes: uniq.join(",") });
  const res = await fetch(`/api/stock/quotes?${params}`, { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  const data = (await res.json()) as { items: StockQuoteItem[] };
  return data.items;
}

export async function fetchStockResearch(
  code: string,
  signal?: AbortSignal,
): Promise<StockResearchReport> {
  const res = await fetch(`/api/stock/${encodeURIComponent(code)}/research`, {
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as StockResearchReport;
}
