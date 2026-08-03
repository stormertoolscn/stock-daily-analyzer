import { ApiError } from "@/api/stock";

export type SeatKind = "institution" | "hotmoney" | "other";
export type SeatSide = "buy" | "sell";

export interface LhbDailyItem {
  code: string;
  name: string;
  trade_date: string;
  reason: string;
  insight: string;
  close: number;
  change_pct: number;
  net_buy: number;
  buy_amount: number;
  sell_amount: number;
  lhb_amount: number;
  market_amount: number;
  net_buy_ratio: number | null;
  turnover_ratio: number | null;
  turnover_rate: number | null;
  float_mv: number | null;
  ret_1d: number | null;
  ret_2d: number | null;
  ret_5d: number | null;
  ret_10d: number | null;
  source: string;
}

export interface LhbDailyResponse {
  trade_date: string;
  count: number;
  items: LhbDailyItem[];
  source: string;
}

export interface LhbSeatItem {
  rank: number;
  seat_name: string;
  buy_amount: number;
  sell_amount: number;
  net_amount: number;
  buy_ratio: number;
  sell_ratio: number;
  seat_kind: SeatKind;
  reason_type: string;
  side: SeatSide;
}

export interface LhbGraphNode {
  id: string;
  label: string;
  kind: "stock" | "seat";
  code?: string | null;
  full_label?: string | null;
  seat_kind?: SeatKind | null;
  amount: number;
}

export interface LhbGraphEdge {
  id: string;
  source: string;
  target: string;
  side: SeatSide;
  amount: number;
  label: string;
}

export interface LhbSeatDetailResponse {
  code: string;
  name: string;
  trade_date: string;
  buys: LhbSeatItem[];
  sells: LhbSeatItem[];
  graph: {
    trade_date: string;
    nodes: LhbGraphNode[];
    edges: LhbGraphEdge[];
  };
  source: string;
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

export async function fetchLhbDaily(
  tradeDate?: string | null,
  signal?: AbortSignal,
): Promise<LhbDailyResponse> {
  const params = new URLSearchParams();
  if (tradeDate) params.set("trade_date", tradeDate);
  const qs = params.toString();
  const res = await fetch(`/api/lhb/daily${qs ? `?${qs}` : ""}`, { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as LhbDailyResponse;
}

export async function fetchLhbSeats(
  code: string,
  opts?: { tradeDate?: string | null; name?: string | null; signal?: AbortSignal },
): Promise<LhbSeatDetailResponse> {
  const params = new URLSearchParams();
  if (opts?.tradeDate) params.set("trade_date", opts.tradeDate);
  if (opts?.name) params.set("name", opts.name);
  const qs = params.toString();
  const res = await fetch(
    `/api/lhb/${encodeURIComponent(code)}/seats${qs ? `?${qs}` : ""}`,
    { signal: opts?.signal },
  );
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as LhbSeatDetailResponse;
}

/** 金额格式化：亿元 / 万元 */
export function formatAmount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}
