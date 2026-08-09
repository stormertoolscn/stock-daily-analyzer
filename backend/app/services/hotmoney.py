"""游资名录与交易追踪（研究用）。"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from app.services.lhb import _safe_float, _to_iso

# 与前端 hotMoneyMap 对齐的核心名录（后端用于匹配席位关键词）
HOT_MONEY_CATALOG: list[dict[str, Any]] = [
    {
        "id": "zmz",
        "name": "章盟主",
        "seat": "国泰君安证券上海江苏路证券营业部",
        "keywords": ["江苏路", "章盟主"],
        "aliases": ["章盟主", "江苏路"],
        "intro": "一线顶级游资，风格偏龙头趋势与中军接力。",
        "featured": True,
        "tier": "S",
    },
    {
        "id": "hlha",
        "name": "欢乐海岸",
        "seat": "国信证券深圳泰然九路证券营业部",
        "keywords": ["欢乐海岸", "泰然九路", "国信证券深圳总部"],
        "aliases": ["欢乐海岸", "国信深圳"],
        "intro": "欢乐海岸系，偏好大票与主流题材趋势。",
        "featured": True,
        "tier": "S",
    },
    {
        "id": "zlg",
        "name": "赵老哥",
        "seat": "中国银河证券绍兴证券营业部",
        "keywords": ["赵老哥", "绍兴", "解放南路"],
        "aliases": ["赵老哥", "绍兴帮"],
        "intro": "打板风格鲜明，常成情绪风向标。",
        "featured": True,
        "tier": "S",
    },
    {
        "id": "cgyz",
        "name": "炒股养家",
        "seat": "华泰证券深圳益田路荣超商务中心证券营业部",
        "keywords": ["炒股养家", "荣超商务", "益田路荣超"],
        "aliases": ["炒股养家", "养家"],
        "intro": "益田路荣超系，短线打板与接力活跃。",
        "featured": True,
        "tier": "S",
    },
    {
        "id": "fxx",
        "name": "方新侠",
        "seat": "国泰君安证券深圳益田路证券营业部",
        "keywords": ["方新侠", "益田路"],
        "aliases": ["方新侠"],
        "intro": "深圳益田路一线席位，题材参与度高。",
        "featured": True,
        "tier": "A",
    },
    {
        "id": "tbt",
        "name": "屠翻天",
        "seat": "中信证券上海溧阳路证券营业部",
        "keywords": ["屠翻天", "溧阳路"],
        "aliases": ["屠翻天"],
        "intro": "溧阳路系，偏好强势题材龙头。",
        "featured": True,
        "tier": "A",
    },
    {
        "id": "xey",
        "name": "小鳄鱼",
        "seat": "海通证券上海建国西路证券营业部",
        "keywords": ["小鳄鱼", "建国西路"],
        "aliases": ["小鳄鱼"],
        "intro": "短线游资，常出现在人气股买卖席。",
        "featured": True,
        "tier": "A",
    },
    {
        "id": "sbwj",
        "name": "首板挖掘",
        "seat": "东方财富证券江苏分公司",
        "keywords": ["首板挖掘", "东财", "东方财富证券"],
        "aliases": ["首板挖掘"],
        "intro": "偏好首板挖掘与情绪接力。",
        "featured": True,
        "tier": "A",
    },
    {
        "id": "cxyz",
        "name": "炒新一族",
        "seat": "华泰证券上海武定路证券营业部",
        "keywords": ["炒新一族", "武定路"],
        "aliases": ["炒新一族"],
        "intro": "专注新股与次新题材炒作。",
        "featured": True,
        "tier": "A",
    },
    {
        "id": "shlyl",
        "name": "上海溧阳路",
        "seat": "中信证券股份有限公司上海溧阳路证券营业部",
        "keywords": ["溧阳路"],
        "aliases": ["上海溧阳路", "溧阳路"],
        "intro": "经典一线游资席位集群。",
        "featured": True,
        "tier": "A",
    },
    {
        "id": "hll",
        "name": "红岭路",
        "seat": "国信证券深圳红岭中路证券营业部",
        "keywords": ["红岭路", "红岭中路"],
        "aliases": ["红岭路"],
        "intro": "红岭路老牌游资席位。",
        "featured": False,
        "tier": "A",
    },
    {
        "id": "ytl",
        "name": "益田路",
        "seat": "华鑫证券深圳益田路证券营业部",
        "keywords": ["华鑫证券深圳益田路", "益田路"],
        "aliases": ["益田路", "华鑫益田路"],
        "intro": "深圳益田路系，常与题材龙头联动。",
        "featured": False,
        "tier": "A",
    },
    {
        "id": "nbhy",
        "name": "宁波和源路",
        "seat": "甬兴证券宁波和源路证券营业部",
        "keywords": ["和源路", "宁波和源"],
        "aliases": ["宁波和源路", "和源路"],
        "intro": "宁波本地知名游资席位，风格偏打板。",
        "featured": False,
        "tier": "A",
    },
    {
        "id": "hzld",
        "name": "湖州劳动路",
        "seat": "国泰君安证券湖州劳动路证券营业部",
        "keywords": ["劳动路", "湖州劳动"],
        "aliases": ["湖州劳动路", "劳动路"],
        "intro": "湖州劳动路，中军接力风格。",
        "featured": False,
        "tier": "A",
    },
]


def list_hot_money(q: str | None = None) -> dict[str, Any]:
    query = (q or "").strip().lower()
    items = HOT_MONEY_CATALOG
    if query:
        items = [
            h
            for h in HOT_MONEY_CATALOG
            if query
            in " ".join(
                [h["name"], h["seat"], *h.get("aliases", []), *h.get("keywords", [])]
            ).lower()
        ]
    # featured / tier 优先
    items = sorted(
        items,
        key=lambda h: (0 if h.get("featured") else 1, h.get("tier") or "Z", h["name"]),
    )
    return {"count": len(items), "items": items}


def get_hot_money(hm_id: str) -> dict[str, Any] | None:
    for h in HOT_MONEY_CATALOG:
        if h["id"] == hm_id:
            return h
    return None


def _seat_matched(seat_name: str, keywords: list[str]) -> bool:
    text = seat_name or ""
    return any(k and k in text for k in keywords)


def _mock_trades(trader: dict[str, Any], trade_date: str) -> list[dict[str, Any]]:
    iso = _to_iso(trade_date)
    samples = [
        ("000021", "深科技", "buy", 45_600_000),
        ("300750", "宁德时代", "buy", 32_100_000),
        ("600519", "贵州茅台", "sell", 28_700_000),
        ("300418", "昆仑万维", "buy", 51_200_000),
        ("002594", "比亚迪", "sell", 19_800_000),
    ]
    out = []
    for i, (code, name, side, amt) in enumerate(samples):
        out.append(
            {
                "trade_date": iso,
                "code": code,
                "name": name,
                "side": side,
                "seat_name": trader["seat"],
                "buy_amount": amt if side == "buy" else 0.0,
                "sell_amount": amt if side == "sell" else 0.0,
                "net_amount": amt if side == "buy" else -amt,
                "reason": "研究样本（mock）",
            }
        )
    return out


def _resolve_trade_name(name: str) -> tuple[str, str]:
    """返回 (code, canonical_name)。"""
    nm = (name or "").strip().replace("\u3000", "").replace(" ", "")
    if not nm or nm.startswith("（") or nm.startswith("("):
        return "", nm
    try:
        from app.services.stock_meta import lookup_code_by_name, lookup_name, search_stocks

        code = lookup_code_by_name(nm) or ""
        canon = ""
        if not code:
            hits = search_stocks(nm, limit=5)
            hit = next((h for h in hits if h.get("name") == nm), None) or (
                hits[0] if hits else None
            )
            if hit and hit.get("code"):
                code = str(hit["code"])
                canon = str(hit.get("name") or nm)
        if code:
            canon = canon or lookup_name(code) or nm
            return code, canon
    except Exception:
        pass
    return "", nm


def fetch_hot_money_trades(
    hm_id: str,
    *,
    days: int = 7,
    start_date: str | date | None = None,
    end_date: str | date | None = None,
    allow_mock: bool = True,
) -> dict[str, Any]:
    trader = get_hot_money(hm_id)
    if trader is None:
        raise LookupError(f"unknown hot money id: {hm_id}")

    keywords = list(trader.get("keywords") or [])

    def _parse_day(value: str | date | None) -> date | None:
        if value is None:
            return None
        if isinstance(value, date):
            return value
        text = str(value).strip()[:10]
        if not text:
            return None
        return date.fromisoformat(text)

    start_d = _parse_day(start_date)
    end_d = _parse_day(end_date)
    if start_d and end_d:
        if start_d > end_d:
            start_d, end_d = end_d, start_d
        days = max(1, (end_d - start_d).days + 1)
        # 区间查询按所选日历日拉取，不再额外缓冲
        start_s = start_d.strftime("%Y%m%d")
        end_s = end_d.strftime("%Y%m%d")
        end = end_d
    else:
        days = max(1, min(int(days), 365))
        end = datetime.now().date()
        start_d = end - timedelta(days=days + 5)  # 多取几天覆盖非交易日
        start_s = start_d.strftime("%Y%m%d")
        end_s = end.strftime("%Y%m%d")

    trades: list[dict[str, Any]] = []
    source = "mock"

    from app.services.cache import get_json, set_json

    disk_key = f"lhb:hm:{hm_id}:{start_s}:{end_s}"
    disk = get_json(disk_key)
    if disk is not None:
        return disk

    try:
        import akshare as ak

        df = ak.stock_lhb_hyyyb_em(start_date=start_s, end_date=end_s)
        if df is not None and not df.empty:
            source = "akshare"
            for _, row in df.iterrows():
                seat = str(row.get("营业部名称", "") or "")
                if not _seat_matched(seat, keywords):
                    continue
                trade_date = _to_iso(row.get("上榜日"))
                buy_amt = _safe_float(row.get("买入总金额"))
                sell_amt = _safe_float(row.get("卖出总金额"))
                net = _safe_float(row.get("总买卖净额"), buy_amt - sell_amt)
                stocks_raw = str(row.get("买入股票", "") or "").strip()
                names = [x for x in stocks_raw.replace("，", " ").split() if x and x != "--"]
                if not names:
                    trades.append(
                        {
                            "trade_date": trade_date,
                            "code": "",
                            "name": "（未披露个股）",
                            "side": "buy" if net >= 0 else "sell",
                            "seat_name": seat,
                            "buy_amount": buy_amt,
                            "sell_amount": sell_amt,
                            "net_amount": net,
                            "reason": "活跃营业部汇总",
                        }
                    )
                    continue
                # 金额均摊到点名个股，便于列表展示
                share = (buy_amt or abs(net)) / max(len(names), 1)
                for nm in names[:12]:
                    code, canon = _resolve_trade_name(nm)
                    trades.append(
                        {
                            "trade_date": trade_date,
                            "code": code,
                            "name": canon or nm,
                            "side": "buy" if net >= 0 else "sell",
                            "seat_name": seat,
                            "buy_amount": share if net >= 0 else 0.0,
                            "sell_amount": share if net < 0 else 0.0,
                            "net_amount": share if net >= 0 else -share,
                            "reason": "活跃营业部·买入股票",
                        }
                    )
    except Exception:
        if not allow_mock:
            raise
        trades = _mock_trades(trader, end.isoformat())
        source = "mock"

    if not trades and allow_mock:
        trades = _mock_trades(trader, end.isoformat())
        source = "mock"

    # 再扫一遍补全可能漏掉的代码
    for item in trades:
        if not item.get("code") and item.get("name"):
            code, canon = _resolve_trade_name(str(item["name"]))
            if code:
                item["code"] = code
                item["name"] = canon or item["name"]

    trades.sort(key=lambda x: (x.get("trade_date") or "", abs(x.get("net_amount") or 0)), reverse=True)

    payload = {
        "trader": trader,
        "days": days,
        "count": len(trades),
        "items": trades[:800],
        "source": source,
        "range_start": _to_iso(start_s),
        "range_end": _to_iso(end_s),
    }
    if source != "mock":
        # 历史区间不可变 → 永久；含今日 → 短 TTL（盘中可能更新）
        ttl = 90.0 if end.isoformat() >= date.today().isoformat() else 0.0
        set_json(disk_key, payload, ttl)
    return payload
