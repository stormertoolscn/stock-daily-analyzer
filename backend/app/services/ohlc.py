from __future__ import annotations

import sys
import threading
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


def _df_last_date(df: pd.DataFrame) -> date | None:
    if df is None or df.empty:
        return None
    ts = df.index.max()
    try:
        return ts.date()  # type: ignore[no-any-return]
    except Exception:
        return pd.Timestamp(ts).date()


def _last_weekday_on_or_before(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _fetch_ak_daily_hist(
    code: str,
    *,
    start: str,
    end: str,
    adjust: str = "qfq",
) -> pd.DataFrame | None:
    """akshare 日 K 兜底（本机东财直连/代理都不稳时仍常可用）。"""
    try:
        import akshare as ak
    except Exception:
        return None
    c = str(code).zfill(6)
    beg = start.replace("-", "")[:8]
    end_s = end.replace("-", "")[:8]
    adj = adjust if adjust in ("qfq", "hfq") else ""
    try:
        raw = ak.stock_zh_a_hist(
            symbol=c,
            period="daily",
            start_date=beg,
            end_date=end_s,
            adjust=adj,
        )
    except Exception:
        return None
    if raw is None or raw.empty:
        return None
    colmap = {
        "日期": "Date",
        "开盘": "Open",
        "收盘": "Close",
        "最高": "High",
        "最低": "Low",
        "成交量": "Volume",
    }
    if not all(k in raw.columns for k in ("日期", "开盘", "收盘", "最高", "最低")):
        return None
    out = raw.rename(columns=colmap)
    out["Date"] = pd.to_datetime(out["Date"])
    # ak 成交量单位为手
    if "Volume" in out.columns:
        out["Volume"] = pd.to_numeric(out["Volume"], errors="coerce").fillna(0) * 100
    else:
        out["Volume"] = 0.0
    for col in ("Open", "High", "Low", "Close"):
        out[col] = pd.to_numeric(out[col], errors="coerce")
    out = out.dropna(subset=["Open", "Close"]).set_index("Date").sort_index()
    return out[["Open", "High", "Low", "Close", "Volume"]] if not out.empty else None


def _merge_recent_daily(
    code: str,
    df: pd.DataFrame | None,
    *,
    end_d: date,
    adjust: str,
    lookback_days: int = 20,
) -> pd.DataFrame | None:
    """用近端日 K 补齐/刷新今日柱，避免本地缓存停在昨天。"""
    market_end = _last_weekday_on_or_before(end_d)
    last = _df_last_date(df) if df is not None else None
    # 已覆盖到最近交易日：盘中仍拉一小段刷新当日 OHLC；周末可跳过
    need_patch = last is None or last < market_end or (
        last == market_end and end_d.weekday() < 5
    )
    if not need_patch:
        return df

    start = (end_d - timedelta(days=lookback_days)).strftime("%Y%m%d")
    end = end_d.strftime("%Y%m%d")
    fresh = _fetch_em_daily_hist(code, start=start, end=end, adjust=adjust)
    if fresh is None or fresh.empty:
        fresh = _fetch_ak_daily_hist(code, start=start, end=end, adjust=adjust)
    if fresh is None or fresh.empty:
        fresh = _fetch_sina_daily_hist(code, start=start, end=end)
    if fresh is None or fresh.empty:
        return df

    if df is None or df.empty:
        merged = fresh
    else:
        merged = pd.concat([df, fresh])
        merged = merged[~merged.index.duplicated(keep="last")].sort_index()

    try:
        from market_data import _write_ohlc_cache

        _write_ohlc_cache(code, merged)
    except Exception:
        pass
    return merged


def _filter_bj_daily(code: str, df: pd.DataFrame | None) -> pd.DataFrame | None:
    """北交所 92 段为改革后代码，剔除明显串号的长历史。"""
    if df is None or df.empty:
        return None
    c = str(code).zfill(6)
    out = df.sort_index()
    if c.startswith("92"):
        # 92xxxx 不应出现改革前日 K；过早数据基本是串号
        cutoff = pd.Timestamp("2024-01-01")
        out = out[out.index >= cutoff]
    if out.empty:
        return None
    return out


def _fetch_bj_daily(
    code: str,
    *,
    start: str,
    end: str,
    adjust: str = "qfq",
) -> pd.DataFrame | None:
    """北交所日 K：东财优先，新浪需过滤串号。"""
    df = _filter_bj_daily(
        code, _fetch_em_daily_hist(code, start=start, end=end, adjust=adjust)
    )
    if df is not None and not df.empty:
        return df
    return _filter_bj_daily(code, _fetch_sina_daily_hist(code, start=start, end=end))


def _lookup_name(code: str) -> str | None:
    try:
        from app.services.stock_meta import lookup_name

        return lookup_name(code)
    except Exception:
        return None


def _is_beijing(code: str) -> bool:
    """北交所：92xxxx / 8xxxxx / 4xxxxx 等。"""
    c = str(code).zfill(6)
    if c.startswith("92"):
        return True
    if c.startswith(("43", "83", "87")):
        return True
    if c.startswith("8"):  # 83/87 已覆盖；其余 8xxxxx 多为北交所
        return True
    if c.startswith("4"):
        return True
    return False


def _secid(code: str) -> str:
    """东方财富 secid：沪 1.xxxxxx / 深+京 0.xxxxxx。

    注意：不能用 startswith('9') 判沪市，否则会把北交所 92xxxx 错映射成 1.92xxxx。
    """
    c = str(code).zfill(6)
    if _is_beijing(c):
        return f"0.{c}"
    if c.startswith(("5", "6")):
        return f"1.{c}"
    # 沪 B：900xxx
    if c.startswith("900"):
        return f"1.{c}"
    return f"0.{c}"


def _requests_session(trust_env: bool):
    import requests

    session = requests.Session()
    session.trust_env = trust_env
    return session


def _em_trust_modes() -> tuple[bool, ...]:
    """系统代理 / 直连都试：部分网络只能走其一。"""
    return (True, False)


def _is_proxy_error(exc: BaseException) -> bool:
    name = type(exc).__name__
    if "Proxy" in name:
        return True
    msg = str(exc).lower()
    return "proxy" in msg


def _fetch_em_daily_hist(
    code: str,
    *,
    start: str,
    end: str,
    adjust: str = "qfq",
) -> pd.DataFrame | None:
    """东方财富日 K（覆盖北交所 92xxxx 等）。"""
    import time

    fqt = {"qfq": "1", "hfq": "2", "none": "0"}.get(adjust, "1")
    beg = start.replace("-", "")[:8]
    end_s = end.replace("-", "")[:8]
    params = {
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
        "klt": "101",
        "fqt": fqt,
        "secid": _secid(code),
        "beg": beg,
        "end": end_s,
        "lmt": "1000000",
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": f"https://quote.eastmoney.com/bj/{str(code).zfill(6)}.html"
        if _is_beijing(code)
        else "https://quote.eastmoney.com/",
        "Accept": "*/*",
    }
    primary = ("push2his.eastmoney.com", "push2.eastmoney.com")
    mirrors = (
        "82.push2his.eastmoney.com",
        "83.push2his.eastmoney.com",
        "84.push2his.eastmoney.com",
    )

    def _parse(payload: dict) -> pd.DataFrame | None:
        klines = (payload.get("data") or {}).get("klines") or []
        if not klines:
            return None
        rows: list[dict] = []
        for line in klines:
            parts = str(line).split(",")
            if len(parts) < 6:
                continue
            rows.append(
                {
                    "Date": pd.Timestamp(parts[0]),
                    "Open": float(parts[1]),
                    "Close": float(parts[2]),
                    "High": float(parts[3]),
                    "Low": float(parts[4]),
                    "Volume": float(parts[5]) * 100,
                }
            )
        if not rows:
            return None
        return pd.DataFrame(rows).set_index("Date").sort_index()

    # 先主域名 × 代理/直连；代理报错则立刻换直连，避免镜像拖死
    for trust_env in _em_trust_modes():
        session = _requests_session(trust_env)
        for host in primary:
            try:
                resp = session.get(
                    f"https://{host}/api/qt/stock/kline/get",
                    params=params,
                    headers=headers,
                    timeout=15,
                )
                resp.raise_for_status()
                parsed = _parse(resp.json())
                if parsed is not None:
                    return parsed
            except Exception as exc:
                if trust_env and _is_proxy_error(exc):
                    break
                time.sleep(0.1)
                continue

    for trust_env in _em_trust_modes():
        session = _requests_session(trust_env)
        for host in mirrors:
            try:
                resp = session.get(
                    f"https://{host}/api/qt/stock/kline/get",
                    params=params,
                    headers=headers,
                    timeout=10,
                )
                resp.raise_for_status()
                parsed = _parse(resp.json())
                if parsed is not None:
                    return parsed
            except Exception as exc:
                if trust_env and _is_proxy_error(exc):
                    break
                continue
    return None


def _fetch_sina_daily_hist(
    code: str,
    *,
    start: str | None = None,
    end: str | None = None,
) -> pd.DataFrame | None:
    """新浪日 K 兜底（北交所用 bj 前缀）。"""
    import json
    import re

    import requests

    c = str(code).zfill(6)
    if _is_beijing(c):
        symbol = f"bj{c}"
    elif c.startswith(("5", "6")) or c.startswith("900"):
        symbol = f"sh{c}"
    else:
        symbol = f"sz{c}"

    session = requests.Session()
    session.trust_env = False
    url = "https://quotes.sina.cn/cn/api/jsonp_v2.php/x=/CN_MarketDataService.getKLineData"
    params = {
        "symbol": symbol,
        "scale": "240",  # 日线
        "ma": "no",
        "datalen": "1023",
    }
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://finance.sina.com.cn/",
    }
    try:
        resp = session.get(url, params=params, headers=headers, timeout=20)
        resp.raise_for_status()
        text = resp.text
        m = re.search(r"\[.*\]", text, flags=re.S)
        if not m:
            return None
        items = json.loads(m.group(0))
        if not items:
            return None
        rows: list[dict] = []
        start_s = (start or "").replace("-", "")[:8]
        end_s = (end or "").replace("-", "")[:8]
        for it in items:
            day = str(it.get("day") or "")
            day_key = day.replace("-", "")[:8]
            if start_s and day_key < start_s:
                continue
            if end_s and day_key > end_s:
                continue
            rows.append(
                {
                    "Date": pd.Timestamp(day),
                    "Open": float(it["open"]),
                    "High": float(it["high"]),
                    "Low": float(it["low"]),
                    "Close": float(it["close"]),
                    "Volume": float(it["volume"]),
                }
            )
        if not rows:
            return None
        return pd.DataFrame(rows).set_index("Date").sort_index()
    except Exception:
        return None


