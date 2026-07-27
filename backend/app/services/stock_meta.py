from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass

_CACHE_TTL_SEC = 24 * 3600
_lock = threading.Lock()
_cache_rows: list["StockMeta"] | None = None
_cache_loaded_at = 0.0
_pinyin_ready = False

# 申购码 / 临时代码 / 常见误记 → 正式交易代码
_CODE_ALIASES: dict[str, str] = {
    "787825": "688825",  # 长鑫科技网上申购码
    "A06978": "688825",  # 第三方/临时代码误记
    "06978": "688825",
    "006978": "688825",
}

# 扩位简称 / 口语 / 拼音首字母 → 正式代码
_NAME_ALIASES: dict[str, str] = {
    "长鑫科技": "688825",
    "长鑫": "688825",
    "长鑫存储": "688825",
    "CXTK": "688825",
    "CXMT": "688825",
    "CX": "688825",
    "NCX": "688825",
}

# 新股临时代码校验：交易所前缀规则（用于提示，不拦检索）
_CODE_MARKET: tuple[tuple[str, str], ...] = (
    ("688", "SH"),  # 科创板
    ("689", "SH"),  # 科创板 CDR 等
    ("600", "SH"),
    ("601", "SH"),
    ("603", "SH"),
    ("605", "SH"),
    ("000", "SZ"),
    ("001", "SZ"),
    ("002", "SZ"),
    ("003", "SZ"),
    ("300", "SZ"),  # 创业板
    ("301", "SZ"),
    ("8", "BJ"),  # 北交所 8xxxxx
    ("4", "BJ"),  # 北交所 4xxxxx
    ("92", "BJ"),  # 北交所改革后 92xxxx
)


@dataclass(frozen=True)
class StockMeta:
    code: str
    name: str
    pinyin: str  # 全拼小写，多值用 | 分隔
    initials: str  # 首字母大写，多值用 | 分隔（首个为展示值）


def _ensure_pinyin_phrases() -> None:
    """纠正股票名里的多音字：长鑫=chang xin（不是 zhang）。"""
    global _pinyin_ready
    if _pinyin_ready:
        return
    try:
        from pypinyin import load_phrases_dict

        # 公司名「长*」多为 chang；补未收录词组，避免 长鑫→ZX
        load_phrases_dict(
            {
                "长鑫": [["chang"], ["xin"]],
                "长鑫科技": [["chang"], ["xin"], ["ke"], ["ji"]],
                "长鑫存储": [["chang"], ["xin"], ["cun"], ["chu"]],
                "长电": [["chang"], ["dian"]],
                "长川": [["chang"], ["chuan"]],
                "长光": [["chang"], ["guang"]],
            }
        )
    except Exception:
        pass
    _pinyin_ready = True


def normalize_stock_code(code: str) -> str:
    """规范化输入：去市场前缀 / 别名映射 / 补齐 6 位。

    支持：688825、SH688825、SH:688825、sz.000001、A06978、787825
    """
    raw = (code or "").strip().upper()
    if not raw:
        return ""

    compact = re.sub(r"[\s\-_]", "", raw)
    # N长鑫(SH:688825) / 长鑫科技(SH:688825)
    m_paren = re.search(r"\((?:SH|SZ|BJ)[:：]?(\d{6})\)", compact)
    if m_paren:
        return m_paren.group(1)

    if compact in _CODE_ALIASES:
        return _CODE_ALIASES[compact]

    m = re.match(r"^(?:SH|SZ|BJ|A)[:：]?(\d{6})$", compact)
    if m:
        return m.group(1)

    digits = re.sub(r"\D", "", compact)
    if digits in _CODE_ALIASES:
        return _CODE_ALIASES[digits]
    if len(digits) >= 6:
        return digits[-6:]
    if len(digits) == 5 and compact.startswith("A"):
        padded = digits.zfill(6)
        return _CODE_ALIASES.get(padded, padded)
    if digits:
        return digits.zfill(6)
    return ""


def infer_market(code: str) -> str | None:
    """根据代码推断交易所：SH / SZ / BJ。"""
    c = normalize_stock_code(code)
    if not c:
        return None
    for prefix, market in _CODE_MARKET:
        if c.startswith(prefix):
            return market
    return None


def display_name(name: str) -> str:
    """新股临时简称去 N 前缀：N长鑫 → 长鑫。"""
    n = (name or "").strip()
    if len(n) >= 2 and n[0] in ("N", "n") and not n[1].isascii():
        return n[1:]
    return n


def is_new_stock_name(name: str) -> bool:
    n = (name or "").strip()
    return len(n) >= 2 and n[0] in ("N", "n") and not n[1].isascii()


def _to_pinyin(name: str) -> tuple[str, str]:
    _ensure_pinyin_phrases()
    try:
        from pypinyin import Style, lazy_pinyin

        full = "".join(lazy_pinyin(name, style=Style.NORMAL)).lower()
        initials = "".join(lazy_pinyin(name, style=Style.FIRST_LETTER)).upper()
        return full, initials
    except Exception:
        return "", ""


