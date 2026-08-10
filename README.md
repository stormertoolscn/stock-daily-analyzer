# A股每日分析助手

这是一个自动化的A股市场分析工具，旨在每日收盘后协助投资者快速筛选潜在机会。它结合了传统量化技术指标（RSI, MACD, 均线系统, 量比）与现代大语言模型（LLM）的语义分析能力，提供智能化的选股建议。

## 主要功能

1.  **全市场扫描**: 每日自动扫描 A 股市场（支持排除创业板/ST股），基于量化规则筛选股票。
    *   **放量突破**: 寻找成交量显著放大且价格突破的股票。
    *   **趋势向好**: 筛选均线多头排列、MACD 金叉的稳健标的。
    *   **超卖反弹**: 捕捉 RSI 超卖且有企稳迹象的反弹机会。
2.  **LLM 智能精选**: 集成火山方舟（Ark）大模型，对量化筛选出的候选股进行二次分析。
    *   结合个股实时新闻（通过 akshare 获取）和基本面数据。
    *   输出每种策略下"最值得买"的一只股票及推荐理由。
3.  **历史回测**: 每日运行前自动验证 3 天前的推荐结果，统计准确率和收益率。
4.  **自动化报告**: 生成包含回测结果、今日推荐、LLM 精选理由的日报，并支持保存为文本文件。
5.  **系统通知**: 分析完成后通过 macOS 系统通知发送摘要（支持点击打开报告）。

## 量化框架（qf）

项目内置一个可复现实验的量化研究框架（仅A股、日频数据、周频调仓），支持：

- 数据源接口与本地缓存（便于替换数据源、提升回测速度）
- 因子计算 → 截面打分 → 组合构建（TopK 等权 + 单票上限）
- 可交易性约束（停牌、涨跌停、T+1）与税费/滑点/佣金成本
- 回测结果落盘（equity/holdings/summary），便于复现实验与对比

## 技术栈

*   **语言**: Python 3.9+
*   **数据源**: 
    *   `akshare`: 获取 A 股实时行情、个股新闻。
    *   `yfinance`: 获取个股基本面数据（市值、PE等）。
*   **LLM**: 火山引擎 (Volcengine Ark) / 兼容 OpenAI 接口。
*   **存储**: SQLite (本地存储历史推荐与价格数据)。

## 版本历史

### v1.14.0 (2026-08-09)
*   **通达信式本地数据根（主端）**：所有下载缓存统一到仓库旁 `stock_data/`，可用 `STOCK_DATA_DIR` 指向 exe 同级目录。
    *   `cache_ohlc/` 日线 CSV 增量复用；`api/` 下 LHB/资金流等为可读路径（如 `api/lhb/daily/20260808.json`）。
    *   `ui/localStorage/`、`meta/`、`tmp/` 一并纳入；去掉硬编码外部便携路径。
    *   健康检查 `/api/health` 与 `/api/cache/data-root` 可查看数据根与占用。
### v1.14.0 (2026-08-10)
*   **版头修复**：ABi研究 主题版头/主导航恢复白色实体底（不再透明）；超宽窗口（≥2200px）下 body 渐变背景回退纯色，修复大面积灰色问题。
### v1.13.0 (2026-08-09)
*   **量柱副图修正**：移除破板日量柱「左紫右黄对半」绘制，量柱保持整柱单色并与主图 K 线同步（红涨绿跌、倍量涨停黄底红框）。
### v1.12.0 (2026-08-09)
*   **K 线渲染修正**：倍量涨停黄体（主图蜡烛与量柱黄柱）在浅色背景下增加阳线红细边框；量柱宽度/居中/缩放与主图 K 线严格同步。
### v1.11.0 (2026-08-09)
*   **数据缓存与增量更新**：已下载数据保留本地，网上只补差异。
    *   通用磁盘缓存（现位于 `stock_data/api`）：历史数据永久、当日短 TTL、重启不丢。
    *   K 线日线增量拉取：缓存停在昨日时只拉缺失区间，不再全量重下；日/周/月接口响应缓存（10 分钟）二次毫秒返回。
    *   龙虎榜（日榜/霸榜/席位）、资金复盘历史日、游资交易、研究报告、全市场代码表均接入持久化缓存。
    *   修复缓存目录漂移：缓存统一到本项目 `stock_data`（历史缓存已迁移保留）。
