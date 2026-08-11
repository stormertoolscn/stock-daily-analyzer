import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import backtest, fundflow, lhb, stock
from app.core.config import settings


def _warmup_stock_universe() -> None:
    """后台预热代码-名称-拼音表，避免阻塞 Uvicorn startup。"""
    try:
        from app.services.stock_meta import get_stock_universe

        get_stock_universe()
    except Exception:
        pass


@asynccontextmanager
async def lifespan(_app: FastAPI):

    # 同步预热会卡在 “Waiting for application startup” 数十秒；改为后台线程
    threading.Thread(
        target=_warmup_stock_universe,
        name="stock-universe-warmup",
        daemon=True,
    ).start()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stock.router)
app.include_router(lhb.router)
app.include_router(fundflow.router)
app.include_router(backtest.router)



@app.get("/api/health")
def health():
    return {"status": "ok"}
