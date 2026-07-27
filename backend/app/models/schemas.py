from typing import Literal, Optional

from pydantic import BaseModel, Field


class StockBasicInfo(BaseModel):
    code: str
    name: str
    price: float
    change_pct: float
    open: float
    high: float
    low: float
    prev_close: float
    volume: float
    turnover: float
    source: str


class KlineBarOut(BaseModel):
    timestamp: int = Field(..., description="毫秒时间戳")
    open: float
    high: float
    low: float
    close: float
    volume: float
    avg: Optional[float] = Field(None, description="分时均价(VWAP)")
    phase: Optional[Literal["auction", "continuous"]] = Field(
        None,
        description="分时阶段：集合竞价 / 连续竞价",
    )


class KlineResponse(BaseModel):
    code: str
    name: Optional[str] = None
    period: Literal["intraday", "day", "week", "month"]
    chart_type: Literal["candle", "intraday"] = "candle"
    adjust: Literal["qfq", "hfq", "none"] = "qfq"
    adjust_applied: Literal["qfq", "hfq", "none"] = "qfq"
    source: str
    prev_close: Optional[float] = None
    trade_date: Optional[str] = None
    count: int
    has_auction: Optional[bool] = None
    auction_count: Optional[int] = None
    bars: list[KlineBarOut]


class StockSearchItem(BaseModel):
    code: str
    name: str
    pinyin: str = ""
    initials: str = ""
    market: Optional[str] = Field(None, description="SH / SZ / BJ")


class StockSearchResponse(BaseModel):
    query: str
    items: list[StockSearchItem]
