"""当日资金复盘：个股主力净流入/流出榜 + 板块热点摘要。"""

from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any

_CACHE: dict[str, Any] | None = None
_CACHE_TS = 0.0
_CACHE_TTL = 90.0


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == "" or v == "-":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _fmt_yi(amount: float) -> str:
    yi = amount / 1e8
    if abs(yi) >= 10:
        return f"{yi:.1f}亿"
    if abs(yi) >= 1:
        return f"{yi:.2f}亿"
    wan = amount / 1e4
    if abs(wan) >= 1:
        return f"{wan:.0f}万"
    return f"{amount:.0f}"


def _mock_review(trade_date: str) -> dict[str, Any]:
    """网络不可用时的示意结构（可双击进 K 线）。"""
    inflows = [
        {"code": "603228", "name": "景旺电子", "net_amount": 8.2e8, "change_pct": 5.2, "rank": 1},
        {"code": "300476", "name": "胜宏科技", "net_amount": 6.1e8, "change_pct": 4.1, "rank": 2},
        {"code": "600183", "name": "生益科技", "net_amount": 5.4e8, "change_pct": 3.6, "rank": 3},
        {"code": "002463", "name": "沪电股份", "net_amount": 4.8e8, "change_pct": 3.2, "rank": 4},
        {"code": "002281", "name": "光迅科技", "net_amount": 4.2e8, "change_pct": 2.8, "rank": 5},
        {"code": "300308", "name": "中际旭创", "net_amount": 3.9e8, "change_pct": 2.1, "rank": 6},
        {"code": "300502", "name": "新易盛", "net_amount": 3.5e8, "change_pct": 1.9, "rank": 7},
        {"code": "600111", "name": "北方稀土", "net_amount": 3.1e8, "change_pct": 2.4, "rank": 8},
        {"code": "000975", "name": "银泰黄金", "net_amount": 2.8e8, "change_pct": 1.6, "rank": 9},
        {"code": "603259", "name": "药明康德", "net_amount": 2.5e8, "change_pct": 1.2, "rank": 10},
    ]
    outflows = [
        {"code": "300285", "name": "国瓷材料", "net_amount": -7.6e8, "change_pct": -4.8, "rank": 1},
        {"code": "688584", "name": "长鑫科技", "net_amount": -5.9e8, "change_pct": -3.5, "rank": 2},
        {"code": "002407", "name": "多氟多", "net_amount": -4.7e8, "change_pct": -3.1, "rank": 3},
        {"code": "300408", "name": "三环集团", "net_amount": -4.1e8, "change_pct": -2.6, "rank": 4},
        {"code": "000636", "name": "风华高科", "net_amount": -3.6e8, "change_pct": -2.2, "rank": 5},
        {"code": "000938", "name": "紫光股份", "net_amount": -3.2e8, "change_pct": -1.8, "rank": 6},
        {"code": "688256", "name": "寒武纪", "net_amount": -2.9e8, "change_pct": -2.9, "rank": 7},
        {"code": "300750", "name": "宁德时代", "net_amount": -2.4e8, "change_pct": -0.9, "rank": 8},
        {"code": "600549", "name": "厦门钨业", "net_amount": -2.1e8, "change_pct": -1.5, "rank": 9},
        {"code": "600958", "name": "东方证券", "net_amount": -1.8e8, "change_pct": -1.1, "rank": 10},
    ]
    themes = [
        {"name": "PCB", "net_amount": 12.5e8, "side": "in"},
        {"name": "光通信", "net_amount": 9.8e8, "side": "in"},
        {"name": "稀土有色", "net_amount": 7.2e8, "side": "in"},
        {"name": "半导体设备", "net_amount": -6.4e8, "side": "out"},
        {"name": "被动元件", "net_amount": -5.1e8, "side": "out"},
    ]
    summary = (
        f"{trade_date} 资金复盘（示意）：净流入集中在 PCB、光通信与稀土有色；"
        "净流出以被动元件、半导体与部分科技成长股为主。双击个股进入 K 线复盘。"
    )
    return {
        "trade_date": trade_date,
        "session_label": "全日",
        "summary": summary,
        "themes": themes,
        "inflows": inflows,
        "outflows": outflows,
        "inflow_total": sum(x["net_amount"] for x in inflows),
        "outflow_total": sum(x["net_amount"] for x in outflows),
        "source": "mock",
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }


def _pick_col(df: Any, *names: str) -> str | None:
    cols = list(df.columns)
    for n in names:
        if n in cols:
            return n
    # 模糊：今日主力净流入-净额
    for c in cols:
        s = str(c)
        if all(k in s for k in ("主力", "净流入", "净额")):
            return c
    return None


