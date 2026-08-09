"""策略回测引擎：双均线 / 放量突破 / 超卖反弹（日线前复权，T+1 简化）。"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from app.services.ohlc import fetch_kline
from app.services.stock_meta import lookup_name

DEFAULT_STRATEGIES: list[dict[str, Any]] = [
    {
        "id": "ma_cross",
        "name": "双均线交叉",
        "desc": "短均线上穿长均线买入、下穿卖出，经典趋势跟踪。",
        "params": {
            "ma_short": 20,
            "ma_long": 60,
            "take_profit_pct": 30,
            "stop_loss_pct": 10,
            "initial_cash": 1000000,
        },
    },
    {
        "id": "volume_breakout",
        "name": "放量突破",
        "desc": "涨幅超 3% 且成交量放大 1.5 倍买入；跌破 20 日线或超买卖出。",
        "params": {
            "ma_short": 20,
            "ma_long": 60,
            "take_profit_pct": 20,
            "stop_loss_pct": 8,
            "initial_cash": 1000000,
        },
    },
    {
        "id": "oversold_rebound",
        "name": "超卖反弹",
        "desc": "RSI 低于 30 超卖买入，反弹至 70 以上卖出，波段抄底。",
        "params": {
            "ma_short": 14,
            "ma_long": 60,
            "take_profit_pct": 15,
            "stop_loss_pct": 6,
            "initial_cash": 1000000,
        },
    },
]


def list_strategies() -> list[dict[str, Any]]:
    return DEFAULT_STRATEGIES


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.fillna(50)


def _bars_to_df(bars: list[dict[str, Any]]) -> pd.DataFrame | None:
    if not bars or len(bars) < 80:
        return None
    df = pd.DataFrame(bars)
    df["date"] = pd.to_datetime(
        df["timestamp"], unit="ms", utc=True
    ).dt.tz_convert("Asia/Shanghai").dt.strftime("%Y-%m-%d")
    df = df.dropna(subset=["open", "high", "low", "close", "volume"]).reset_index(drop=True)
    if len(df) < 60:
        return None
    return df


def _signal_series(df: pd.DataFrame, strategy: str, p: dict[str, Any]) -> pd.Series:
    sig = pd.Series(0, index=df.index, dtype=float)
    if strategy == "ma_cross":
        short = df["close"].rolling(int(p.get("ma_short", 20))).mean()
        long = df["close"].rolling(int(p.get("ma_long", 60))).mean()
        prev_s, prev_l = short.shift(1), long.shift(1)
        sig[(prev_s <= prev_l) & (short > long)] = 1
        sig[(prev_s >= prev_l) & (short < long)] = -1
    elif strategy == "volume_breakout":
        ma20 = df["close"].rolling(20).mean()
        vol_ma = df["volume"].rolling(20).mean()
        rsi = _rsi(df["close"], int(p.get("rsi_period", 14)))
        breakout = (df["close"] > df["close"].shift(1) * 1.03) & (
            df["volume"] > vol_ma * 1.5
        )
        sig[breakout & (rsi < 75)] = 1
        sig[(df["close"] < ma20) | (rsi > 80)] = -1
    elif strategy == "oversold_rebound":
        rsi = _rsi(df["close"], int(p.get("rsi_period", 14)))
        sig[rsi < 30] = 1
        sig[rsi > 70] = -1
    return sig


def _run_one(
    code: str,
    name: str,
    bars: list[dict[str, Any]],
    strategy: str,
    p: dict[str, Any],
    initial_cash: float,
    start_date: str,
) -> dict[str, Any] | None:
    df = _bars_to_df(bars)
    if df is None:
        return None
    if start_date:
        df = df[df["date"] >= start_date].reset_index(drop=True)
    if len(df) < 60:
        return None

    sig = _signal_series(df, strategy, p)
    tp = float(p.get("take_profit_pct", 20)) / 100
    sl = float(p.get("stop_loss_pct", 8)) / 100

    cash = float(initial_cash)
    shares = 0
    cost = 0.0
    trades: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    drawdown: list[dict[str, Any]] = []
    benchmark: list[dict[str, Any]] = []
    peak = -math.inf
    first_close: float | None = None

    for i in range(len(df)):
        row = df.iloc[i]
        price = float(row["close"])
        date = str(row["date"])
        action = ""
        reason = ""
        if shares > 0:
            ret = price / cost - 1 if cost > 0 else 0.0
            if tp > 0 and ret >= tp:
                action, reason = "sell", "止盈"
            elif sl > 0 and ret <= -sl:
                action, reason = "sell", "止损"
            elif sig.iloc[i] < 0:
                action, reason = "sell", "信号卖出"
        if shares == 0 and sig.iloc[i] > 0:
            action, reason = "buy", "信号买入"

        if action == "buy":
            lots = int(cash / (price * 100))
            shares = lots * 100
            if shares >= 100:
                cash -= shares * price
                cost = price
                trades.append(
                    {
                        "date": date,
                        "code": code,
                        "name": name,
                        "action": "buy",
                        "price": round(price, 3),
                        "shares": shares,
                        "amount": round(shares * price, 2),
                        "pnl": 0.0,
                        "return_pct": 0.0,
                        "reason": reason,
                    }
                )
        elif action == "sell" and shares > 0:
            pnl = (price - cost) * shares
            ret_pct = (price / cost - 1) * 100 if cost > 0 else 0.0
            cash += shares * price
            trades.append(
                {
                    "date": date,
                    "code": code,
                    "name": name,
                    "action": "sell",
                    "price": round(price, 3),
                    "shares": shares,
                    "amount": round(shares * price, 2),
                    "pnl": round(pnl, 2),
                    "return_pct": round(ret_pct, 2),
                    "reason": reason,
                }
            )
            shares = 0
            cost = 0.0

        eq = cash + shares * price
        equity.append({"date": date, "equity": round(eq, 2)})
        if first_close is None:
            first_close = price
        hold_eq = initial_cash * (price / first_close) if first_close else initial_cash
        benchmark.append({"date": date, "equity": round(hold_eq, 2)})
        if eq > peak:
            peak = eq
        dd_val = (eq / peak - 1) * 100 if peak > 0 else 0.0
        drawdown.append({"date": date, "drawdown": round(dd_val, 2)})

    if len(equity) < 2:
        return None
    eq_series = pd.Series([e["equity"] for e in equity])
    total_return = eq_series.iloc[-1] / initial_cash - 1
    n = len(eq_series)
    daily = eq_series.pct_change().dropna()
    sharpe = 0.0
    if len(daily) > 1 and daily.std() > 0:
        sharpe = float(daily.mean() / daily.std() * math.sqrt(252))
    max_dd = min((d["drawdown"] for d in drawdown), default=0.0)
    wins = [t for t in trades if t["return_pct"] > 0]
    win_rate = len(wins) / len(trades) * 100 if trades else 0.0
    annual = (1 + total_return) ** (252 / max(n, 1)) - 1

    return {
        "code": code,
        "name": name,
        "stats": {
            "total_return": round(total_return * 100, 2),
            "annual_return": round(annual * 100, 2),
            "sharpe": round(sharpe, 2),
            "max_drawdown": round(float(max_dd), 2),
            "win_rate": round(win_rate, 1),
            "trade_count": len(trades),
            "final_equity": round(float(eq_series.iloc[-1]), 2),
        },
        "equity": equity,
        "drawdown": drawdown,
        "benchmark": benchmark,
        "trades": trades,
    }


def _merge_series(
    parts: list[dict[str, Any]], initial_cash: float
) -> list[dict[str, Any]]:
    """多标的等权净值合并：按日期累加。"""
    by_date: dict[str, float] = {}
    for part in parts:
        for item in part["equity"]:
            by_date[item["date"]] = by_date.get(item["date"], 0.0) + item["equity"]
    dates = sorted(by_date)
    return [{"date": d, "equity": round(by_date[d], 2)} for d in dates]


def _benchmark_series(
    parts: list[dict[str, Any]], initial_cash: float
) -> list[dict[str, Any]]:
    """等权买入持有基准：每只按首日价建仓。"""
    per = initial_cash / len(parts)
    by_date: dict[str, float] = {}
    for part in parts:
        for item in part.get("benchmark") or part["equity"]:
            by_date[item["date"]] = by_date.get(item["date"], 0.0) + float(item["equity"])
    dates = sorted(by_date)
    return [{"date": d, "equity": round(by_date[d], 2)} for d in dates]


def run_backtest(
    *,
    strategy: str,
    codes: list[str],
    params: dict[str, Any],
    initial_cash: float,
    start_date: str,
) -> dict[str, Any]:
    """运行多标的等权回测。"""
    parts: list[dict[str, Any]] = []
    errors: list[str] = []
    per = initial_cash / max(len(codes), 1)
    for raw in codes:
        code = raw.strip()
        if not code:
            continue
        try:
            payload = fetch_kline(code, ui_period="day", adjust="qfq")
            name = payload.get("name") or lookup_name(code) or code
            part = _run_one(
                code,
                name,
                payload.get("bars") or [],
                strategy,
                params,
                per,
                start_date,
            )
            if part is not None:
                parts.append(part)
            else:
                errors.append(f"{code} 数据不足")
        except LookupError as exc:
            errors.append(f"{code}: {exc}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{code}: {exc}")

    if not parts:
        return {
            "ok": False,
            "error": "没有可回测的标的" + ("；" + "；".join(errors) if errors else ""),
        }

    equity = _merge_series(parts, initial_cash)
    benchmark = _benchmark_series(parts, initial_cash)
    all_trades = [t for p in parts for t in p["trades"]]
    all_trades.sort(key=lambda t: t["date"])

    eq_values = [e["equity"] for e in equity]
    total_return = eq_values[-1] / initial_cash - 1 if eq_values else 0.0
    n = len(eq_values)
    daily = pd.Series(eq_values).pct_change().dropna()
    sharpe = 0.0
    if len(daily) > 1 and daily.std() > 0:
        sharpe = float(daily.mean() / daily.std() * math.sqrt(252))
    dd_series: list[float] = []
    peak = -math.inf
    for v in eq_values:
        peak = max(peak, v)
        dd_series.append((v / peak - 1) * 100 if peak > 0 else 0.0)
    max_dd = min(dd_series, default=0.0)
    wins = [t for t in all_trades if t["return_pct"] > 0]
    win_rate = len(wins) / len(all_trades) * 100 if all_trades else 0.0
    annual = (1 + total_return) ** (252 / max(n, 1)) - 1 if n > 0 else 0.0

    bench_values = [b["equity"] for b in benchmark]
    bench_total = bench_values[-1] / initial_cash - 1 if bench_values else 0.0

    return {
        "ok": True,
        "strategy": strategy,
        "strategy_name": next(
            (s["name"] for s in DEFAULT_STRATEGIES if s["id"] == strategy), strategy
        ),
        "stats": {
            "total_return": round(total_return * 100, 2),
            "annual_return": round(annual * 100, 2),
            "sharpe": round(sharpe, 2),
            "max_drawdown": round(float(max_dd), 2),
            "win_rate": round(win_rate, 1),
            "trade_count": len(all_trades),
            "benchmark_return": round(bench_total * 100, 2),
            "final_equity": round(float(eq_values[-1]), 2) if eq_values else 0.0,
        },
        "equity_curve": equity,
        "benchmark_curve": benchmark,
        "drawdown_curve": [
            {"date": d["date"], "drawdown": round(dd, 2)}
            for d, dd in zip(equity, dd_series)
        ],
        "trades": all_trades,
        "per_stock": [
            {
                "code": p["code"],
                "name": p["name"],
                "total_return": p["stats"]["total_return"],
                "max_drawdown": p["stats"]["max_drawdown"],
                "trade_count": p["stats"]["trade_count"],
                "win_rate": p["stats"]["win_rate"],
            }
            for p in parts
        ],
        "errors": errors,
        "codes": [p["code"] for p in parts],
    }


def fetch_signals(codes: list[str], strategy: str = "ma_cross") -> list[dict[str, Any]]:
    """当前信号快照：最近一次买入/卖出信号与关键指标。"""
    defaults = next(
        (s["params"] for s in DEFAULT_STRATEGIES if s["id"] == strategy), {}
    )
    out: list[dict[str, Any]] = []
    for raw in codes:
        code = raw.strip()
        if not code:
            continue
        try:
            payload = fetch_kline(code, ui_period="day", adjust="qfq")
            name = payload.get("name") or lookup_name(code) or code
            df = _bars_to_df(payload.get("bars") or [])
            if df is None:
                continue
            sig = _signal_series(df, strategy, defaults)
            last = df.iloc[-1]
            signal = "观望"
            signal_date = str(last["date"])
            for i in range(len(df) - 1, max(0, len(df) - 60), -1):
                if sig.iloc[i] == 1:
                    signal = "买入"
                    signal_date = str(df.iloc[i]["date"])
                    break
                if sig.iloc[i] == -1:
                    signal = "卖出"
                    signal_date = str(df.iloc[i]["date"])
                    break
            detail = ""
            if strategy == "ma_cross":
                short = df["close"].rolling(int(defaults.get("ma_short", 20))).mean()
                long = df["close"].rolling(int(defaults.get("ma_long", 60))).mean()
                detail = f"MA{int(defaults.get('ma_short', 20))}={short.iloc[-1]:.2f} / MA{int(defaults.get('ma_long', 60))}={long.iloc[-1]:.2f}"
            elif strategy == "volume_breakout":
                rsi = _rsi(df["close"]).iloc[-1]
                detail = f"RSI14={rsi:.1f}"
            elif strategy == "oversold_rebound":
                rsi = _rsi(df["close"]).iloc[-1]
                detail = f"RSI14={rsi:.1f}"
            out.append(
                {
                    "code": code,
                    "name": name,
                    "signal": signal,
                    "date": signal_date,
                    "close": round(float(last["close"]), 3),
                    "detail": detail,
                    "strategy": strategy,
                }
            )
        except Exception:  # noqa: BLE001
            continue
    return out