### v1.10.0 (2026-08-09)
*   **龙虎榜关系图三方案**：右上角小图标点选切换（本地记忆）——气泡打包图（默认）、堆叠柱图（参考 NVIDIA 收入堆叠风格：买入/卖出双柱按席位金额占比分段、多色图例与网格）、环形占比图（中心股票、外环按机构/游资/通道净买入占比）。
### v1.9.0 (2026-08-09)
*   **ABi研究主题补全主图 banner**：主图区改为 ABI 官网同款深蓝渐变 hero（`#002D5D → #01387A → #024F4A`，白字、金色 kicker、橙色 CTA 按钮），首页新增橙色横幅带（`#FF5400 → #EF6B51`）。
*   **首页改版**：深蓝 hero + 橙色 CTA banner + 功能入口卡片（策略回测 / 资金复盘 / 龙虎榜席位）。
### v1.8.0 (2026-08-09)
*   **ABi研究主题**：主题选择器新增「ABi研究」（位于「跟随系统」之前），像素参考 [ABI Research](https://www.abiresearch.com/) 官网风格——正文 Roboto、标题 Oswald（Google Fonts，离线自动回退）、深海军蓝 `#002D5D` 文字、品牌橙红 `#FF5400` 强调、白色背景浅蓝灰边框。
### v1.7.0 (2026-08-09)
*   **服务稳定性修复**：移除 uvicorn `--reload` 热重载（Windows 下会因文件变化导致后端进程反复退出），改代码后重启服务生效。
*   **龙虎榜席位关系气泡图**：由连线图改为 CB Insights 风格嵌套气泡打包布局——中心为股票，外围按机构 / 游资 / 通道分组，席位气泡大小代表金额、红色买入 / 绿色卖出，悬停可看完整席位与买卖明细。
### v1.6.0 (2026-08-09)
*   **策略回测页面**：导航位于「重点研究」之后，功能组构像素参考[易回测](https://www.stockbacktest.cn/strategies)，主题沿用本项目默认主题。
    *   四大功能页签：策略回测（指标卡 + 净值/回撤曲线 + 交易明细）、策略选股（当前信号）、策略实盘（模拟账户）、策略盯盘（预警规则 + 信号快照）。
    *   后端真实回测引擎：双均线交叉 / 放量突破 / 超卖反弹三策略，A 股日线（前复权）数据，输出年化收益、夏普、最大回撤、胜率、交易次数等指标。
    *   新接口：`/api/backtest/run`、`/api/backtest/strategies`、`/api/backtest/signals`。
### v1.5.0 (2026-08-09)
*   **「数据量化」内部数据拉通**：大盘资金、市场情绪综述、主力资金看点、主力×游资共振、资金流全景、主力资金雷达、板块资金轮动、今日龙虎榜、龙虎榜霸榜（近10日）、游资动向、技术K线搜索共 11 个模块接入真实接口数据，双击个股可直接进入 K 线复盘。
*   **新增龙虎榜霸榜聚合接口**：`/api/lhb/dominance` 单次区间查询近 N 日上榜次数 / 天数 / 累计净买额。
### v1.4.0 (2026-08-09)
*   **数据量化工作台**：新增「数据量化」导航页，布局像素参考大波浪数据量化台（[yyqyx.com/quant](https://www.yyqyx.com/quant/)），主题沿用本项目默认主题。
    *   22 个大区信息架构：今日市场·情绪与资金、模型因子、算法实验室、训练与配置、短线事件实验室、回测与回撤、模型选股、技术K线找股、板块资金流向·分钟回放、大宗商品联动、期货期权回测实验室、资金情报台、板块资金流地图、板块热力图、模拟盘、主题追踪台、跨资产盯盘、可转债、ETF、期权、基金、后台管理。
    *   已具备能力（资金复盘、龙虎榜、K线复盘、重点研究）作为快捷入口，其余量化模块先以占位呈现，待数据源接入后逐项点亮。

### v1.3.0 (2026-08-08)
*   **Web 网页端**：Vue3 + FastAPI 全栈界面，含同花顺风格 K 线复盘、龙虎榜日榜与席位关系图谱、资金流复盘、一线游资追踪、个股重点研究。
*   **K 线体验优化**：记住上次查看的股票；会话级缓存 + 自选后台预热，切换股票秒开；加载过程正确显示目标股票。
*   **数据覆盖**：新增北交所（92xxxx）行情与 K 线支持。
*   **工程化**：一键启动/停止本地开发脚本、应用图标、通达信选股公式。

### v1.1.0 (2026-01-07)
*   **智能新闻筛选**: 引入 LLM 对个股新闻进行时效性、相关性和重要性评分，自动筛选 Top 3 关键信息，告别海量噪音。
*   **历史异动归因**: 新增股价历史异动检测模块，支持短期（10天滑动窗口）和长期（90天振幅）两种模式。
    *   自动识别并标注股价的快速拉升/下跌区间（只保留最近5条记录以优化上下文）。
    *   利用 LLM 结合同期新闻，从宏观、行业、个股三个维度生成深度归因报告。
*   **决策上下文增强**: 
    *   将历史归因总结和精选新闻作为核心上下文输入给选股模型。
    *   优化 Prompt 指令，强制要求 LLM 综合量化信号、异动归因、市场情绪三个维度进行决策，显著提升推荐理由的逻辑深度。
*   **数据源优化**: 全面适配 akshare 新版接口，提升 A 股数据获取稳定性。

## 安装与配置

### 作为 Python 包安装（推荐）

```bash
pip install -e .
```

开发与测试环境：

```bash
pip install -e ".[dev]"
ruff check .
pytest -q
```

1.  **克隆仓库**
    ```bash
    git clone https://github.com/oliverran/stock-daily-analyzer.git
    cd stock-daily-analyzer
    ```

2.  **安装依赖**
    ```bash
    pip install -r requirements.txt
    ```

3.  **配置环境变量**
    复制 `.env.example` 为 `.env` 并填入你的 API Key：
    ```ini
    ARK_API_KEY=your_api_key_here
    ARK_MODEL_ID=your_model_endpoint_id
    ```

## 使用方法

### 本地运行

#### Windows（推荐使用虚拟环境）

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
copy .env.example .env
python self_check.py
python main.py
```

运行主程序进行全流程分析：

```bash
python main.py
```

或者仅测试 LLM 选股功能：

```bash
python test_llm.py
```

### 量化框架回测（仅A股、日频）

使用可复现实验配置运行回测：

```bash
python run_experiment.py --config experiments/default_a_share_daily.json
```

或使用安装后的 CLI：

```bash
stock-analyzer backtest --config experiments/default_a_share_daily.json
```

回测输出目录（默认）：

- `reports/experiments/<experiment_name>/equity.csv`
- `reports/experiments/<experiment_name>/holdings.csv`
- `reports/experiments/<experiment_name>/summary.json`

实验配置说明（见 `experiments/*.json`）：

- `universe`：股票池过滤（可选 include_prefix、exclude_prefix、exclude_st、max_stocks）
- `data`：数据源与缓存（provider、cache_dir、timeout_seconds）
- `factors`：lookback 与因子权重（weights）
- `portfolio`：TopK、单票上限（max_weight_per_name）
- `trading`：可交易性与税费（t_plus_one、limit_up/limit_down、stamp_duty_bps 等）
- `backtest`：回测区间、调仓规则（rebalance=W/W-FRI/M）、成本与初始资金

自检与日报运行：

```bash
stock-analyzer self-check
stock-analyzer run-daily
```

### 服务器部署

**🚀 一键部署（推荐）**

```bash
# 上传项目到服务器
scp -r stock-daily-analyzer user@your-server:/home/user/

# SSH登录并部署
ssh user@your-server
cd /home/user/stock-daily-analyzer
./deploy/deploy.sh
```

**🐳 Docker部署**

```bash
cd deploy/docker
./run.sh
```

**📚 详细部署文档**

- [快速部署指南](./QUICK_DEPLOY.md) - 3种部署方式快速入门
- [完整部署文档](./DEPLOYMENT.md) - 详细的部署、配置、监控指南

## 目录结构

```
stock-daily-analyzer/
├── qf/                      # 可复现实验量化框架（数据/因子/回测/交易约束/CLI）
├── experiments/             # 实验配置样例（JSON）
├── tests/                   # 单元测试与冒烟测试（离线可跑）
├── analyzer.py              # 日报：量化筛选逻辑
├── llm.py                   # 日报：LLM二次分析（可选）
├── attribution.py           # 日报：历史异动归因（可选）
├── backtester.py            # 日报：历史推荐回测统计
├── database.py              # 日报：SQLite存储
├── notifier.py              # 通知（macOS可用，其他平台安全降级）
├── config.py                # 日报配置
├── main.py                  # 日报入口
├── run_experiment.py        # 量化框架：回测入口（兼容 CLI）
├── pyproject.toml           # 打包/依赖/CLI/CI配置
├── .env.example             # 环境变量示例
├── deploy/                 # 部署配置目录
│   ├── deploy.sh           # 一键部署脚本
│   ├── crontab.example     # 定时任务示例
│   ├── stock-analyzer.service  # systemd服务配置
│   ├── docker/             # Docker部署配置
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml
│   │   └── run.sh
│   └── supervisor/         # Supervisor配置
├── logs/                   # 运行日志
└── reports/                # 每日生成的分析报告
```

## 免责声明

本项目仅供学习和研究使用，不构成任何投资建议。股市有风险，入市需谨慎。