def _load_individual_rank(limit: int = 30) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    import akshare as ak

    df = ak.stock_individual_fund_flow_rank(indicator="今日")
    if df is None or df.empty:
        raise RuntimeError("empty individual fund flow")
    code_col = _pick_col(df, "代码", "股票代码")
    name_col = _pick_col(df, "名称", "股票名称")
    net_col = _pick_col(df, "今日主力净流入-净额", "主力净流入-净额", "主力净流入净额")
    pct_col = _pick_col(df, "今日涨跌幅", "涨跌幅")
    if not code_col or not name_col or not net_col:
        raise RuntimeError(f"unexpected columns: {list(df.columns)}")

    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        code = str(r[code_col]).zfill(6)
        if not code.isdigit():
            continue
        net = _safe_float(r[net_col])
        rows.append(
            {
                "code": code,
                "name": str(r[name_col]).strip(),
                "net_amount": net,
                "change_pct": _safe_float(r[pct_col]) if pct_col else 0.0,
            }
        )
    inflows = sorted([x for x in rows if x["net_amount"] > 0], key=lambda x: x["net_amount"], reverse=True)
    outflows = sorted([x for x in rows if x["net_amount"] < 0], key=lambda x: x["net_amount"])
    for i, x in enumerate(inflows[:limit], 1):
        x["rank"] = i
    for i, x in enumerate(outflows[:limit], 1):
        x["rank"] = i
    return inflows[:limit], outflows[:limit], "akshare"


def _load_themes(limit: int = 8) -> list[dict[str, Any]]:
    import akshare as ak

    themes: list[dict[str, Any]] = []
    for sector_type in ("概念资金流", "行业资金流"):
        try:
            df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type=sector_type)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        name_col = _pick_col(df, "名称", "板块名称")
        net_col = _pick_col(df, "今日主力净流入-净额", "主力净流入-净额")
        if not name_col or not net_col:
            continue
        for _, r in df.iterrows():
            net = _safe_float(r[net_col])
            if abs(net) < 1e7:
                continue
            themes.append(
                {
                    "name": str(r[name_col]).strip(),
                    "net_amount": net,
                    "side": "in" if net >= 0 else "out",
                    "kind": "concept" if "概念" in sector_type else "industry",
                }
            )
    # 取流入/流出各若干
    ups = sorted([t for t in themes if t["side"] == "in"], key=lambda x: x["net_amount"], reverse=True)
    downs = sorted([t for t in themes if t["side"] == "out"], key=lambda x: x["net_amount"])
    out = ups[: max(3, limit // 2)] + downs[: max(3, limit // 2)]
    return out[:limit]


def _build_summary(
    trade_date: str,
    themes: list[dict[str, Any]],
    inflows: list[dict[str, Any]],
    outflows: list[dict[str, Any]],
) -> str:
    in_themes = [t["name"] for t in themes if t["side"] == "in"][:4]
    out_themes = [t["name"] for t in themes if t["side"] == "out"][:3]
    in_names = [f"{x['name']}" for x in inflows[:6]]
    out_names = [f"{x['name']}" for x in outflows[:6]]
    parts = [f"{trade_date} 资金动向复盘"]
    if in_themes:
        parts.append(f"净流入主线：{'、'.join(in_themes)}。")
    if in_names:
        parts.append(f"个股承接靠前：{'、'.join(in_names)}。")
    if out_themes:
        parts.append(f"净流出方向：{'、'.join(out_themes)}。")
    if out_names:
        parts.append(f"资金撤离靠前：{'、'.join(out_names)}。")
    parts.append("双击个股可进入 K 线复盘。")
    return "".join(parts)


def fetch_fund_flow_review(*, force: bool = False) -> dict[str, Any]:
    global _CACHE, _CACHE_TS
    now = time.time()
    if not force and _CACHE is not None and now - _CACHE_TS < _CACHE_TTL:
        return _CACHE

    trade_date = date.today().isoformat()
    try:
        inflows, outflows, source = _load_individual_rank(28)
        try:
            themes = _load_themes(10)
        except Exception:
            themes = []
        payload = {
            "trade_date": trade_date,
            "session_label": "今日",
            "summary": _build_summary(trade_date, themes, inflows, outflows),
            "themes": themes,
            "inflows": inflows,
            "outflows": outflows,
            "inflow_total": sum(x["net_amount"] for x in inflows),
            "outflow_total": sum(x["net_amount"] for x in outflows),
            "source": source,
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }
        _CACHE = payload
        _CACHE_TS = now
        return payload
    except Exception:
        mock = _mock_review(trade_date)
        _CACHE = mock
        _CACHE_TS = now
        return mock
