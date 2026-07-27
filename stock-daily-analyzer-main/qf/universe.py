from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from market_data import fetch_a_share_universe, normalize_code


@dataclass(frozen=True)
class Stock:
    code: str
    name: str


class UniverseProvider:
    def get_universe(self, *, max_stocks: Optional[int] = None) -> List[Stock]:
        raise NotImplementedError


class AkshareAStockUniverseProvider(UniverseProvider):
    def __init__(self, *, exclude_prefix: List[str], include_prefix: Optional[List[str]] = None, exclude_st: bool = True):
        self._exclude_prefix = exclude_prefix
        self._include_prefix = include_prefix
        self._exclude_st = exclude_st

    def _valid_code(self, code: str) -> bool:
        c = normalize_code(code)
        if self._include_prefix:
            ok = any(c.startswith(p) for p in self._include_prefix)
            if not ok:
                return False
        for p in self._exclude_prefix:
            if c.startswith(p):
                return False
        return True

    def get_universe(self, *, max_stocks: Optional[int] = None) -> List[Stock]:
        rows, _source = fetch_a_share_universe()
        stocks: List[Stock] = []
        for code, name in rows:
            if not self._valid_code(code):
                continue
            if self._exclude_st and "ST" in name.upper():
                continue
            stocks.append(Stock(code=code, name=name))
            if max_stocks and len(stocks) >= max_stocks:
                break
        return stocks
