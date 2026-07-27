from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

import pandas as pd

UiPeriod = Literal["intraday", "day", "week", "month"]

ANALYZER_ROOT = Path(__file__).resolve().parents[3] / "stock-daily-analyzer-main"

# UI 周期 -> 回溯日历天数（日线拉取窗口）；周/月再重采样
_LOOKBACK_DAYS: dict[str, int] = {
    "day": 5500,   # ~15 年，覆盖更长历史
    "week": 5500,
    "month": 7000,
}

# 接受缓存前至少要有这么多「日线」根数（月/周重采样前）
# 否则短缓存（分析器默认约 2 个月 / 旧 2 年窗）会挡住长历史
_MIN_DAILY_BARS: dict[str, int] = {
    "day": 800,
    "week": 1000,
    "month": 1500,
}

# 重采样后的最低根数（不足则视为数据异常）
_MIN_RESAMPLED_BARS: dict[str, int] = {
    "week": 40,
    "month": 24,
}


def _ensure_analyzer_on_path() -> None:
    root = str(ANALYZER_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


def _df_to_bars(df: pd.DataFrame, *, with_avg: bool = False) -> list[dict]:
    bars: list[dict] = []
    for idx, row in df.iterrows():
        ts = pd.Timestamp(idx)
        # 行情时间为中国交易时段的 naive datetime；按上海时区转毫秒，避免被当成 UTC
        if ts.tzinfo is None:
            ts = ts.tz_localize("Asia/Shanghai")
        item = {
            "timestamp": int(ts.timestamp() * 1000),
            "open": float(row["Open"]),
            "high": float(row["High"]),
            "low": float(row["Low"]),
            "close": float(row["Close"]),
            "volume": float(row["Volume"]),
        }
        if with_avg and "Avg" in df.columns and pd.notna(row.get("Avg")):
            item["avg"] = float(row["Avg"])
        if "Phase" in df.columns and pd.notna(row.get("Phase")):
            item["phase"] = str(row["Phase"])
        bars.append(item)
    return bars


def _resample(df: pd.DataFrame, ui_period: str) -> pd.DataFrame:
    if ui_period in ("day", "intraday"):
        return df
    rule = "W-FRI" if ui_period == "week" else "ME"
    out = (
        df.resample(rule)
        .agg(
            {
                "Open": "first",
                "High": "max",
                "Low": "min",
                "Close": "last",
                "Volume": "sum",
            }
        )
        .dropna(subset=["Open", "Close"])
    )
    return out


def _lookup_name(code: str) -> str | None:
    try:
        from app.services.stock_meta import lookup_name

        return lookup_name(code)
    except Exception:
        return None


def _secid(code: str) -> str:
    """东方财富 secid：沪 1.xxxxxx / 深京 0.xxxxxx。"""
    c = str(code).zfill(6)
    if c.startswith(("5", "6", "9")):
        return f"1.{c}"
    return f"0.{c}"


def _fetch_em_trends(code: str, *, with_auction: bool = True, ndays: int = 1) -> pd.DataFrame | None:
    """东方财富分时；iscr=1 时尽量带上 09:15 起的集合竞价点。"""
    import requests

    session = requests.Session()
    session.trust_env = False
    params = {
        "fields1": "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
        "ndays": max(1, min(5, int(ndays))),
        "iscr": 1 if with_auction else 0,
        "iscca": 0,
        "secid": _secid(code),
    }
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://quote.eastmoney.com/",
    }
    last_err: Exception | None = None
    for host in ("push2.eastmoney.com", "push2his.eastmoney.com"):
        url = f"https://{host}/api/qt/stock/trends2/get"
        try:
            resp = session.get(url, params=params, headers=headers, timeout=12)
            resp.raise_for_status()
            payload = resp.json()
            trends = (payload.get("data") or {}).get("trends") or []
            if not trends:
                continue
            rows: list[dict] = []
            for line in trends:
                parts = str(line).split(",")
                if len(parts) < 8:
                    continue
                ts = pd.Timestamp(parts[0])
                price = float(parts[2])
                high = float(parts[3])
                low = float(parts[4])
                vol = float(parts[5]) * 100  # 手 → 股
                amount = float(parts[6])
                avg = float(parts[7]) if parts[7] not in ("", "-", "None") else price
                open_ = float(parts[1]) if parts[1] not in ("", "-") else price
                rows.append(
                    {
                        "day": ts,
                        "Open": open_,
                        "High": high,
                        "Low": low,
                        "Close": price,
                        "Volume": vol,
                        "amount": amount,
                        "Avg": avg,
                    }
                )
            if not rows:
                continue
            df = pd.DataFrame(rows).set_index("day").sort_index()
            return df
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    if last_err:
        return None
    return None


