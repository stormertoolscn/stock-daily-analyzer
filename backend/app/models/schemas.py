from pydantic import BaseModel


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
