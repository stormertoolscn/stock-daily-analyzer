"""个股重点研究：输出对齐 Daily Stock Analysis 决策报告结构的研究视图。

参考：https://github.com/ZhuLinsen/daily_stock_analysis
本实现基于日线技术面启发式生成，非 LLM 实盘建议，仅供研究 UI 对照。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _sma(closes: list[float], n: int) -> float | None:
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def _atr(bars: list[dict[str, Any]], n: int = 14) -> float | None:
    if len(bars) < n + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(bars)):
        h = float(bars[i]["high"])
        l = float(bars[i]["low"])
        pc = float(bars[i - 1]["close"])
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    window = trs[-n:]
    if len(window) < n:
        return None
    return sum(window) / n


def _ret(closes: list[float], days: int) -> float | None:
    if len(closes) <= days:
        return None
    base = closes[-(days + 1)]
    if base == 0:
        return None
    return (closes[-1] / base - 1.0) * 100.0


def build_research_report(
    *,
    code: str,
    name: str,
    basic: dict[str, Any] | None,
    bars: list[dict[str, Any]],
) -> dict[str, Any]:
    closes = [float(b["close"]) for b in bars if b.get("close") is not None]
    if not closes:
        raise LookupError(f"no bars for {code}")

    price = float(basic["price"]) if basic and basic.get("price") is not None else closes[-1]
    change_pct = float(basic["change_pct"]) if basic and basic.get("change_pct") is not None else (
        ((closes[-1] / closes[-2] - 1) * 100.0) if len(closes) >= 2 else 0.0
    )

    ma5 = _sma(closes, 5)
    ma10 = _sma(closes, 10)
    ma20 = _sma(closes, 20)
    ma60 = _sma(closes, 60)
    atr = _atr(bars, 14)
    ret1 = _ret(closes, 1)
    ret5 = _ret(closes, 5)
    ret20 = _ret(closes, 20)

    # 简易评分：均线多头 / 短中期动量
    score = 50.0
    if ma5 and ma20:
        score += 12 if ma5 > ma20 else -10
    if ma20 and ma60:
        score += 10 if ma20 > ma60 else -8
    if ret5 is not None:
        score += max(-15, min(15, ret5 * 0.8))
    if ret20 is not None:
        score += max(-10, min(10, ret20 * 0.25))
    if change_pct > 5:
        score += 4
    elif change_pct < -5:
        score -= 6
    score = int(max(5, min(95, round(score))))

    if score >= 70:
        advice, trend, sentiment = "买入", "看多", "偏乐观"
    elif score >= 45:
        advice, trend, sentiment = "观望", "震荡", "中性"
    else:
        advice, trend, sentiment = "卖出", "看空", "谨慎"

    atr_v = atr or price * 0.02
    ideal_buy = round(price - atr_v * 1.2, 2)
    secondary_buy = round(price - atr_v * 0.5, 2)
    stop_loss = round(price - atr_v * 2.2, 2)
    take_profit = round(price + atr_v * 2.5, 2)

    ma_bits = []
    if ma5 and ma20:
        ma_bits.append("短线均线多头" if ma5 > ma20 else "短线均线空头")
    if ma20 and ma60:
        ma_bits.append("中线趋势向上" if ma20 > ma60 else "中线趋势承压")
    summary = (
        f"{name}（{code}）现价 {price:.2f}，日涨跌 {change_pct:+.2f}%。"
        f"{'；'.join(ma_bits) or '均线数据不足'}。"
        f"近5日 {ret5:+.2f}%、近20日 {ret20:+.2f}%。"
        f"综合技术面评分 {score}，建议阶段以「{advice}」为主（研究用启发式，非 LLM 实盘指令）。"
        if ret5 is not None and ret20 is not None
        else f"{name}（{code}）现价 {price:.2f}，评分 {score}，建议「{advice}」。"
    )

    risks = [
        f"波动参考 ATR14≈{atr_v:.2f}，跌破止损 {stop_loss:.2f} 需重新评估仓位。",
        "启发式报告未接入舆情/基本面 LLM，重大公告与资金面需另行核实。",
    ]
    if ret5 is not None and ret5 > 12:
        risks.insert(0, "近5日涨幅偏大，注意短线获利盘与回撤风险。")
    if change_pct <= -7:
        risks.insert(0, "单日跌幅较大，警惕情绪与流动性冲击。")

    catalysts = [
        "若站稳均线并放量，可关注次优买点附近的回踩确认。",
        "可结合龙虎榜/游资席位与板块强弱做二次确认（本页可跳转 K 线复盘）。",
    ]
    if ret20 is not None and ret20 > 8 and score >= 60:
        catalysts.insert(0, "中期动量尚可，若板块共振或有催化延续空间。")

    checklist = [
        "核对现价是否落在理想/次优买点区间",
        "确认止损与仓位上限（研究纪律）",
        "查看近期成交量是否配合趋势",
        "跳转 K 线复盘核对形态与缺口",
        "关注盘后公告与龙虎榜席位变化",
    ]

    def fmt_ma(v: float | None) -> str:
        return f"{v:.2f}" if v is not None else "—"

    data_view = [
        {"label": "MA5", "value": fmt_ma(ma5)},
        {"label": "MA10", "value": fmt_ma(ma10)},
        {"label": "MA20", "value": fmt_ma(ma20)},
        {"label": "MA60", "value": fmt_ma(ma60)},
        {"label": "近1日", "value": f"{ret1:+.2f}%" if ret1 is not None else "—"},
        {"label": "近5日", "value": f"{ret5:+.2f}%" if ret5 is not None else "—"},
        {"label": "近20日", "value": f"{ret20:+.2f}%" if ret20 is not None else "—"},
        {"label": "ATR14", "value": f"{atr_v:.2f}"},
    ]

    markdown = "\n".join(
        [
            f"# {name}（{code}）决策研究摘要",
            "",
            f"**操作建议**：{advice}　|　**趋势**：{trend}　|　**评分**：{score}",
            "",
            "## 核心结论",
            summary,
            "",
            "## 策略点位",
            f"- 理想买点：{ideal_buy}",
            f"- 次优买点：{secondary_buy}",
            f"- 止损：{stop_loss}",
            f"- 止盈：{take_profit}",
            "",
            "## 风险警报",
            *[f"- {r}" for r in risks],
            "",
            "## 利好催化",
            *[f"- {c}" for c in catalysts],
            "",
            "## 操作检查清单",
            *[f"- [ ] {c}" for c in checklist],
            "",
            "> 布局参考 [Daily Stock Analysis](https://github.com/ZhuLinsen/daily_stock_analysis) 决策仪表盘；"
            "本报告由本地技术面启发式生成，仅供研究。",
        ]
    )

    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")

    return {
        "code": code,
        "name": name,
        "price": round(price, 2),
        "change_pct": round(change_pct, 2),
        "score": score,
        "sentiment": sentiment,
        "operation_advice": advice,
        "trend_prediction": trend,
        "analysis_summary": summary,
        "strategy": {
            "ideal_buy": f"{ideal_buy}",
            "secondary_buy": f"{secondary_buy}",
            "stop_loss": f"{stop_loss}",
            "take_profit": f"{take_profit}",
        },
        "risks": risks,
        "catalysts": catalysts,
        "checklist": checklist,
        "data_view": data_view,
        "boards": [],
        "markdown": markdown,
        "created_at": now,
        "source": "tech-heuristic",
        "phase_label": "研究日线",
        "model_used": "local-tech-v1（DSA 布局对照）",
    }
