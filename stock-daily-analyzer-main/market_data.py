"""
A-share market data helpers.

Priority (domestic-first):
  universe/spot: sina -> tencent -> code_name -> eastmoney
  OHLC history:  local cache -> tencent hist -> baostock -> yfinance
"""
from __future__ import annotations

import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional, Tuple

import akshare as ak
import pandas as pd
import yfinance as yf

from config import (
    DATA_TIMEOUT,
    OHLC_CACHE_DIR,
    OHLC_CACHE_MAX_STALE_DAYS,
    get_yfinance_ticker,
    is_valid_stock,
)

_bs_lock = threading.Lock()
_bs_logged_in = False


def normalize_code(code: str) -> str:
    return (
        str(code)
        .replace(".SS", "")
        .replace(".SZ", "")
        .replace(".BJ", "")
        .replace("sh", "")
        .replace("sz", "")
        .replace("bj", "")
        .strip()
    )


def _is_beijing(code: str) -> bool:
    c = normalize_code(code).zfill(6)
    return c.startswith(("92", "43", "83", "87", "8", "4"))


def to_tencent_symbol(code: str) -> str:
    c = normalize_code(code)
    if _is_beijing(c):
        return f"bj{c}"
    if c.startswith(("5", "6")) or c.startswith("900"):
        return f"sh{c}"
    return f"sz{c}"


def to_baostock_code(code: str) -> str:
    c = normalize_code(code)
    if _is_beijing(c):
        # baostock 对北交所支持有限，仍按 bj 前缀尝试
        return f"bj.{c}"
    if c.startswith(("5", "6")) or c.startswith("900"):
        return f"sh.{c}"
    return f"sz.{c}"


def _period_to_start(period: str, *, end: Optional[date] = None) -> date:
    end = end or date.today()
    mapping = {
        "5d": 10,
        "1mo": 40,
        "2mo": 70,
        "3mo": 100,
        "6mo": 200,
        "1y": 400,
        "2y": 800,
    }
    return end - timedelta(days=mapping.get(period, 70))


def _resolve_range(
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    period: Optional[str] = None,
) -> Tuple[date, date]:
    end_d = datetime.strptime(end, "%Y%m%d").date() if end else date.today()
    if start:
        start_d = datetime.strptime(start.replace("-", ""), "%Y%m%d").date()
    else:
        start_d = _period_to_start(period or "2mo", end=end_d)
    return start_d, end_d


def _filter_universe_rows(rows: List[Tuple[str, str]]) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    seen = set()
    for code, name in rows:
        code = normalize_code(code)
        name = str(name).strip()
        if not code or code in seen:
            continue
        if not is_valid_stock(code):
            continue
        if "ST" in name.upper():
            continue
        seen.add(code)
        out.append((code, name))
    return out


def fetch_a_share_universe() -> Tuple[List[Tuple[str, str]], str]:
    """Return ([(code, name), ...], source_label)."""
    sources = (
        ("sina", lambda: ak.stock_zh_a_spot(), "代码", "名称"),
        ("tencent", lambda: ak.stock_zh_a_spot_tx(), "code", "name"),
        ("code_name", lambda: ak.stock_info_a_code_name(), "code", "name"),
        ("eastmoney", lambda: ak.stock_zh_a_spot_em(), "代码", "名称"),
    )
    last_err: Optional[Exception] = None
    for label, fetcher, code_col, name_col in sources:
        try:
            df = fetcher()
            rows = [(str(r[code_col]), str(r[name_col])) for _, r in df.iterrows()]
            stocks = _filter_universe_rows(rows)
            if stocks:
                return stocks, label
        except Exception as e:
            last_err = e
    raise RuntimeError(f"all universe sources failed: {last_err}")


def _normalize_ohlc(df: pd.DataFrame) -> Optional[pd.DataFrame]:
    if df is None or df.empty:
        return None
    out = df.copy()
    colmap = {
        "date": "Date",
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
    }
    rename = {k: v for k, v in colmap.items() if k in out.columns}
    if rename:
        out = out.rename(columns=rename)
    if "Date" in out.columns:
        out["Date"] = pd.to_datetime(out["Date"])
        out = out.set_index("Date")
    out.index = pd.to_datetime(out.index)
    need = ["Open", "High", "Low", "Close", "Volume"]
    for c in need:
        if c not in out.columns:
            return None
    out = out[need].apply(pd.to_numeric, errors="coerce").dropna()
    if out.empty:
        return None
    out.index.name = "Date"
    return out.sort_index()


def _cache_path(code: str) -> Path:
    return OHLC_CACHE_DIR / f"{normalize_code(code)}.csv"


def _last_weekday_on_or_before(d: date) -> date:
    """把周末回退到上一个周五（近似最近交易日；法定假日仍可能多拉一次）。"""
    while d.weekday() >= 5:  # Sat=5, Sun=6
        d -= timedelta(days=1)
    return d


