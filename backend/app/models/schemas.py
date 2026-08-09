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


class StockQuoteItem(BaseModel):
    """盘中最新价；收盘后即为当日收盘价。"""

    code: str
    name: str = ""
    price: Optional[float] = None
    change_pct: Optional[float] = None
    source: str = ""


class StockQuotesResponse(BaseModel):
    count: int
    items: list[StockQuoteItem]


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


class HotMoneyItemOut(BaseModel):
    id: str
    name: str
    seat: str
    keywords: list[str] = []
    aliases: list[str] = []
    intro: str = ""
    featured: bool = False
    tier: Optional[str] = None


class HotMoneyListResponse(BaseModel):
    count: int
    items: list[HotMoneyItemOut]


class HotMoneyTradeItem(BaseModel):
    trade_date: str
    code: str = ""
    name: str
    side: Literal["buy", "sell"] = "buy"
    seat_name: str = ""
    buy_amount: float = 0
    sell_amount: float = 0
    net_amount: float = 0
    reason: str = ""


class HotMoneyTradesResponse(BaseModel):
    trader: HotMoneyItemOut
    days: int
    count: int
    items: list[HotMoneyTradeItem]
    source: str
    range_start: str
    range_end: str


class ResearchStrategyPoints(BaseModel):
    ideal_buy: str = ""
    secondary_buy: str = ""
    stop_loss: str = ""
    take_profit: str = ""


class ResearchDataViewItem(BaseModel):
    label: str
    value: str


class StockResearchReport(BaseModel):
    """对齐 Daily Stock Analysis 决策报告字段（研究用）。"""

    model_config = {"protected_namespaces": ()}

    code: str
    name: str
    price: float
    change_pct: float
    score: int
    sentiment: str = ""
    operation_advice: str = ""
    trend_prediction: str = ""
    analysis_summary: str = ""
    strategy: ResearchStrategyPoints
    risks: list[str] = []
    catalysts: list[str] = []
    checklist: list[str] = []
    data_view: list[ResearchDataViewItem] = []
    boards: list[str] = []
    markdown: str = ""
    created_at: str = ""
    source: str = ""
    phase_label: str = ""
    model_used: str = ""


class FundFlowStockItem(BaseModel):
    code: str
    name: str
    net_amount: float
    change_pct: float = 0
    rank: int = 0


class FundFlowThemeItem(BaseModel):
    name: str
    net_amount: float
    side: Literal["in", "out"] = "in"
    kind: str = ""


class FundFlowReviewResponse(BaseModel):
    trade_date: str
    session_label: str = "今日"
    summary: str = ""
    themes: list[FundFlowThemeItem] = []
    inflows: list[FundFlowStockItem] = []
    outflows: list[FundFlowStockItem] = []
    inflow_total: float = 0
    outflow_total: float = 0
    source: str = ""
    updated_at: str = ""
    market: Optional[dict] = None
