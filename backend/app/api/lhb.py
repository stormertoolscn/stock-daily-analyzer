from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    HotMoneyListResponse,
    HotMoneyTradesResponse,
    LhbDailyResponse,
    LhbDominanceResponse,
    LhbSeatDetailResponse,
)
from app.services.hotmoney import fetch_hot_money_trades, list_hot_money
from app.services.lhb import fetch_daily_lhb, fetch_lhb_dominance, fetch_stock_seats

router = APIRouter(prefix="/api/lhb", tags=["lhb"])


@router.get("/daily", response_model=LhbDailyResponse)
def get_daily_lhb(
    trade_date: str | None = Query(
        None,
        description="交易日 YYYY-MM-DD 或 YYYYMMDD；空则今天（无数据时回退最近交易日）",
    ),
) -> LhbDailyResponse:
    """龙虎榜日榜列表。"""
    try:
        payload = fetch_daily_lhb(trade_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"龙虎榜数据获取失败: {exc}") from exc
    return LhbDailyResponse(**payload)


@router.get("/dominance", response_model=LhbDominanceResponse)
def get_lhb_dominance(
    days: int = Query(10, ge=2, le=30, description="回溯自然日天数（2-30）"),
) -> LhbDominanceResponse:
    """近 N 日龙虎榜霸榜：上榜次数 / 天数 / 累计净买额（单次区间查询）。"""
    payload = fetch_lhb_dominance(days)
    return LhbDominanceResponse(**payload)


@router.get("/hotmoney", response_model=HotMoneyListResponse)
def get_hot_money_list(
    q: str | None = Query(None, description="搜索游资名 / 别名 / 席位关键词"),
) -> HotMoneyListResponse:
    """一线游资名录（研究用）。"""
    return HotMoneyListResponse(**list_hot_money(q))


@router.get("/hotmoney/{hm_id}/trades", response_model=HotMoneyTradesResponse)
def get_hot_money_trades(
    hm_id: str,
    days: int = Query(7, ge=1, le=365, description="回溯自然日天数（1–365）"),
    start_date: str | None = Query(
        None,
        description="起始日 YYYY-MM-DD；与 end_date 同时提供时优先按区间查询",
    ),
    end_date: str | None = Query(
        None,
        description="结束日 YYYY-MM-DD；与 start_date 同时提供时优先按区间查询",
    ),
) -> HotMoneyTradesResponse:
    """按游资席位关键词追踪近期龙虎榜交易。"""
    try:
        payload = fetch_hot_money_trades(
            hm_id,
            days=days,
            start_date=start_date,
            end_date=end_date,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"游资交易获取失败: {exc}") from exc
    return HotMoneyTradesResponse(**payload)


@router.get("/{code}/seats", response_model=LhbSeatDetailResponse)
def get_stock_seats(
    code: str,
    trade_date: str | None = Query(
        None,
        description="交易日 YYYY-MM-DD 或 YYYYMMDD；空则取该股最近上榜日",
    ),
    name: str | None = Query(None, description="股票名称（可选，用于图谱中心节点）"),
) -> LhbSeatDetailResponse:
    """个股龙虎榜买卖席位 + 关系图谱数据。"""
    if not code or len(code.strip()) < 4:
        raise HTTPException(status_code=400, detail="invalid stock code")
    try:
        payload = fetch_stock_seats(code.strip(), trade_date, name=name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"席位数据获取失败: {exc}") from exc
    return LhbSeatDetailResponse(**payload)
