"""批量实时/收盘价：盘中为最新价，收盘后即为当日收盘价。"""

from __future__ import annotations

import time
from typing import Any

from app.services.ohlc import _secid
from app.services.stock_meta import lookup_name, normalize_stock_code

# 全市场 spot 拉取较重，短缓存供多次 quotes 请求复用
_SPOT_CACHE: dict[str, Any] | None = None
_SPOT_CACHE_TS = 0.0
_SPOT_TTL_SEC = 45.0


def _secids_for(codes: list[str]) -> list[str]:
    out: list[str] = []
    for c in codes:
        n = normalize_stock_code(c) or c
        if n:
            out.append(_secid(n))
    return out


def _fetch_em_ulist(codes: list[str]) -> dict[str, dict[str, Any]]:
    """东方财富 ulist：f2 最新价（收盘后即收盘价），f3 涨跌幅%。"""
    from app.services.ohlc import _em_trust_modes, _requests_session

    if not codes:
        return {}
    secids = ",".join(_secids_for(codes))
    params = {
        "fltt": "2",
        "invt": "2",
        "fields": "f12,f14,f2,f3,f15,f16,f17,f18",
        "secids": secids,
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://quote.eastmoney.com/",
    }
    hosts = (
        "push2.eastmoney.com",
        "push2delay.eastmoney.com",
        "82.push2.eastmoney.com",
    )
    payload: dict[str, Any] | None = None
    for trust_env in _em_trust_modes():
        session = _requests_session(trust_env)
        for host in hosts:
            url = f"https://{host}/api/qt/ulist.np/get"
            try:
                resp = session.get(url, params=params, headers=headers, timeout=12)
                resp.raise_for_status()
                payload = resp.json()
                break
            except Exception:
                continue
        if payload:
            break
    if not payload:
        return {}
    rows = ((payload.get("data") or {}).get("diff")) or []
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        code = str(row.get("f12") or "").zfill(6)
        if not code or code == "000000":
            continue
        price = row.get("f2")
        chg = row.get("f3")
        try:
            price_f = float(price) if price not in (None, "-", "") else None
        except (TypeError, ValueError):
            price_f = None
        try:
            chg_f = float(chg) if chg not in (None, "-", "") else None
        except (TypeError, ValueError):
            chg_f = None
        if price_f is None:
            continue
        name = str(row.get("f14") or "") or (lookup_name(code) or code)
        out[code] = {
            "code": code,
            "name": name,
            "price": price_f,
            "change_pct": chg_f if chg_f is not None else 0.0,
            "source": "eastmoney",
        }
    return out


def _load_spot_map() -> dict[str, dict[str, Any]]:
    global _SPOT_CACHE, _SPOT_CACHE_TS
    now = time.time()
    if _SPOT_CACHE is not None and now - _SPOT_CACHE_TS < _SPOT_TTL_SEC:
        return _SPOT_CACHE
    try:
        import akshare as ak

        df = ak.stock_zh_a_spot_em()
        mapping: dict[str, dict[str, Any]] = {}
        if df is not None and not df.empty:
            for _, r in df.iterrows():
                code = str(r.get("代码", "")).zfill(6)
                if not code or code == "000000":
                    continue
                try:
                    price = float(r["最新价"])
                except (TypeError, ValueError, KeyError):
                    continue
                try:
                    chg = float(r["涨跌幅"])
                except (TypeError, ValueError, KeyError):
                    chg = 0.0
                mapping[code] = {
                    "code": code,
                    "name": str(r.get("名称") or lookup_name(code) or code),
                    "price": price,
                    "change_pct": chg,
                    "source": "akshare",
                }
        _SPOT_CACHE = mapping
        _SPOT_CACHE_TS = now
        return mapping
    except Exception:
        return _SPOT_CACHE or {}


def fetch_quotes(codes: list[str]) -> list[dict[str, Any]]:
    """按代码批量取价；盘中=最新价，收盘后=收盘价。"""
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in codes:
        c = normalize_stock_code(raw) or (raw or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        normalized.append(c)
    if not normalized:
        return []

    # 优先东财 ulist（含北交所），一次请求多码
    by_code = _fetch_em_ulist(normalized)
    missing = [c for c in normalized if c not in by_code]
    if missing:
        spot = _load_spot_map()
        for c in missing:
            hit = spot.get(c)
            if hit:
                by_code[c] = hit

    # 仍缺：占位，前端显示 —
    items: list[dict[str, Any]] = []
    for c in normalized:
        hit = by_code.get(c)
        if hit:
            items.append(hit)
        else:
            items.append(
                {
                    "code": c,
                    "name": lookup_name(c) or c,
                    "price": None,
                    "change_pct": None,
                    "source": "miss",
                }
            )
    return items
