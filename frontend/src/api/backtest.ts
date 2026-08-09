import { ApiError } from "@/api/stock";

export interface BacktestStrategyParams {
  ma_short: number;
  ma_long: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  initial_cash: number;
}

export interface BacktestStrategy {
  id: string;
  name: string;
  desc: string;
  params: BacktestStrategyParams;
}

export interface BacktestParams {
  ma_short: number;
  ma_long: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  initial_cash: number;
  start_date: string;
}

export interface BacktestTrade {
  date: string;
  code: string;
  name: string;
  action: "buy" | "sell";
  price: number;
  shares: number;
  amount: number;
  pnl: number;
  return_pct: number;
  reason: string;
}

export interface BacktestCurvePoint {
  date: string;
  equity?: number;
  drawdown?: number;
}

export interface BacktestPerStock {
  code: string;
  name: string;
  total_return: number;
  max_drawdown: number;
  trade_count: number;
  win_rate: number;
}

export interface BacktestRunResult {
  ok: boolean;
  error: string;
  strategy: string;
  strategy_name: string;
  stats: Record<string, number>;
  equity_curve: BacktestCurvePoint[];
  benchmark_curve: BacktestCurvePoint[];
  drawdown_curve: BacktestCurvePoint[];
  trades: BacktestTrade[];
  per_stock: BacktestPerStock[];
  errors: string[];
  codes: string[];
}

export interface BacktestSignal {
  code: string;
  name: string;
  signal: string;
  date: string;
  close: number;
  detail: string;
  strategy: string;
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

export async function fetchBacktestStrategies(
  signal?: AbortSignal,
): Promise<BacktestStrategy[]> {
  const res = await fetch("/api/backtest/strategies", { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  const data = (await res.json()) as { items: BacktestStrategy[] };
  return data.items ?? [];
}

export async function runBacktest(
  payload: {
    strategy: string;
    codes: string;
    params: BacktestParams;
  },
  signal?: AbortSignal,
): Promise<BacktestRunResult> {
  const res = await fetch("/api/backtest/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as BacktestRunResult;
}

export async function fetchBacktestSignals(
  codes: string,
  strategy: string,
  signal?: AbortSignal,
): Promise<BacktestSignal[]> {
  const params = new URLSearchParams({ codes, strategy });
  const res = await fetch(`/api/backtest/signals?${params}`, { signal });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as BacktestSignal[];
}

/** 金额格式化：亿 / 万 */
export function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatPct2(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}