def _fetch_em_trends(code: str, *, with_auction: bool = True, ndays: int = 1) -> pd.DataFrame | None:
    """东方财富分时；iscr=1 时尽量带上 09:15 起的集合竞价点。"""
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
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": f"https://quote.eastmoney.com/bj/{str(code).zfill(6)}.html"
        if _is_beijing(code)
        else "https://quote.eastmoney.com/",
    }
    hosts = (
        "push2.eastmoney.com",
        "push2his.eastmoney.com",
        "push2delay.eastmoney.com",
    )
    for trust_env in _em_trust_modes():
        session = _requests_session(trust_env)
        for host in hosts:
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
                if rows:
                    return pd.DataFrame(rows).set_index("day").sort_index()
            except Exception as exc:  # noqa: BLE001
                if trust_env and _is_proxy_error(exc):
                    break
                continue
    return None


def _fetch_em_minute_hist(
    code: str,
    trade_date: date,
    period: int = 5,
) -> pd.DataFrame | None:
    """东方财富历史分钟 K 线（klt=5/15/30/60 可回溯较早日期；1 分钟仅近 5 日）。"""
    params = {
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "ut": "7eea3edcaed734bea9cbfc24409ed989",
        "klt": str(int(period)),
        "fqt": "0",
        "secid": _secid(code),
        "beg": trade_date.strftime("%Y%m%d"),
        "end": trade_date.strftime("%Y%m%d"),
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": f"https://quote.eastmoney.com/bj/{str(code).zfill(6)}.html"
        if _is_beijing(code)
        else "https://quote.eastmoney.com/",
    }
    hosts = (
        "push2his.eastmoney.com",
        "push2.eastmoney.com",
        "push2delay.eastmoney.com",
    )
    for trust_env in _em_trust_modes():
        session = _requests_session(trust_env)
        for host in hosts:
            try:
                resp = session.get(
                    f"https://{host}/api/qt/stock/kline/get",
                    params=params,
                    headers=headers,
                    timeout=12,
                )
                resp.raise_for_status()
                payload = resp.json()
                klines = (payload.get("data") or {}).get("klines") or []
                if not klines:
                    continue
                rows: list[dict] = []
                for line in klines:
                    parts = str(line).split(",")
                    if len(parts) < 7:
                        continue
                    # 日期, 开盘, 收盘, 最高, 最低, 成交量(手), 成交额(元), ...
                    ts = pd.Timestamp(parts[0])
                    rows.append(
                        {
                            "day": ts,
                            "Open": float(parts[1]),
                            "High": float(parts[3]),
                            "Low": float(parts[4]),
                            "Close": float(parts[2]),
                            "Volume": float(parts[5]) * 100,  # 手 → 股
                            "amount": float(parts[6]),
                            "Avg": float(parts[2]),
                        }
                    )
                if rows:
                    return pd.DataFrame(rows).set_index("day").sort_index()
            except Exception as exc:  # noqa: BLE001
                if trust_env and _is_proxy_error(exc):
                    break
                continue
    return None


