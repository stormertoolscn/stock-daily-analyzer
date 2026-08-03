"""Offline unit tests for LHB graph helpers (no network)."""

from app.services.lhb import build_seat_graph, fetch_daily_lhb, fetch_stock_seats


def test_build_seat_graph_links_buy_and_sell():
    buys = [
        {
            "seat_name": "机构专用",
            "buy_amount": 1e7,
            "sell_amount": 0,
            "net_amount": 1e7,
            "seat_kind": "institution",
        }
    ]
    sells = [
        {
            "seat_name": "华泰证券股份有限公司深圳益田路证券营业部",
            "buy_amount": 0,
            "sell_amount": 8e6,
            "net_amount": -8e6,
            "seat_kind": "hotmoney",
        }
    ]
    graph = build_seat_graph(
        code="000021",
        name="深科技",
        trade_date="2026-08-03",
        buys=buys,
        sells=sells,
    )
    assert len(graph["nodes"]) == 3
    assert len(graph["edges"]) == 2
    sides = {e["side"] for e in graph["edges"]}
    assert sides == {"buy", "sell"}


def test_fetch_daily_falls_back_to_mock():
    payload = fetch_daily_lhb("2099-01-01", allow_mock=True)
    assert payload["source"] in {"akshare", "mock"}
    assert payload["count"] >= 1
    assert payload["items"][0]["code"]


def test_fetch_seats_falls_back_to_mock():
    payload = fetch_stock_seats("000021", "2099-01-01", name="深科技", allow_mock=True)
    assert payload["source"] in {"akshare", "mock"}
    assert payload["buys"]
    assert payload["sells"]
    assert payload["graph"]["nodes"]
