from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import lhb, stock
from app.core.config import settings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 预热代码-名称-拼音表，避免首次搜索卡顿
    try:
        from app.services.stock_meta import get_stock_universe

        get_stock_universe()
    except Exception:
        pass
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


@app.get("/api/health")
def health():
    return {"status": "ok"}