_BAOSTOCK_LOCK = threading.Lock()
# 历史 5 分钟内存缓存（数据不可变，会话内复用；baostock 服务不稳定时也能秒回）
_BS_MIN_CACHE: dict[str, pd.DataFrame] = {}
_BS_MIN_CACHE_KEYS: list[str] = []


def _fetch_baostock_minute(
    code: str,
    trade_date: date,
    period: int = 5,
) -> pd.DataFrame | None:
    """baostock 历史分钟 K 线（5/15/30/60 分钟可回溯较早日期；不支持北交所）。

    服务不稳定时可能挂起：放入带超时的线程执行，超时（10s）即放弃并返回 None。
    """
    c = str(code).zfill(6)
    if _is_beijing(c) or c.startswith("9"):
        return None
    key = f"bs{int(period)}:{c}:{trade_date.isoformat()}"
    cached = _BS_MIN_CACHE.get(key)
    if cached is not None:
        return cached
    prefix = "sh" if c.startswith("6") else "sz"

    def _run() -> pd.DataFrame | None:
        try:
            import baostock as bs
        except Exception:
            return None
        with _BAOSTOCK_LOCK:
            try:
                lg = bs.login()
                if lg.error_code != "0":
                    return None
                try:
                    rs = bs.query_history_k_data_plus(
                        f"{prefix}.{c}",
                        "date,time,open,high,low,close,volume,amount",
                        start_date=trade_date.strftime("%Y-%m-%d"),
                        end_date=trade_date.strftime("%Y-%m-%d"),
                        frequency=str(int(period)),
                        adjustflag="3",
                    )
                    if rs.error_code != "0":
                        return None
                    rows: list[dict] = []
                    while rs.next():
                        row = rs.get_row_data()
                        if len(row) < 8:
                            continue
                        try:
                            ts = pd.Timestamp(str(row[1])[:14])  # YYYYMMDDHHmmss
                        except Exception:
                            continue
                        rows.append(
                            {
                                "day": ts,
                                "Open": float(row[2]),
                                "High": float(row[3]),
                                "Low": float(row[4]),
                                "Close": float(row[5]),
                                "Volume": float(row[6]),
                                "amount": float(row[7]),
                                "Avg": float(row[5]),
                            }
                        )
                    if rows:
                        return pd.DataFrame(rows).set_index("day").sort_index()
                finally:
                    try:
                        bs.logout()
                    except Exception:
                        pass
            except Exception:
                return None
        return None

    df: pd.DataFrame | None = None
    try:
        import concurrent.futures as cf

        ex = cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="bs-min")
        fut = ex.submit(_run)
        try:
            df = fut.result(timeout=10)
        finally:
            ex.shutdown(wait=False)
    except Exception:
        df = None
    if df is not None and not df.empty:
        _BS_MIN_CACHE[key] = df
        _BS_MIN_CACHE_KEYS.append(key)
        if len(_BS_MIN_CACHE_KEYS) > 200:
            _BS_MIN_CACHE.pop(_BS_MIN_CACHE_KEYS.pop(0), None)
    return df


