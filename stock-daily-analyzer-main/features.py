"""
History-vs-today difference features.

Compare the latest bar against recent history means to surface divergence
signals for screening and LLM context.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np
import pandas as pd


def compute_history_today_diff(data: pd.DataFrame, lookback: int = 30) -> Dict[str, Any]:
    """
    Build compact divergence features from OHLC.

    Returns keys safe for JSON / LLM prompts.
    """
    empty = {
        "lookback": lookback,
        "price_vs_mean_pct": None,
        "vol_vs_mean": None,
        "bias_ma20_pct": None,
        "rsi_vs_mean": None,
        "daily_vs_avg_abs": None,
        "divergence_flags": [],
        "summary": "样本不足，无法对比历史",
    }
    if data is None or len(data) < max(lookback, 21):
        return empty

    close = data["Close"].astype(float)
    volume = data["Volume"].astype(float)
    hist = close.iloc[-(lookback + 1) : -1]
    hist_vol = volume.iloc[-(lookback + 1) : -1]
    today = float(close.iloc[-1])
    today_vol = float(volume.iloc[-1])
    prev = float(close.iloc[-2])

    mean_px = float(hist.mean())
    mean_vol = float(hist_vol.mean()) if hist_vol.mean() > 0 else 1.0
    daily_chg = (today - prev) / prev if prev else 0.0
    hist_rets = hist.pct_change().dropna()
    avg_abs_ret = float(hist_rets.abs().mean()) if len(hist_rets) else 0.0

    ma20 = float(close.rolling(20).mean().iloc[-1])
    bias_ma20 = (today - ma20) / ma20 if ma20 else 0.0

    # lightweight RSI for comparison
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi_today = float(rsi.iloc[-1]) if not np.isnan(rsi.iloc[-1]) else None
    rsi_mean = float(rsi.iloc[-(lookback + 1) : -1].mean()) if rsi_today is not None else None

    price_vs_mean = (today - mean_px) / mean_px if mean_px else 0.0
    vol_vs_mean = today_vol / mean_vol if mean_vol else 1.0
    daily_vs_avg = abs(daily_chg) / avg_abs_ret if avg_abs_ret > 1e-9 else 0.0
    rsi_vs_mean = (rsi_today - rsi_mean) if (rsi_today is not None and rsi_mean is not None) else None

    flags = []
    if abs(price_vs_mean) >= 0.08:
        flags.append("price_far_from_30d_mean")
    if vol_vs_mean >= 1.8:
        flags.append("volume_spike_vs_30d")
    if abs(bias_ma20) >= 0.10:
        flags.append("large_bias_vs_ma20")
    if rsi_vs_mean is not None and abs(rsi_vs_mean) >= 15:
        flags.append("rsi_diverges_from_30d")
    if daily_vs_avg >= 2.5:
        flags.append("today_move_extreme_vs_history")

    parts = [
        f"价较{lookback}日均{price_vs_mean:+.1%}",
        f"量比{lookback}日均{vol_vs_mean:.2f}x",
        f"乖离MA20 {bias_ma20:+.1%}",
    ]
    if rsi_vs_mean is not None:
        parts.append(f"RSI较均值{rsi_vs_mean:+.0f}")
    if flags:
        parts.append("信号:" + ",".join(flags))
    summary = "；".join(parts)

    return {
        "lookback": lookback,
        "price_vs_mean_pct": round(price_vs_mean, 4),
        "vol_vs_mean": round(vol_vs_mean, 3),
        "bias_ma20_pct": round(bias_ma20, 4),
        "rsi_vs_mean": None if rsi_vs_mean is None else round(rsi_vs_mean, 2),
        "daily_vs_avg_abs": round(daily_vs_avg, 2),
        "divergence_flags": flags,
        "summary": summary,
    }


def high_risk_divergence(diff: Optional[Dict[str, Any]]) -> bool:
    if not diff:
        return False
    flags = set(diff.get("divergence_flags") or [])
    return "price_far_from_30d_mean" in flags and "volume_spike_vs_30d" in flags
