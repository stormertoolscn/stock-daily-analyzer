from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    KlineResponse,
    StockBasicInfo,
    StockQuotesResponse,
    StockResearchReport,
    StockSearchItem,
    StockSearchResponse,
)
from app.services.ohlc import fetch_kline
from app.services.quotes import fetch_quotes
from app.services.research import build_research_report
from app.services.stock_meta import lookup_name, search_stocks

router = APIRouter(prefix="/api/stock", tags=["stock"])


def _fetch_from_akshare(code: str) -> StockBasicInfo | None:
    try:
        import akshare as ak

        df = ak.stock_zh_a_spot_em()
        row = df[df["代码"] == code]
        if row.empty:
            return None
        r = row.iloc[0]
        return StockBasicInfo(
            code=code,
            name=str(r["名称"]),
            price=float(r["最新价"]),
            change_pct=float(r["涨跌幅"]),
            open=float(r["今开"]),
            high=float(r["最高"]),
            low=float(r["最低"]),
            prev_close=float(r["昨收"]),
            volume=float(r["成交量"]),
            turnover=float(r["成交额"]),
            source="akshare",
        )
    except Exception:
        return None


def _mock_basic_info(code: str) -> StockBasicInfo:
    return StockBasicInfo(
        code=code,
        name=lookup_name(code) or "示例股票",
        price=8.01,
        change_pct=-2.84,
        open=8.21,
        high=8.53,
        low=7.64,
        prev_close=8.24,
        volume=15291,
        turnover=122_345_600,
        source="mock",
    )


@router.get("/search", response_model=StockSearchResponse)
def get_stock_search(
    q: str = Query(..., min_length=1, description="代码 / 名称 / 拼音 / 首字母"),
    limit: int = Query(12, ge=1, le=30),
) -> StockSearchResponse:
    """股票联想搜索：601666、平煤、PMGF 均可。"""
    try:
        items = search_stocks(q, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"搜索失败: {exc}") from exc
    return StockSearchResponse(
        query=q,
        items=[StockSearchItem(**it) for it in items],
    )


@router.get("/quotes", response_model=StockQuotesResponse)
def get_stock_quotes(
    codes: str = Query(
        ...,
        min_length=4,
        description="逗号分隔代码，如 603400,920092",
    ),
) -> StockQuotesResponse:
    """批量取价：盘中=最新价，收盘后=收盘价。"""
    raw = [x.strip() for x in codes.replace("，", ",").split(",") if x.strip()]
    if not raw:
        raise HTTPException(status_code=400, detail="codes is required")
    if len(raw) > 80:
        raise HTTPException(status_code=400, detail="最多 80 只")
    try:
        items = fetch_quotes(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"行情获取失败: {exc}") from exc
    return StockQuotesResponse(count=len(items), items=items)


@router.get("/{code}/basic", response_model=StockBasicInfo)
def get_stock_basic(code: str) -> StockBasicInfo:
    """获取单只股票的基础行情数据。"""
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    info = _fetch_from_akshare(code)
    if info is None:
        info = _mock_basic_info(code)
    elif not info.name or info.name.startswith("股票"):
        resolved = lookup_name(code)
        if resolved:
            info.name = resolved
    return info


@router.get("/{code}/research", response_model=StockResearchReport)
def get_stock_research(code: str) -> StockResearchReport:
    """个股重点研究：DSA 风格决策报告结构（技术面启发式）。"""
    raw = (code or "").strip()
    if not raw or len(raw) < 4:
        raise HTTPException(status_code=400, detail="invalid stock code")
    try:
        basic = get_stock_basic(raw)
        kline = fetch_kline(raw, ui_period="day", adjust="qfq")
        bars = kline.get("bars") or []
        payload = build_research_report(
            code=raw.zfill(6) if raw.isdigit() else raw,
            name=basic.name or lookup_name(raw) or raw,
            basic=basic.model_dump(),
            bars=bars,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"研究数据生成失败: {exc}") from exc
    return StockResearchReport(**payload)


@router.get("/{code}/kline", response_model=KlineResponse)
def get_stock_kline(
    code: str,
    period: Literal["intraday", "day", "week", "month"] = Query(
        "day",
        description="分时 / 日 / 周 / 月",
    ),
    adjust: Literal["qfq", "hfq", "none"] = Query(
        "qfq",
        description="复权方式（当前数据源实际固定前复权）",
    ),
    trade_date: str | None = Query(
        None,
        description="分时交易日 YYYY-MM-DD；空则最新交易日",
    ),
) -> KlineResponse:
    """获取 K 线 OHLCV，数据来自 stock-daily-analyzer 的 market_data 链路。"""
    if not code or len(code.strip()) < 4:
        raise HTTPException(status_code=400, detail="invalid stock code")

    try:
        payload = fetch_kline(
            code.strip(),
            ui_period=period,
            adjust=adjust,
            trade_date=trade_date,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — 对外统一 502
        raise HTTPException(
            status_code=502,
            detail=f"行情源异常: {exc}",
        ) from exc

    if not payload.get("name"):
        payload["name"] = lookup_name(payload["code"])

    return KlineResponse(**payload)
