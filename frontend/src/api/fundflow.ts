import { ApiError } from "@/api/stock";

export interface FundFlowStockItem {
  code: string;
  name: string;
  net_amount: number;
  change_pct: number;
  rank: number;
}

export interface FundFlowThemeItem {
  name: string;
  net_amount: number;
  side: "in" | "out";
  kind?: string;
}

export interface FundFlowReview {
  trade_date: string;
  session_label: string;
  summary: string;
  themes: FundFlowThemeItem[];
  inflows: FundFlowStockItem[];
  outflows: FundFlowStockItem[];
  inflow_total: number;
  outflow_total: number;
  source: string;
  updated_at: string;
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

export async function fetchFundFlowReview(
  refresh = false,
  signal?: AbortSignal,
): Promise<FundFlowReview> {
  const qs = refresh ? "?refresh=true" : "";
  const res = await fetch(`/api/fundflow/review${qs}`, { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as FundFlowReview;
}

export function formatFlowAmount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
  return `${sign}${abs.toFixed(0)}`;
}
