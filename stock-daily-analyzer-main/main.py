#!/usr/bin/env python3
"""
Stock Daily Analyzer - Main Entry Point
每日股票分析自动化系统
"""
import sys
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# 确保可以导入本地模块
sys.path.insert(0, str(Path(__file__).parent))

from database import init_database, save_recommendations, get_overall_accuracy
from analyzer import run_daily_analysis
from backtester import run_backtest
from notifier import send_analysis_complete_notification, send_error_notification
from llm import llm_enabled, select_top_picks
from log_setup import setup_logging
from reporting import generate_report, save_report
from config import BACKTEST_DAYS


def run_pipeline(
    max_stocks: Optional[int] = None,
    *,
    send_notify: bool = True,
) -> Tuple[int, str, Optional[Path], Dict[str, Any]]:
    """
    运行完整分析流水线。

    Returns:
        (exit_code, report_text, report_path, summary)
    """
    logger = setup_logging()
    logger.info("=" * 50)
    logger.info("开始每日股票分析")
    logger.info("=" * 50)

    try:
        init_database()
        logger.info("数据库初始化完成")

        logger.info(f"开始回测验证{BACKTEST_DAYS}天前的推荐...")
        backtest_result, _backtest_report = run_backtest()
        if backtest_result:
            logger.info(f"回测完成: 准确率 {backtest_result['accuracy_rate']:.0%}")
        else:
            logger.info("暂无历史数据可回测")

        if max_stocks is None:
            env_max = os.getenv("MAX_STOCKS")
            max_stocks = int(env_max) if env_max else None
        if max_stocks:
            logger.info(f"限制扫描数量: {max_stocks}")

        logger.info("开始今日市场分析...")
        recommendations, summary = run_daily_analysis(max_stocks=max_stocks)
        logger.info(f"分析完成: 扫描{summary.get('total_scanned', 0)}只股票")

        llm_picks: Dict[str, Dict] = {}
        if llm_enabled():
            logger.info("调用LLM生成类型内首选...")
            llm_picks = select_top_picks(summary.get("recommendations", {}))
            if llm_picks:
                logger.info(f"LLM精选完成: {list(llm_picks.keys())}")
            else:
                logger.info("LLM未返回精选结果")

        if recommendations:
            saved_count = save_recommendations(recommendations)
            logger.info(f"保存{saved_count}条推荐记录")

        report = generate_report(backtest_result, recommendations, summary, llm_picks)
        report_file = save_report(report)
        logger.info(f"报告已保存: {report_file}")

        try:
            print("\n" + report)
        except UnicodeEncodeError:
            encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
            sys.stdout.buffer.write(("\n" + report + "\n").encode(encoding, errors="replace"))

        if send_notify:
            total_recommendations = sum(summary.get("counts", {}).values())
            overall_accuracy = get_overall_accuracy()
            send_analysis_complete_notification(
                total_recommendations, overall_accuracy, str(report_file)
            )
            logger.info("已发送系统通知")

        logger.info("每日分析完成!")
        return 0, report, report_file, summary

    except Exception as e:
        logger.error(f"分析过程出错: {e}", exc_info=True)
        if send_notify:
            send_error_notification(str(e)[:100])
        return 1, str(e), None, {}


def main() -> int:
    code, _report, _path, _summary = run_pipeline()
    return code


if __name__ == "__main__":
    sys.exit(main())
