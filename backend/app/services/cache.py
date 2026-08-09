"""通用磁盘 JSON 缓存：历史数据永久保留，当日数据短 TTL，重启不丢。

设计目标：已经下载过的数据留在本地，网上只补差异。
- ttl=0 表示永久（历史交易日数据不可变）
- ttl>0 表示该 key 允许过期（当日盘中数据等）
- 写入使用临时文件 + 原子替换，避免并发写坏缓存
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parents[2] / "data_cache"
_lock = threading.Lock()


def _key_path(key: str) -> Path:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / f"{digest}.json"


def get_json(key: str) -> object | None:
    """读取缓存；过期或损坏返回 None。"""
    path = _key_path(key)
    try:
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        saved = float(payload.get("saved_at") or 0)
        ttl = float(payload.get("ttl") or 0)
        if ttl > 0 and time.time() - saved > ttl:
            return None
        data = payload.get("data")
        # mock 数据不持久化：网络恢复后不能永远停留在示意数据
        if isinstance(data, dict) and data.get("source") == "mock":
            return None
        return data
    except Exception:
        return None


def set_json(key: str, data: object, ttl: float = 0.0) -> None:
    """写入缓存；失败静默（缓存不影响主流程）。"""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {"saved_at": time.time(), "ttl": ttl, "data": data}
        path = _key_path(key)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        pass


def clear_key(key: str) -> None:
    """删除某个缓存键（调试/强制刷新用）。"""
    try:
        path = _key_path(key)
        if path.exists():
            path.unlink()
    except Exception:
        pass


def cache_stats() -> dict[str, int]:
    """缓存文件数量与磁盘占用（字节）。"""
    total = 0
    count = 0
    try:
        if CACHE_DIR.exists():
            for p in CACHE_DIR.iterdir():
                if p.suffix == ".json":
                    count += 1
                    try:
                        total += p.stat().st_size
                    except OSError:
                        pass
    except Exception:
        pass
    return {"files": count, "bytes": total}