def _is_auction_ts(ts: pd.Timestamp) -> bool:
    """早盘集合竞价 09:15–09:25（含）。"""
    hm = ts.hour * 100 + ts.minute
    return 915 <= hm <= 925


def _synthesize_auction(
    trade_date: date,
    *,
    open_price: float,
    prev_close: float,
    auction_volume: float,
) -> pd.DataFrame:
    """无真实竞价序列时，补 09:15–09:25 轴：价格由昨收过渡到开盘价，量落在 09:25。"""
    rows: list[dict] = []
    minutes = list(range(15, 26))  # 15..25
    for i, m in enumerate(minutes):
        ts = pd.Timestamp(
            year=trade_date.year,
            month=trade_date.month,
            day=trade_date.day,
            hour=9,
            minute=m,
        )
        # 09:15→09:25 线性靠向开盘价，模拟匹配价收敛
        t = i / (len(minutes) - 1)
        px = prev_close + (open_price - prev_close) * t
        vol = auction_volume if m == 25 else 0.0
        rows.append(
            {
                "day": ts,
                "Open": px,
                "High": px,
                "Low": px,
                "Close": px,
                "Volume": vol,
                "amount": vol * px,
                "Avg": px,
                "Phase": "auction",
            }
        )
    return pd.DataFrame(rows).set_index("day")


