from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import stock
from app.core.config import settings

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stock.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
