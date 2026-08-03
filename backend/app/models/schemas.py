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


class LhbDailyItem(BaseModel):
    code: str
    name: str
    trade_date: str
    reason: str = ""
    insight: str = ""
    close: float = 0
    change_pct: float = 0
    net_buy: float = 0
    buy_amount: float = 0
    sell_amount: float = 0
    lhb_amount: float = 0
    market_amount: float = 0
    net_buy_ratio: Optional[float] = None
    turnover_ratio: Optional[float] = None
    turnover_rate: Optional[float] = None
    float_mv: Optional[float] = None
    ret_1d: Optional[float] = None
    ret_2d: Optional[float] = None
    ret_5d: Optional[float] = None
    ret_10d: Optional[float] = None
    source: str = "akshare"


class LhbDailyResponse(BaseModel):
    trade_date: str
    count: int
    items: list[LhbDailyItem]
    source: str


class LhbSeatItem(BaseModel):
    rank: int = 0
    seat_name: str
    buy_amount: float = 0
    sell_amount: float = 0
    net_amount: float = 0
    buy_ratio: float = 0
    sell_ratio: float = 0
    seat_kind: Literal["institution", "hotmoney", "other"] = "hotmoney"
    reason_type: str = ""
    side: Literal["buy", "sell"]


class LhbGraphNode(BaseModel):
    id: str
    label: str
    kind: Literal["stock", "seat"]
    code: Optional[str] = None
    full_label: Optional[str] = None
    seat_kind: Optional[Literal["institution", "hotmoney", "other"]] = None
    amount: float = 0


class LhbGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    side: Literal["buy", "sell"]
    amount: float = 0
    label: str = ""


class LhbGraphPayload(BaseModel):
    trade_date: str
    nodes: list[LhbGraphNode]
    edges: list[LhbGraphEdge]


class LhbSeatDetailResponse(BaseModel):
    code: str
    name: str
    trade_date: str
    buys: list[LhbSeatItem]
    sells: list[LhbSeatItem]
    graph: LhbGraphPayload
    source: str