def _attach_auction_phase(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if "Phase" not in out.columns:
        out["Phase"] = "continuous"
    phases: list[str] = []
    for ts in out.index:
        phases.append("auction" if _is_auction_ts(pd.Timestamp(ts)) else "continuous")
    out["Phase"] = phases
    return out


def _fetch_intraday(code: str, trade_date: date | None = None) -> dict:
    """分时：集合竞价 + 连续竞价。trade_date 指定历史某日；空则取最新交易日。"""
    import akshare as ak
    from market_data import to_tencent_symbol

    from app.services.stock_meta import normalize_stock_code

    code = normalize_stock_code(code) or code
    source = "akshare_minute"
    session: pd.DataFrame | None = None
    prev_close: float | None = None
    target = trade_date

    # 1) 近几日：东方财富（ndays<=5，便于双击近日日K进分时）
    if target is None or (date.today() - target).days <= 5:
        em = _fetch_em_trends(
            code,
            with_auction=True,
            ndays=5 if target is not None else 1,
        )
        if em is not None and not em.empty:
            if target is not None:
                day_em = em[[pd.Timestamp(t).date() == target for t in em.index]]
                if not day_em.empty:
                    session = day_em
                    source = "eastmoney_trends"
            else:
                last_d = pd.Timestamp(em.index.max()).date()
                session = em[[pd.Timestamp(t).date() == last_d for t in em.index]]
                source = "eastmoney_trends"

    # 2) 回退腾讯/akshare 分钟
    if session is None or session.empty:
        symbol = to_tencent_symbol(code)
        raw = ak.stock_zh_a_minute(symbol=symbol, period="1", adjust="")
        if raw is None or raw.empty:
            raise LookupError(f"无法获取 {code} 的分时数据")
        df = raw.copy()
        df["day"] = pd.to_datetime(df["day"])
        for col in ("open", "high", "low", "close", "volume", "amount"):
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["close"])
        available_days = sorted(df["day"].dt.date.unique())
        if target is not None:
            if target not in available_days:
                raise LookupError(
                    f"{code} 无 {target.isoformat()} 分时（分钟源约保留近几日）"
                )
            pick = target
        else:
            pick = available_days[-1]
        day_df = df[df["day"].dt.date == pick].copy()
        if day_df.empty:
            raise LookupError(f"{code} {pick} 分时为空")
        prev_days = [d for d in available_days if d < pick]
        if prev_days:
            prev_session = df[df["day"].dt.date == prev_days[-1]]
            prev_close = float(prev_session.iloc[-1]["close"])
        else:
            prev_close = float(day_df.iloc[0]["open"])
        session = day_df.set_index("day").rename(
            columns={
                "open": "Open",
                "high": "High",
                "low": "Low",
                "close": "Close",
                "volume": "Volume",
            }
        )
        if "Avg" not in session.columns:
            session["Avg"] = pd.NA
        source = "akshare_minute"

    session = session.sort_index()
    trade_date = pd.Timestamp(session.index[0]).date()

    # 昨收兜底
    if prev_close is None or prev_close <= 0:
        try:
            from market_data import fetch_ohlc

            daily = fetch_ohlc(
                code,
                start=(trade_date - timedelta(days=20)).strftime("%Y%m%d"),
                end=trade_date.strftime("%Y%m%d"),
                min_bars=1,
                use_cache=True,
            )
            if daily is not None and len(daily) >= 2:
                before = daily[daily.index.date < trade_date]
                if not before.empty:
                    prev_close = float(before.iloc[-1]["Close"])
                else:
                    prev_close = float(daily.iloc[-2]["Close"])
            elif daily is not None and len(daily) == 1:
                prev_close = float(session.iloc[0]["Open"])
        except Exception:
            prev_close = float(session.iloc[0]["Open"])
    if prev_close is None or prev_close <= 0:
        prev_close = float(session.iloc[0]["Open"])

    session = _attach_auction_phase(session)
    has_real_auction = bool((session["Phase"] == "auction").any())

    if not has_real_auction:
        cont = session[session["Phase"] == "continuous"]
        if cont.empty:
            cont = session
        open_price = float(cont.iloc[0]["Open"] or cont.iloc[0]["Close"])
        open_vol = float(cont.iloc[0]["Volume"] or 0)
        auction_df = _synthesize_auction(
            trade_date,
            open_price=open_price,
            prev_close=float(prev_close),
            auction_volume=open_vol,
        )
        cont = cont.copy()
        first_idx = cont.index[0]
        cont.loc[first_idx, "Volume"] = 0.0
        if "amount" in cont.columns:
            cont.loc[first_idx, "amount"] = 0.0
        session = pd.concat([auction_df, cont]).sort_index()
        session = session[~session.index.duplicated(keep="last")]
        source = f"{source}+auction_synth"

    session = session.copy()
    if "amount" not in session.columns:
        session["amount"] = session["Close"] * session["Volume"]
    session["amount"] = pd.to_numeric(session["amount"], errors="coerce").fillna(0.0)
    session["Volume"] = pd.to_numeric(session["Volume"], errors="coerce").fillna(0.0)

    avg_vals: list[float] = []
    cum_amt = 0.0
    cum_vol = 0.0
    for _ts, row in session.iterrows():
        phase = str(row.get("Phase", "continuous"))
        px = float(row["Close"])
        vol = float(row["Volume"])
        amt = float(row["amount"]) if pd.notna(row.get("amount")) else px * vol
        if phase == "auction":
            avg_vals.append(px)
            continue
        cum_amt += amt
        cum_vol += vol
        avg_vals.append((cum_amt / cum_vol) if cum_vol > 0 else px)
    session["Avg"] = avg_vals

    bars = _df_to_bars(session, with_avg=True)
    auction_count = sum(1 for b in bars if b.get("phase") == "auction")

    return {
        "code": code,
        "name": _lookup_name(code),
        "period": "intraday",
        "chart_type": "intraday",
        "adjust": "none",
        "adjust_applied": "none",
        "source": source,
        "prev_close": float(prev_close),
        "trade_date": trade_date.isoformat(),
        "count": len(bars),
        "has_auction": auction_count > 0,
        "auction_count": auction_count,
        "bars": bars,
    }