def _read_ohlc_cache(code: str, start_d: date, end_d: date) -> Optional[pd.DataFrame]:
    path = _cache_path(code)
    if not path.exists():
        return None
    try:
        df = pd.read_csv(path, parse_dates=["Date"]).set_index("Date")
        df = _normalize_ohlc(df.reset_index())
        if df is None or df.empty:
            return None
        last = df.index.max().date()
        # 交易日必须覆盖到「今天/上周五」；否则会一直吃旧缓存，当日 K 不更新
        market_end = _last_weekday_on_or_before(end_d)
        if last < market_end:
            return None
        # 极端过期兜底（例如长期未访问）
        if last < end_d - timedelta(days=OHLC_CACHE_MAX_STALE_DAYS):
            return None
        sliced = df.loc[(df.index.date >= start_d) & (df.index.date <= end_d)]
        return sliced if not sliced.empty else None
    except Exception:
        return None


def _write_ohlc_cache(code: str, df: pd.DataFrame) -> None:
    if df is None or df.empty:
        return
    path = _cache_path(code)
    try:
        existing = None
        if path.exists():
            existing = _normalize_ohlc(pd.read_csv(path, parse_dates=["Date"]))
        merged = df
        if existing is not None and not existing.empty:
            merged = pd.concat([existing, df])
            merged = merged[~merged.index.duplicated(keep="last")].sort_index()
        out = merged.reset_index()
        out.to_csv(path, index=False, encoding="utf-8")
    except Exception:
        pass


def fetch_ohlc_tencent(
    code: str,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    period: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    start_d, end_d = _resolve_range(start=start, end=end, period=period)
    symbol = to_tencent_symbol(code)
    raw = ak.stock_zh_a_hist_tx(
        symbol=symbol,
        start_date=start_d.strftime("%Y%m%d"),
        end_date=end_d.strftime("%Y%m%d"),
        adjust="qfq",
    )
    return _normalize_ohlc(raw)


def _ensure_baostock_login() -> bool:
    global _bs_logged_in
    with _bs_lock:
        if _bs_logged_in:
            return True
        try:
            import baostock as bs

            lg = bs.login()
            _bs_logged_in = lg.error_code == "0"
            return _bs_logged_in
        except Exception:
            _bs_logged_in = False
            return False


def fetch_ohlc_baostock(
    code: str,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    period: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    try:
        import baostock as bs
    except ImportError:
        return None
    if not _ensure_baostock_login():
        return None
    start_d, end_d = _resolve_range(start=start, end=end, period=period)
    with _bs_lock:
        rs = bs.query_history_k_data_plus(
            to_baostock_code(code),
            "date,open,high,low,close,volume",
            start_date=start_d.isoformat(),
            end_date=end_d.isoformat(),
            frequency="d",
            adjustflag="2",
        )
        if rs.error_code != "0":
            return None
        rows = []
        while rs.error_code == "0" and rs.next():
            rows.append(rs.get_row_data())
    if not rows:
        return None
    raw = pd.DataFrame(rows, columns=rs.fields)
    return _normalize_ohlc(raw)


def fetch_ohlc_yfinance(
    code: str,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    period: Optional[str] = None,
    timeout: int = DATA_TIMEOUT,
) -> Optional[pd.DataFrame]:
    ticker = get_yfinance_ticker(normalize_code(code))
    stock = yf.Ticker(ticker)

    def _fmt(s: Optional[str]) -> Optional[str]:
        if not s:
            return None
        if "-" in s:
            return s
        s = s.replace("-", "")
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"

    if start or end:
        data = stock.history(start=_fmt(start), end=_fmt(end), timeout=timeout)
    else:
        data = stock.history(period=period or "2mo", timeout=timeout)
    if data is None or data.empty:
        return None
    if "Date" not in getattr(data, "columns", []):
        data = data.reset_index()
    return _normalize_ohlc(data)


def fetch_ohlc(
    code: str,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    period: Optional[str] = None,
    timeout: int = DATA_TIMEOUT,
    min_bars: int = 20,
    use_cache: bool = True,
) -> Optional[pd.DataFrame]:
    """Fetch OHLC: cache -> tencent -> baostock -> yfinance."""
    code = normalize_code(code)
    start_d, end_d = _resolve_range(start=start, end=end, period=period)

    if use_cache:
        cached = _read_ohlc_cache(code, start_d, end_d)
        if cached is not None and len(cached) >= min_bars:
            return cached

    fetchers = (
        lambda: fetch_ohlc_tencent(code, start=start, end=end, period=period),
        lambda: fetch_ohlc_baostock(code, start=start, end=end, period=period),
        lambda: fetch_ohlc_yfinance(code, start=start, end=end, period=period, timeout=timeout),
    )
    for fetcher in fetchers:
        try:
            df = fetcher()
            if df is not None and len(df) >= min_bars:
                if use_cache:
                    _write_ohlc_cache(code, df)
                return df
        except Exception:
            continue
    return None
