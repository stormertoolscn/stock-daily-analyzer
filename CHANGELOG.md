# Changelog

## 1.4.0 (2026-08-09)

- 新增「数据量化」工作台：布局像素参考大波浪数据量化台（yyqyx.com/quant），主题沿用项目默认主题；涵盖今日市场·情绪与资金、模型因子、算法实验室、训练与配置、短线事件实验室、回测与回撤、模型选股、技术K线找股、板块资金流、大宗商品联动、期货期权实验室、资金情报台、板块资金流地图、板块热力图、模拟盘、主题追踪、跨资产盯盘、可转债、ETF、期权、基金、后台管理等 22 个大区占位与现有能力快捷入口
- 前端版本同步至 0.3.0

## 1.3.0 (2026-08-08)

- Web UI (Vue3 + FastAPI)：同花顺风格 K 线复盘、龙虎榜日榜与席位关系图谱、资金流复盘、一线游资名录与交易追踪、个股重点研究
- K 线体验优化：记住上次查看的股票；会话级缓存 + 自选后台预热，切换秒开；加载状态显示目标股票
- 数据覆盖：北交所（92xxxx）行情与 K 线支持
- 工程化：一键启动/停止本地脚本、应用图标、通达信选股公式

## 1.2.0

- Add reproducible experiment runner (weekly rebalance, daily data)
- Add packaging (pyproject.toml) and CI
- Add configurable A-share tradeability constraints (halt/limit/T+1/tax)