def fetch_kline(
    code: str,
    *,
    ui_period: UiPeriod = "day",
    adjust: str = "qfq",
    min_bars: int = 20,
    trade_date: date | str | None = None,
) -> dict:
    """拉取并标准化 K 线 / 分时，供 API 层直接序列化。"""
    _ensure_analyzer_on_path()

    if ui_period == "intraday":
        td: date | None = None
        if isinstance(trade_date, date):
            td = trade_date
        elif isinstance(trade_date, str) and trade_date.strip():
            td = date.fromisoformat(trade_date.strip()[:10])
        return _fetch_intraday(code, trade_date=td)

    from market_data import fetch_ohlc
    from app.services.stock_meta import normalize_stock_code

    code = normalize_stock_code(code) or code
    if not code:
        raise LookupError("无效股票代码")
    end_d = date.today()
    start_d = end_d - timedelta(days=_LOOKBACK_DAYS.get(ui_period, 800))
    start = start_d.strftime("%Y%m%d")
    end = end_d.strftime("%Y%m%d")

    daily_need = _MIN_DAILY_BARS.get(ui_period, 200)
    # 提高 min_bars：短缓存根数不够时直接跳过缓存，拉取长历史并回写
    df = fetch_ohlc(
        code,
        start=start,
        end=end,
        min_bars=daily_need,
        use_cache=True,
    )
    if df is None or len(df) < daily_need:
        # 个股上市较晚：再降门槛
        fallback = fetch_ohlc(
            code,
            start=start,
            end=end,
            min_bars=max(1, min(20, daily_need)),
            use_cache=True,
        )
        if fallback is not None and (df is None or len(fallback) > len(df)):
            df = fallback

    if df is None or df.empty:
        # 刚上市新股可能只有 1 根日线，强制绕过缓存再拉一次
        fresh = fetch_ohlc(
            code,
            start=start,
            end=end,
            min_bars=1,
            use_cache=False,
        )
        if fresh is not None and not fresh.empty:
            try:
                from market_data import _write_ohlc_cache

                _write_ohlc_cache(code, fresh)
            except Exception:
                pass
            df = fresh

    if df is None or df.empty:
        raise LookupError(f"无法获取 {code} 的行情数据")

    daily_count = len(df)
    df = _resample(df, ui_period)
    if df.empty:
        raise LookupError(f"{code} 重采样后无数据")

    min_out = _MIN_RESAMPLED_BARS.get(ui_period)
    if min_out and len(df) < min_out and daily_count < daily_need:
        # 仍偏少时强制绕过缓存重拉一次（老股缓存过短）；新股只有几根则接受
        fresh = fetch_ohlc(
            code,
            start=start,
            end=end,
            min_bars=1,
            use_cache=False,
        )
        if fresh is not None and len(fresh) > daily_count:
            try:
                from market_data import _write_ohlc_cache

                _write_ohlc_cache(code, fresh)
            except Exception:
                pass
            df = _resample(fresh, ui_period)
        elif daily_count >= 1 and daily_count < 30:
            # 上市不足一月：周/月重采样根数很少也属正常，保留现有数据
            pass

    if df is None or df.empty:
        raise LookupError(f"{code} 重采样后无数据")

    return {
        "code": code,
        "name": _lookup_name(code),
        "period": ui_period,
        "chart_type": "candle",
        "adjust": adjust if adjust in ("qfq", "hfq", "none") else "qfq",
        "adjust_applied": "qfq",
        "source": "market_data",
        "prev_close": None,
        "trade_date": None,
        "count": len(df),
        "bars": _df_to_bars(df),
    }
