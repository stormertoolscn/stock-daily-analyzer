# Changelog

## 1.3.0 (2026-08-08)

- Web UI (Vue3 + FastAPI)：同花顺风格 K 线复盘、龙虎榜日榜与席位关系图谱、资金流复盘、一线游资名录与交易追踪、个股重点研究
- K 线体验优化：记住上次查看的股票；会话级缓存 + 自选后台预热，切换秒开；加载状态显示目标股票
- 数据覆盖：北交所（92xxxx）行情与 K 线支持
- 工程化：一键启动/停止本地脚本、应用图标、通达信选股公式

## 1.2.0

- Add reproducible experiment runner (weekly rebalance, daily data)
- Add packaging (pyproject.toml) and CI
- Add configurable A-share tradeability constraints (halt/limit/T+1/tax)

