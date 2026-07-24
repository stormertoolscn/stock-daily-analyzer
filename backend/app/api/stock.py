from fastapi import APIRouter, HTTPException

from app.models.schemas import StockBasicInfo

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
        name="示例股票",
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


@router.get("/{code}/basic", response_model=StockBasicInfo)
def get_stock_basic(code: str) -> StockBasicInfo:
    """获取单只股票的基础行情数据（示例接口，用于前端联调）。

    优先通过 akshare 拉取实时行情；若网络不可用或未安装依赖，
    降级返回 mock 数据，保证前端开发不被外部数据源阻塞。
    """
    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    info = _fetch_from_akshare(code)
    if info is None:
        info = _mock_basic_info(code)
    return info
