from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    BacktestRunRequest,
    BacktestRunResponse,
    BacktestSignalItem,
)
from app.services.backtest import fetch_signals, list_strategies, run_backtest

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


@router.get("/strategies")
def get_backtest_strategies() -> dict:
    """预置回测策略列表。"""
    return {"items": list_strategies()}


@router.post("/run", response_model=BacktestRunResponse)
def post_backtest_run(req: BacktestRunRequest) -> BacktestRunResponse:
    """运行多标的等权回测：净值曲线 / 回撤 / 交易明细 / 绩效指标。"""
    codes = [c.strip() for c in req.codes.replace("，", ",").split(",") if c.strip()]
    if not codes:
        raise HTTPException(status_code=400, detail="codes is required")
    if len(codes) > 20:
        raise HTTPException(status_code=400, detail="最多 20 只")

    params = req.params.model_dump()
    initial_cash = float(params.pop("initial_cash", 1000000))
    start_date = str(params.pop("start_date", ""))
    payload = run_backtest(
        strategy=req.strategy,
        codes=codes,
        params=params,
        initial_cash=initial_cash,
        start_date=start_date,
    )
    return BacktestRunResponse(**payload)


@router.get("/signals", response_model=list[BacktestSignalItem])
def get_backtest_signals(
    codes: str = Query(..., min_length=4, description="逗号分隔股票代码"),
    strategy: str = Query("ma_cross", description="策略 id"),
) -> list[BacktestSignalItem]:
    """当前信号快照：各标的最新买入/卖出信号与关键指标。"""
    raw = [c.strip() for c in codes.replace("，", ",").split(",") if c.strip()]
    if not raw:
        raise HTTPException(status_code=400, detail="codes is required")
    if len(raw) > 20:
        raise HTTPException(status_code=400, detail="最多 20 只")
    return [BacktestSignalItem(**s) for s in fetch_signals(raw, strategy)]