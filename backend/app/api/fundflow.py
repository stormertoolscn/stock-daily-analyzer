from fastapi import APIRouter, Query

from app.models.schemas import FundFlowReviewResponse
from app.services.fundflow import fetch_fund_flow_review

router = APIRouter(prefix="/api/fundflow", tags=["fundflow"])


@router.get("/review", response_model=FundFlowReviewResponse)
def get_fund_flow_review(
    refresh: bool = Query(False, description="强制刷新缓存"),
    trade_date: str | None = Query(None, description="交易日 YYYY-MM-DD；空则当日"),
) -> FundFlowReviewResponse:
    """资金复盘：当日或指定历史交易日；历史日个股榜基于龙虎榜净买额。"""
    payload = fetch_fund_flow_review(trade_date=trade_date, force=refresh)
    return FundFlowReviewResponse(**payload)
