from fastapi import APIRouter, Query

from app.models.schemas import FundFlowReviewResponse
from app.services.fundflow import fetch_fund_flow_review

router = APIRouter(prefix="/api/fundflow", tags=["fundflow"])


@router.get("/review", response_model=FundFlowReviewResponse)
def get_fund_flow_review(
    refresh: bool = Query(False, description="强制刷新缓存"),
) -> FundFlowReviewResponse:
    """当日资金复盘：净流入/净流出榜 + 板块主题摘要。"""
    payload = fetch_fund_flow_review(force=refresh)
    return FundFlowReviewResponse(**payload)
