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
  const res = await fetch(`/api/stock/${encodeURIComponent(code)}/kline?${params}`, {
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as KlineApiResponse;
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