def _fetch_tencent_minute(code: str) -> pd.DataFrame | None:
    """腾讯分时（含北交所 bj 前缀）。"""
    _ensure_analyzer_on_path()
    from market_data import to_tencent_symbol

    symbol = to_tencent_symbol(code)
    params = {"code": symbol}
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"}
    for trust_env in _em_trust_modes():
        session = _requests_session(trust_env)
        try:
            resp = session.get(
                "https://web.ifzq.gtimg.cn/appstock/app/minute/query",
                params=params,
                headers=headers,
                timeout=12,
            )
            resp.raise_for_status()
            payload = resp.json()
            data = (payload.get("data") or {}).get(symbol) or {}
            raw = ((data.get("data") or {}).get("data")) or []
            if not raw:
                continue
            day_s = str((data.get("data") or {}).get("date") or date.today().isoformat())
            day_s = day_s.replace("-", "")[:8]
            y, mo, d = int(day_s[:4]), int(day_s[4:6]), int(day_s[6:8])
            rows: list[dict] = []
            for line in raw:
                parts = str(line).split()
                if len(parts) < 2:
                    continue
                hm = parts[0].zfill(4)
                hour, minute = int(hm[:2]), int(hm[2:])
                ts = pd.Timestamp(year=y, month=mo, day=d, hour=hour, minute=minute)
                px = float(parts[1])
                vol = float(parts[2]) if len(parts) > 2 else 0.0
                rows.append(
                    {
                        "day": ts,
                        "Open": px,
                        "High": px,
                        "Low": px,
                        "Close": px,
                        "Volume": vol,
                        "Avg": px,
                    }
                )
            if rows:
                return pd.DataFrame(rows).set_index("day").sort_index()
        except Exception as exc:
            if trust_env and _is_proxy_error(exc):
                continue
            continue
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

    def _filter_day(df: pd.DataFrame, day: date) -> pd.DataFrame:
        return df[[pd.Timestamp(t).date() == day for t in df.index]]

    # 1) 近几日：东方财富（ndays<=5，便于双击近日日K进分时）
    if target is None or (date.today() - target).days <= 5:
        em = _fetch_em_trends(
            code,
            with_auction=True,
            ndays=5 if target is not None else 1,
        )
        if em is not None and not em.empty:
            if target is not None:
                day_em = _filter_day(em, target)
                if not day_em.empty:
                    session = day_em
                    source = "eastmoney_trends"
            else:
                last_d = pd.Timestamp(em.index.max()).date()
                session = _filter_day(em, last_d)
                source = "eastmoney_trends"

    # 1b) 腾讯分时仅能拿「最新」——指定历史日时禁止回退，否则会错成今日分时
    if (session is None or session.empty) and target is None:
        tx = _fetch_tencent_minute(code)
        if tx is not None and not tx.empty:
            session = tx
            source = "tencent_minute"

    # 2) 回退腾讯/akshare 分钟（支持按日筛选）
    # 1 分钟源只保留近几日：超过保留期（约5日）的历史日期用 5 分钟历史线兜底（baostock → 东财）
    if (
        target is not None
        and (session is None or session.empty)
        and (date.today() - target).days > 5
    ):
        m5 = _fetch_baostock_minute(code, target)
        if m5 is None or m5.empty:
            m5 = _fetch_em_minute_hist(code, target)
        if m5 is not None and not m5.empty:
            session = m5
            source = "5分钟历史"
    if session is None or session.empty:
        try:
            symbol = to_tencent_symbol(code)
            raw = ak.stock_zh_a_minute(symbol=symbol, period="1", adjust="")
        except Exception:
            raw = None
        if raw is None or raw.empty:
            if target is not None:
                raise LookupError(
                    f"无法获取 {code} 在 {target.isoformat()} 的分时数据"
                )
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
    resolved_date = pd.Timestamp(session.index[0]).date()
    # 指定历史日时绝不静默换成别的交易日（尤其是今日）
    if target is not None and resolved_date != target:
        raise LookupError(
            f"{code} 分时日期不匹配：请求 {target.isoformat()}，实得 {resolved_date.isoformat()}"
        )
    trade_date = resolved_date

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
    df: pd.DataFrame | None = None

    # 北交所：禁止 baostock/yfinance/ak；东财优先，新浪需过滤串号长历史
    if _is_beijing(code):
        # 北交所上市较短，回看约 2 年即可，避免东财长窗口串数
        bj_start = (end_d - timedelta(days=800)).strftime("%Y%m%d")
        df = _fetch_bj_daily(code, start=bj_start, end=end, adjust=adjust)
        if df is None or df.empty:
            raise LookupError(f"无法获取北交所 {code} 的行情数据")
        start_m = (end_d - timedelta(days=20)).strftime("%Y%m%d")
        fresh = _fetch_bj_daily(code, start=start_m, end=end, adjust=adjust)
        if fresh is not None and not fresh.empty:
            df = pd.concat([df, fresh])
            df = df[~df.index.duplicated(keep="last")].sort_index()
        df = _resample(df, ui_period)
        if df.empty:
            raise LookupError(f"{code} 重采样后无数据")
        return {
            "code": code,
            "name": _lookup_name(code),
            "period": ui_period,
            "chart_type": "candle",
            "adjust": adjust if adjust in ("qfq", "hfq", "none") else "qfq",
            "adjust_applied": "qfq",
            "source": "bj_hist",
            "prev_close": None,
            "trade_date": None,
            "count": len(df),
            "bars": _df_to_bars(df),
        }

    if df is None or len(df) < daily_need:
        # 提高 min_bars：短缓存根数不够时直接跳过缓存，拉取长历史并回写
        md = fetch_ohlc(
            code,
            start=start,
            end=end,
            min_bars=daily_need,
            use_cache=True,
        )
        if md is not None and (df is None or len(md) > len(df)):
            df = md
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
        # 通用兜底：东财日 K（含沪深；并修复北交所）
        df = _fetch_em_daily_hist(code, start=start, end=end, adjust=adjust)
    if df is None or df.empty:
        df = _fetch_ak_daily_hist(code, start=start, end=end, adjust=adjust)
    if df is None or df.empty:
        df = _fetch_sina_daily_hist(code, start=start, end=end)

    if df is None or df.empty:
        raise LookupError(f"无法获取 {code} 的行情数据")

    # 缓存常停在昨天；东财近端合并，保证今日 K（盘中=最新价柱）能更新
    df = _merge_recent_daily(code, df, end_d=end_d, adjust=adjust)
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