def _meta_from_raw(code: str, raw_name: str) -> StockMeta:
    """从原始简称生成检索元数据；新股保留 NCX 这类带 N 的首字母。"""
    raw_name = raw_name.strip().replace(" ", "")
    name = display_name(raw_name)
    full, initials = _to_pinyin(name)

    alts_full: list[str] = []
    alts_init: list[str] = []
    if full:
        alts_full.append(full)
    if initials:
        alts_init.append(initials)

    if is_new_stock_name(raw_name) and initials:
        # N长鑫 → 展示/检索首字母 NCX（N + 长鑫首字母），不再用错误的 NZX
        n_init = "N" + initials
        n_full = "n" + full
        if n_init not in alts_init:
            alts_init.insert(0, n_init)  # 新股优先展示带 N 的首字母
        if n_full not in alts_full:
            alts_full.append(n_full)

    # 扩位别名补检索（长鑫科技 → CXTK）
    for alias, target in _NAME_ALIASES.items():
        if target != code:
            continue
        if alias.isascii():
            continue
        a_full, a_init = _to_pinyin(alias)
        if a_full and a_full not in alts_full:
            alts_full.append(a_full)
        if a_init and a_init not in alts_init:
            alts_init.append(a_init)

    return StockMeta(
        code=code,
        name=name,
        pinyin="|".join(alts_full),
        initials="|".join(alts_init),
    )


def _load_from_akshare() -> list[StockMeta]:
    import akshare as ak

    _ensure_pinyin_phrases()
    df = ak.stock_info_a_code_name()
    rows: list[StockMeta] = []
    seen: set[str] = set()
    for _, r in df.iterrows():
        code = str(r["code"]).zfill(6)
        raw_name = str(r["name"]).strip().replace(" ", "")
        if not code or not raw_name:
            continue
        rows.append(_meta_from_raw(code, raw_name))
        seen.add(code)

    for alias_name, code in _NAME_ALIASES.items():
        if code in seen or alias_name.isascii():
            continue
        rows.append(_meta_from_raw(code, alias_name))
        seen.add(code)

    return rows


def get_stock_universe(*, force: bool = False) -> list[StockMeta]:
    """全市场代码-名称表（带拼音），进程内缓存 24h。"""
    global _cache_rows, _cache_loaded_at
    now = time.time()
    with _lock:
        if (
            not force
            and _cache_rows is not None
            and now - _cache_loaded_at < _CACHE_TTL_SEC
        ):
            return _cache_rows
        rows = _load_from_akshare()
        _cache_rows = rows
        _cache_loaded_at = now
        return rows


def lookup_name(code: str) -> str | None:
    code = normalize_stock_code(code)
    if not code:
        return None
    for row in get_stock_universe():
        if row.code == code:
            return row.name
    for alias, target in _NAME_ALIASES.items():
        if target == code and not alias.isascii():
            return alias
    return None


def search_stocks(query: str, *, limit: int = 12) -> list[dict]:
    """按代码 / 名称 / 拼音 / 首字母 / 申购码别名检索。

    例：601666、平煤、PMGF、长鑫科技、NCX、CX、A06978、787825、SH:688825
    """
    q = (query or "").strip()
    if not q:
        return []

    rows = get_stock_universe(force=False)
    q_upper = q.upper().replace(" ", "")
    q_lower = q.lower().replace(" ", "")
    q_digits = re.sub(r"\D", "", q)
    resolved = normalize_stock_code(q)

    exact: list[StockMeta] = []
    prefix: list[StockMeta] = []
    fuzzy: list[StockMeta] = []

    alias_code = _NAME_ALIASES.get(q) or _NAME_ALIASES.get(q_upper)
    if alias_code:
        for row in rows:
            if row.code == alias_code:
                exact.append(row)
                break
        else:
            exact.append(_meta_from_raw(alias_code, next(
                (n for n, c in _NAME_ALIASES.items() if c == alias_code and not n.isascii()),
                alias_code,
            )))

    for row in rows:
        if row in exact:
            continue
        if resolved and row.code == resolved:
            exact.append(row)
            continue
        if q_digits and row.code == q_digits.zfill(6)[-6:]:
            exact.append(row)
            continue
        if q_digits and len(q_digits) >= 2 and row.code.startswith(q_digits):
            prefix.append(row)
            continue
        if row.name == q or row.name == display_name(q):
            exact.append(row)
            continue
        if q in row.name or display_name(q) in row.name:
            fuzzy.append(row)
            continue

        matched_init = False
        for part in row.initials.split("|"):
            if not part:
                continue
            if part == q_upper:
                exact.append(row)
                matched_init = True
                break
            if part.startswith(q_upper) or q_upper in part:
                prefix.append(row)
                matched_init = True
                break
        if matched_init:
            continue

        for part in row.pinyin.split("|"):
            if part and part.startswith(q_lower):
                prefix.append(row)
                break

    seen: set[str] = set()
    out: list[dict] = []
    for bucket in (exact, prefix, fuzzy):
        for row in bucket:
            if row.code in seen:
                continue
            seen.add(row.code)
            market = infer_market(row.code)
            out.append(
                {
                    "code": row.code,
                    "name": row.name,
                    "pinyin": row.pinyin.split("|")[0],
                    "initials": row.initials.split("|")[0],
                    "market": market,
                }
            )
            if len(out) >= limit:
                return out
    return out
