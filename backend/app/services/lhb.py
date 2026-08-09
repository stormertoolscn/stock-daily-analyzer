"""龙虎榜数据服务：日榜列表、个股席位明细、买卖关系图。"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Literal

SeatSide = Literal["buy", "sell"]
SeatKind = Literal["institution", "hotmoney", "other"]


def _to_yyyymmdd(value: str | date | None) -> str:
    if value is None:
        return date.today().strftime("%Y%m%d")
    if isinstance(value, date):
        return value.strftime("%Y%m%d")
    text = str(value).strip().replace("/", "-")
    if len(text) == 8 and text.isdigit():
        return text
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").strftime("%Y%m%d")
    except ValueError as exc:
        raise ValueError(f"invalid date: {value}") from exc


def _to_iso(value: Any) -> str:
    if value is None:
        return date.today().isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return text[:10]


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        import math

        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return default
        return num
    except (TypeError, ValueError):
        return default


def _classify_seat(name: str) -> SeatKind:
    text = name or ""
    if "机构专用" in text or text.strip() == "机构专用":
        return "institution"
    if any(k in text for k in ("深股通", "沪股通", "港股通")):
        return "other"
    return "hotmoney"


def _short_seat_label(name: str, max_len: int = 14) -> str:
    text = (name or "").strip()
    if not text:
        return "未知席位"
    if "机构专用" in text:
        return "机构专用"
    # 营业部名称通常很长，截断末尾便于图谱展示
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _mock_daily(trade_date: str) -> list[dict[str, Any]]:
    iso = _to_iso(trade_date)
    return [
        {
            "code": "000021",
            "name": "深科技",
            "trade_date": iso,
            "reason": "日涨幅偏离值达到7%的前5只证券",
            "insight": "游资买入，机构卖出",
            "close": 18.56,
            "change_pct": 8.12,
            "net_buy": 82_450_000.0,
            "buy_amount": 156_200_000.0,
            "sell_amount": 73_750_000.0,
            "lhb_amount": 229_950_000.0,
            "market_amount": 1_250_000_000.0,
            "net_buy_ratio": 6.6,
            "turnover_ratio": 18.4,
            "turnover_rate": 12.3,
            "float_mv": 28_500_000_000.0,
            "ret_1d": 2.1,
            "ret_2d": -1.4,
            "ret_5d": 3.8,
            "ret_10d": 5.2,
            "source": "mock",
        },
        {
            "code": "600519",
            "name": "贵州茅台",
            "trade_date": iso,
            "reason": "日跌幅偏离值达到7%的前5只证券",
            "insight": "机构买入为主",
            "close": 1688.0,
            "change_pct": -7.05,
            "net_buy": -45_200_000.0,
            "buy_amount": 120_000_000.0,
            "sell_amount": 165_200_000.0,
            "lhb_amount": 285_200_000.0,
            "market_amount": 8_900_000_000.0,
            "net_buy_ratio": -0.51,
            "turnover_ratio": 3.2,
            "turnover_rate": 0.8,
            "float_mv": 2_100_000_000_000.0,
            "ret_1d": 1.2,
            "ret_2d": 0.5,
            "ret_5d": -2.1,
            "ret_10d": -4.0,
            "source": "mock",
        },
        {
            "code": "300750",
            "name": "宁德时代",
            "trade_date": iso,
            "reason": "连续三个交易日内，涨幅偏离值累计达到20%的证券",
            "insight": "买卖博弈激烈",
            "close": 215.6,
            "change_pct": 5.42,
            "net_buy": 32_100_000.0,
            "buy_amount": 210_500_000.0,
            "sell_amount": 178_400_000.0,
            "lhb_amount": 388_900_000.0,
            "market_amount": 6_200_000_000.0,
            "net_buy_ratio": 0.52,
            "turnover_ratio": 6.3,
            "turnover_rate": 4.1,
            "float_mv": 780_000_000_000.0,
            "ret_1d": -0.8,
            "ret_2d": 1.5,
            "ret_5d": 4.2,
            "ret_10d": 6.8,
            "source": "mock",
        },
    ]


def _mock_seats(code: str, name: str, trade_date: str) -> dict[str, Any]:
    iso = _to_iso(trade_date)
    buys = [
        {
            "rank": 1,
            "seat_name": "东方财富证券股份有限公司拉萨东环路第二证券营业部",
            "buy_amount": 45_600_000.0,
            "sell_amount": 2_100_000.0,
            "net_amount": 43_500_000.0,
            "buy_ratio": 3.6,
            "sell_ratio": 0.2,
            "seat_kind": "hotmoney",
            "reason_type": "日涨幅偏离值达到7%的前5只证券",
            "side": "buy",
        },
        {
            "rank": 2,
            "seat_name": "机构专用",
            "buy_amount": 38_200_000.0,
            "sell_amount": 0.0,
            "net_amount": 38_200_000.0,
            "buy_ratio": 3.1,
            "sell_ratio": 0.0,
            "seat_kind": "institution",
            "reason_type": "日涨幅偏离值达到7%的前5只证券",
            "side": "buy",
        },
        {
            "rank": 3,
            "seat_name": "华泰证券股份有限公司深圳益田路荣超商务中心证券营业部",
            "buy_amount": 28_900_000.0,
            "sell_amount": 5_400_000.0,
            "net_amount": 23_500_000.0,
            "buy_ratio": 2.3,
            "sell_ratio": 0.4,
            "seat_kind": "hotmoney",
            "reason_type": "日涨幅偏离值达到7%的前5只证券",
            "side": "buy",
        },
    ]
    sells = [
        {
            "rank": 1,
            "seat_name": "国泰君安证券股份有限公司上海江苏路证券营业部",
            "buy_amount": 1_200_000.0,
            "sell_amount": 36_800_000.0,
            "net_amount": -35_600_000.0,
            "buy_ratio": 0.1,
            "sell_ratio": 2.9,
            "seat_kind": "hotmoney",
            "reason_type": "日涨幅偏离值达到7%的前5只证券",
            "side": "sell",
        },
        {
            "rank": 2,
            "seat_name": "中信证券股份有限公司上海溧阳路证券营业部",
            "buy_amount": 800_000.0,
            "sell_amount": 29_500_000.0,
            "net_amount": -28_700_000.0,
            "buy_ratio": 0.06,
            "sell_ratio": 2.4,
            "seat_kind": "hotmoney",
            "reason_type": "日涨幅偏离值达到7%的前5只证券",
            "side": "sell",
        },
        {
            "rank": 3,
            "seat_name": "机构专用",
            "buy_amount": 0.0,
            "sell_amount": 22_100_000.0,
            "net_amount": -22_100_000.0,
            "buy_ratio": 0.0,
            "sell_ratio": 1.8,
            "seat_kind": "institution",
            "reason_type": "日涨幅偏离值达到7%的前5只证券",
            "side": "sell",
        },
    ]
    graph = build_seat_graph(code=code, name=name, trade_date=iso, buys=buys, sells=sells)
    return {
        "code": code,
        "name": name,
        "trade_date": iso,
        "buys": buys,
        "sells": sells,
        "graph": graph,
        "source": "mock",
    }


def build_seat_graph(
    *,
    code: str,
    name: str,
    trade_date: str,
    buys: list[dict[str, Any]],
    sells: list[dict[str, Any]],
) -> dict[str, Any]:
    stock_id = f"stock:{code}"
    nodes: dict[str, dict[str, Any]] = {
        stock_id: {
            "id": stock_id,
            "label": name or code,
            "kind": "stock",
            "code": code,
            "seat_kind": None,
            "amount": 0.0,
        }
    }
    edges: list[dict[str, Any]] = []

    def upsert_seat(seat_name: str, seat_kind: str, amount: float) -> str:
        seat_id = f"seat:{seat_name}"
        existing = nodes.get(seat_id)
        if existing is None:
            nodes[seat_id] = {
                "id": seat_id,
                "label": _short_seat_label(seat_name),
                "full_label": seat_name,
                "kind": "seat",
                "code": None,
                "seat_kind": seat_kind,
                "amount": abs(amount),
            }
        else:
            existing["amount"] = float(existing.get("amount") or 0) + abs(amount)
        return seat_id

    for row in buys:
        seat_name = str(row.get("seat_name") or "未知席位")
        amount = abs(_safe_float(row.get("net_amount"), _safe_float(row.get("buy_amount"))))
        seat_id = upsert_seat(seat_name, str(row.get("seat_kind") or _classify_seat(seat_name)), amount)
        edges.append(
            {
                "id": f"buy:{seat_id}:{stock_id}:{len(edges)}",
                "source": seat_id,
                "target": stock_id,
                "side": "buy",
                "amount": amount,
                "label": f"买 {_format_yi(amount)}",
            }
        )

    for row in sells:
        seat_name = str(row.get("seat_name") or "未知席位")
        amount = abs(_safe_float(row.get("net_amount"), _safe_float(row.get("sell_amount"))))
        seat_id = upsert_seat(seat_name, str(row.get("seat_kind") or _classify_seat(seat_name)), amount)
        edges.append(
            {
                "id": f"sell:{stock_id}:{seat_id}:{len(edges)}",
                "source": stock_id,
                "target": seat_id,
                "side": "sell",
                "amount": amount,
                "label": f"卖 {_format_yi(amount)}",
            }
        )

    return {
        "trade_date": trade_date,
        "nodes": list(nodes.values()),
        "edges": edges,
    }


def _format_yi(amount: float) -> str:
    yi = amount / 1e8
    if abs(yi) >= 1:
        return f"{yi:.2f}亿"
    wan = amount / 1e4
    return f"{wan:.0f}万"


def _row_to_daily_item(row: Any, source: str) -> dict[str, Any]:
    return {
        "code": str(row.get("代码", "")).zfill(6),
        "name": str(row.get("名称", "")),
        "trade_date": _to_iso(row.get("上榜日")),
        "reason": str(row.get("上榜原因", "") or ""),
        "insight": str(row.get("解读", "") or ""),
        "close": _safe_float(row.get("收盘价")),
        "change_pct": _safe_float(row.get("涨跌幅")),
        "net_buy": _safe_float(row.get("龙虎榜净买额")),
        "buy_amount": _safe_float(row.get("龙虎榜买入额")),
        "sell_amount": _safe_float(row.get("龙虎榜卖出额")),
        "lhb_amount": _safe_float(row.get("龙虎榜成交额")),
        "market_amount": _safe_float(row.get("市场总成交额")),
        "net_buy_ratio": _safe_float(row.get("净买额占总成交比")),
        "turnover_ratio": _safe_float(row.get("成交额占总成交比")),
        "turnover_rate": _safe_float(row.get("换手率")),
        "float_mv": _safe_float(row.get("流通市值")),
        "ret_1d": _safe_float(row.get("上榜后1日"), default=float("nan")),
        "ret_2d": _safe_float(row.get("上榜后2日"), default=float("nan")),
        "ret_5d": _safe_float(row.get("上榜后5日"), default=float("nan")),
        "ret_10d": _safe_float(row.get("上榜后10日"), default=float("nan")),
        "source": source,
    }


def _normalize_nan(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    import math

    out: list[dict[str, Any]] = []
    for item in items:
        cleaned = dict(item)
        for key, value in list(cleaned.items()):
            if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
                cleaned[key] = None
        out.append(cleaned)
    return out


def fetch_daily_lhb(trade_date: str | None = None, *, allow_mock: bool = True) -> dict[str, Any]:
    """获取指定交易日龙虎榜列表。"""
    ymd = _to_yyyymmdd(trade_date)
    iso = _to_iso(ymd)

    from app.services.cache import get_json, set_json

    disk_key = f"lhb:daily:{ymd}"
    disk = get_json(disk_key)
    if disk is not None:
        return disk

    try:
        import akshare as ak

        df = ak.stock_lhb_detail_em(start_date=ymd, end_date=ymd)
        if df is None or df.empty:
            # 非交易日：回退到近 7 个自然日寻找最近有数据的一天
            for i in range(1, 8):
                prev = (datetime.strptime(ymd, "%Y%m%d").date() - timedelta(days=i)).strftime("%Y%m%d")
                df = ak.stock_lhb_detail_em(start_date=prev, end_date=prev)
                if df is not None and not df.empty:
                    ymd = prev
                    iso = _to_iso(prev)
                    break
        if df is None or df.empty:
            raise LookupError(f"no lhb data for {iso}")

        items = [_row_to_daily_item(row, "akshare") for _, row in df.iterrows()]
        items = _normalize_nan(items)
        # 同一股票可能因多个上榜原因重复，按净买额排序
        items.sort(key=lambda x: abs(x.get("net_buy") or 0), reverse=True)
        payload = {
            "trade_date": iso,
            "count": len(items),
            "items": items,
            "source": "akshare",
        }
        # 历史交易日不可变 → 永久缓存；当日盘中 → 短 TTL
        ttl = 90.0 if iso == date.today().isoformat() else 0.0
        set_json(disk_key, payload, ttl)
        return payload
    except Exception:
        if not allow_mock:
            raise
        items = _mock_daily(iso)
        return {
            "trade_date": iso,
            "count": len(items),
            "items": items,
            "source": "mock",
        }


def fetch_lhb_dominance(days: int = 10) -> dict[str, Any]:
    """近 N 个自然日龙虎榜霸榜聚合（单次区间查询，避免逐日慢请求）。"""
    days = max(2, min(int(days), 30))
    end = date.today()
    start = end - timedelta(days=days - 1)

    from app.services.cache import get_json, set_json

    disk_key = f"lhb:dominance:{end.isoformat()}:{days}"
    disk = get_json(disk_key)
    if disk is not None:
        return disk

    try:
        import akshare as ak

        df = ak.stock_lhb_detail_em(
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
        )
    except Exception:
        return {"days": days, "count": 0, "items": [], "source": "error"}
    if df is None or df.empty:
        return {"days": days, "count": 0, "items": [], "source": "akshare"}

    stats: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        code = str(row.get("代码", "")).zfill(6)
        if not code.isdigit():
            continue
        name = str(row.get("名称", "") or code)
        day = _to_iso(row.get("上榜日"))
        net = _safe_float(row.get("龙虎榜净买额"))
        stat = stats.setdefault(
            code,
            {
                "code": code,
                "name": name,
                "dates": set(),
                "count": 0,
                "net_buy": 0.0,
                "last_date": "",
            },
        )
        stat["dates"].add(day)
        stat["count"] += 1
        stat["net_buy"] += net
        if day > stat["last_date"]:
            stat["last_date"] = day

    items: list[dict[str, Any]] = []
    for stat in stats.values():
        stat["days_on_board"] = len(stat["dates"])
        stat.pop("dates", None)
        items.append(stat)
    items.sort(
        key=lambda x: (x.get("days_on_board") or 0, abs(x.get("net_buy") or 0)),
        reverse=True,
    )
    payload = {
        "days": days,
        "count": len(items),
        "items": items[:50],
        "source": "akshare",
    }
    set_json(disk_key, payload, 300.0)
    return payload


def _parse_seat_row(row: Any, side: SeatSide) -> dict[str, Any]:
    seat_name = str(row.get("交易营业部名称", "") or "未知席位")
    buy_amount = _safe_float(row.get("买入金额"))
    # 卖出金额列名在不同版本可能不同，尽量兜底
    sell_amount = _safe_float(row.get("卖出金额"))
    if sell_amount == 0:
        # 有时只有占比与净额，用净额反推
        net = _safe_float(row.get("净额"))
        if side == "sell" and net < 0:
            sell_amount = abs(net)
        elif side == "buy" and buy_amount == 0 and net > 0:
            buy_amount = net
    net_amount = _safe_float(row.get("净额"), buy_amount - sell_amount)
    return {
        "rank": int(_safe_float(row.get("序号"), 0)),
        "seat_name": seat_name,
        "buy_amount": buy_amount,
        "sell_amount": sell_amount,
        "net_amount": net_amount,
        "buy_ratio": _safe_float(row.get("买入金额-占总成交比例")),
        "sell_ratio": _safe_float(row.get("卖出金额-占总成交比例")),
        "seat_kind": _classify_seat(seat_name),
        "reason_type": str(row.get("类型", "") or ""),
        "side": side,
    }


def _resolve_stock_name(code: str, fallback: str | None = None) -> str:
    if fallback:
        return fallback
    try:
        from app.services.stock_meta import lookup_name

        return lookup_name(code) or code
    except Exception:
        return code


def fetch_stock_seats(
    code: str,
    trade_date: str | None = None,
    *,
    name: str | None = None,
    allow_mock: bool = True,
) -> dict[str, Any]:
    """获取个股某日买卖席位，并构建关系图。"""
    code = code.strip().zfill(6)
    ymd = _to_yyyymmdd(trade_date)
    iso = _to_iso(ymd)
    display_name = _resolve_stock_name(code, name)

    from app.services.cache import get_json, set_json

    disk_key = f"lhb:seats:{code}:{ymd}"
    disk = get_json(disk_key)
    if disk is not None:
        return disk

    try:
        import akshare as ak

        # 若未指定日期，尝试取该股最近一次上榜日
        if trade_date is None:
            try:
                dates_df = ak.stock_lhb_stock_detail_date_em(symbol=code)
                if dates_df is not None and not dates_df.empty:
                    # 常见列名：交易日 / 日期
                    col = "交易日" if "交易日" in dates_df.columns else dates_df.columns[0]
                    ymd = _to_yyyymmdd(str(dates_df.iloc[0][col]))
                    iso = _to_iso(ymd)
            except Exception:
                pass

        buy_df = ak.stock_lhb_stock_detail_em(symbol=code, date=ymd, flag="买入")
        sell_df = ak.stock_lhb_stock_detail_em(symbol=code, date=ymd, flag="卖出")

        buys = [_parse_seat_row(row, "buy") for _, row in buy_df.iterrows()] if buy_df is not None else []
        sells = [_parse_seat_row(row, "sell") for _, row in sell_df.iterrows()] if sell_df is not None else []

        if not buys and not sells:
            raise LookupError(f"no seat detail for {code} on {iso}")

        graph = build_seat_graph(
            code=code,
            name=display_name,
            trade_date=iso,
            buys=buys,
            sells=sells,
        )
        payload = {
            "code": code,
            "name": display_name,
            "trade_date": iso,
            "buys": buys,
            "sells": sells,
            "graph": graph,
            "source": "akshare",
        }
        set_json(disk_key, payload, 0.0)
        return payload
    except Exception:
        if not allow_mock:
            raise
        return _mock_seats(code, display_name, iso)
