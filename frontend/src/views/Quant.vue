<script setup lang="ts">
/**
 * 数据量化工作台
 * 像素级对照：https://www.yyqyx.com/quant/
 * （大标题 Hero + 各大区 H2 + 子模块卡片/表格占位）
 * 主题沿用项目默认主题变量，不搬目标站配色。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import {
  fetchFundFlowReview,
  formatFlowAmount,
  type FundFlowReview,
} from "@/api/fundflow";
import {
  fetchHotMoneyList,
  fetchHotMoneyTrades,
  fetchLhbDaily,
  fetchLhbDominance,
  formatAmount,
  formatPct,
  type HotMoneyTradeItem,
  type HotMoneyTrader,
  type LhbDailyItem,
  type LhbDominanceItem,
} from "@/api/lhb";
import { searchStocks, type StockSearchItem } from "@/api/stock";

defineOptions({ name: "Quant" });

const router = useRouter();

type QuantCard = {
  title: string;
  desc?: string;
  status?: string;
  badge?: string;
  to?: string;
  cols?: string[];
  span?: boolean;
  live?: string;
};

type QuantSection = {
  id: string;
  title: string;
  desc: string;
  meta?: string;
  cards: QuantCard[];
};

const quickLinks = [
  { label: "资金复盘", to: "/capital-flow" },
  { label: "龙虎榜分析", to: "/lhb" },
  { label: "龙虎榜新版", to: "/lhb-v3" },
  { label: "K线复盘", to: "/kline" },
  { label: "重点研究", to: "/research" },
];

const sections: QuantSection[] = [
  {
    id: "market",
    title: "今日市场 · 情绪与资金",
    desc: "全市场情绪 + 主力资金动向，一屏看清今日冷热与方向。",
    cards: [
      {
        title: "大盘实时 · 成交与拥挤",
        desc: "指数实时涨跌 · 全市场成交额 · 拥挤度(成交额前20股占比)",
        status: "加载大盘实时中…",
        live: "market",
      },
      {
        title: "今日市场情绪 · 赚钱效应",
        desc: "全市场涨跌家数 + 涨停跌停 · 大盘冷热一眼看",
        status: "加载市场情绪中…",
        live: "sentiment",
        to: "/capital-flow",
      },
      {
        title: "避险情绪 · 防御资金",
        desc: "防御板块资金流入 + 红利低波 / 黄金 / 长债同步走强 = 避险升温、风险偏好下降",
        status: "加载避险情绪中…",
      },
      {
        title: "涨停情绪 · 连板天梯",
        desc: "短线赚钱效应温度计 · 涨停/炸板/最高连板 + 龙头梯队",
        status: "加载涨停情绪中…",
      },
      {
        title: "主力资金 · 今日看点",
        desc: "主力大额净流入 + 逆势吸筹（真金白银在进的票）",
        status: "加载主力资金看点中…",
        live: "inflow",
        to: "/capital-flow",
      },
      {
        title: "主力 × 游资 · 今日共识",
        desc: "主力(大单+超大单)与游资(龙虎榜席位)同日双双净买入 · ⚡三重共振=模型也选中",
        status: "加载主力×游资共识中…",
        live: "consensus",
        to: "/lhb-v3",
      },
    ],
  },
  {
    id: "factors",
    title: "模型因子",
    desc: "重要性、分组与当前周期画像。",
    meta: "0 个因子",
    cards: [
      {
        title: "因子重要性",
        status: "等待模型产物",
      },
      {
        title: "因子结构",
        desc: "按研究含义归类 · PIT 表示只使用当时已知数据",
        status: "等待模型产物",
      },
      {
        title: "因子数据血缘",
        desc: "生产表、原始字段与实际计算口径",
        status: "暂无数据",
        span: true,
        cols: ["因子", "来源表", "原始字段", "计算口径", "频率", "时点安全"],
      },
    ],
  },
  {
    id: "algorithm-lab",
    title: "算法实验室",
    desc: "生产基线、深度学习挑战者与准入条件。",
    cards: [
      {
        title: "模型健康度 · 严格口径",
        desc: "排除样本内与建仓期后的真实表现。界面别处的收益率含建仓期红利与样本内成分，判断模型请以这里为准。",
        status: "加载中…",
        badge: "当前生产：三树集成",
      },
      {
        title: "模型适配矩阵",
        desc: "只有完成实现和同口径验证的算法才允许进入生产",
        status: "暂无数据",
        span: true,
        cols: ["算法", "状态", "适用周期", "输入", "系统定位", "评估结论", "准入条件"],
      },
      {
        title: "当前结论",
        desc: "深度模型不是替换项，而是严格对照后的增量信号",
        status: "等待模型产物",
      },
    ],
  },
  {
    id: "training",
    title: "训练与配置",
    desc: "配置三周期画像与训练参数并一键发起，下方跟踪运行状态。",
    cards: [
      {
        title: "训练配置",
        desc: "按周期配置画像与训练参数；每次运行独立传参，不改全局默认。",
        status: "配置好后点「发起训练」",
      },
      {
        title: "最近运行",
        desc: "阶段、结果与故障原因",
        status: "暂无运行记录",
      },
      {
        title: "交叉验证",
        desc: "Purged Walk-Forward 样本外指标",
        status: "等待运行",
      },
    ],
  },
  {
    id: "dqn-lab",
    title: "短线事件实验室",
    desc: "新闻先离线数值化，DQN 仅使用浓缩后的五分钟状态。",
    cards: [
      {
        title: "策略与风控",
        desc: "真实信号只写影子账本，不连接下单通道。",
        status: "就绪",
      },
      {
        title: "新闻关键词",
        desc: "修改后下一轮五分钟聚合自动生效。",
        status: "等待模型",
      },
      {
        title: "模型验收",
        desc: "只展示样本外结果与实际产物。",
        status: "等待模型",
      },
      {
        title: "单股 vs 池化（泛化验证）",
        desc: "单股 DQN 易过拟合一只票；池化在多样股票池训练、在没见过的股票上验证是否泛化",
        status: "0 条",
      },
      {
        title: "规则清单",
        desc: "情绪词只在命中触发关键词后计算。",
        status: "0 条",
        cols: ["规则", "资产", "关键词", "正/负向词", "权重", "状态", "操作"],
      },
      {
        title: "影子信号与净值",
        desc: "五分钟状态去重；熔断后强制空仓。",
        status: "就绪",
        cols: ["时间", "标的", "动作", "价格", "置信差", "新闻冲击", "区间收益", "当日", "净值", "状态"],
      },
      {
        title: "影子回测（自选窗口 · 净值 / 回撤）",
        desc: "用最新 DQN 模型在历史窗口逐 K 线回放：去前瞻、计真实换仓成本、含单日熔断。可回测区间取决于分钟线覆盖范围。",
        status: "暂无报告",
        span: true,
      },
    ],
  },
  {
    id: "backtest",
    title: "回测与回撤",
    desc: "策略净值、基准与风险阈值。切周期看最新模型，或下拉选历史版本对比。",
    cards: [
      {
        title: "自定义因子回测",
        desc: "使用回测开始日前的数据重新训练，所选区间仅用于样本外验证。",
        status: "等待可用日期 · 至少选择 3 个因子",
      },
      {
        title: "回测净值",
        desc: "策略 vs 沪深300 对比 · 查看完整报告",
        status: "尚无报告",
      },
      {
        title: "回撤路径",
        status: "等待回测数据",
      },
      {
        title: "今日市况 × 模型适配",
        desc: "按当前沪深300市况(MA20/60) + 各模型历史在该市况的真实回测表现，提示今天更该倚重哪个模型",
        status: "加载今日市况×模型适配中…",
      },
      {
        title: "模型 × 市况分段",
        desc: "每笔按买入日的沪深300市况(MA20/60)归类——看这个模型在牛/震荡/熊各赚多少",
        status: "暂无数据",
      },
      {
        title: "月度与年度收益",
        desc: "观察收益是否依赖少数月份",
        status: "暂无数据",
      },
      {
        title: "交易质量与成本",
        desc: "胜率、盈亏比、持有期和退出原因",
        status: "暂无数据",
      },
      {
        title: "主要回撤区间",
        desc: "峰值、谷底、恢复与持续时间",
        status: "0 笔",
        cols: ["开始", "谷底", "恢复", "最大回撤", "持续", "状态"],
      },
      {
        title: "交易明细（开仓 → 平仓）",
        desc: "每行还原一笔完整操作：买入额 + 盈亏 = 卖出额，可逐笔核对真实性",
        status: "暂无数据",
        span: true,
        cols: ["代码", "名称", "行业", "买入日", "买入价", "卖出日", "卖出价", "持有", "买入额", "盈亏", "收益率", "退出", "费用", "买入理由"],
      },
      {
        title: "板块归因（申万一级行业）",
        desc: "按行业拆解回测盈亏，看模型的钱在哪些行业赚 / 亏",
        status: "暂无数据",
      },
    ],
  },
  {
    id: "stockpick",
    title: "模型选股",
    desc: "买入=建议新买（高分+成交额达标）· 持有=可继续拿但不够新买 · 观察=暂不操作。要买就看「买入」，按模型评分排名。",
    cards: [
      {
        title: "短线模型 × 板块资金共振 · 买入策略",
        desc: "短线模型选中、且所属题材板块「连续净流入」的票——板块持续大额吸筹 + 模型看好 = 强买入信号",
        status: "加载中…",
        to: "/kline",
      },
      {
        title: "模型打分依据",
        desc: "当前模型各因子家族的权重占比 —— 评分主要由高权重家族驱动",
        status: "加载打分依据中…",
      },
      {
        title: "选股结果",
        desc: "按模型评分排名，越靠前越看好。点代码看个股详情。",
        status: "暂无数据",
        span: true,
        cols: ["代码", "名称", "行业", "细分板块", "信号", "评分", "排名", "PE", "PE同业分位", "市值", "量价", "选中理由（因子）", "模拟盘"],
      },
    ],
  },
  {
    id: "tech-kline",
    title: "技术 · K线找股",
    desc: "按 K 线蜡烛形态 + 技术指标在全网/行业里找符合的股票 · 仅技术形态研究，不构成买卖/投资建议。",
    cards: [
      {
        title: "全市场技术形态扫描",
        desc: "蜡烛形态 + MACD / 均线 / 量价等指标组合条件找股",
        status: "加载技术找股模块中…",
        live: "tech-search",
        to: "/kline",
        span: true,
      },
    ],
  },
  {
    id: "sector-flow",
    title: "板块资金流向 · 分钟回放",
    desc: "按 1 分钟 K 线逐分钟推算各板块的资金流向，从开盘播到收盘 · 这是「全体资金」的方向性净额，口径与主力资金不同，方向参考价值较高。",
    cards: [
      {
        title: "板块资金分钟回放",
        desc: "按时间轴回放各板块资金流入/流出过程",
        status: "加载板块回放模块中…",
        to: "/capital-flow",
        span: true,
      },
    ],
  },
  {
    id: "commodity",
    title: "大宗商品 × 股价 联动专题",
    desc: "原油 / 化工 / 粮食 / 金属 等 27 个主力连续合约（2010 起）对 A 股产业链各环节的历史敏感度：谁受益、谁受损、弹性多大、传导要多久。",
    cards: [
      {
        title: "商品联动分析",
        desc: "控制市场后的双因子回归，关系不成立也如实展示 · 历史统计研究，不构成买卖/投资建议",
        status: "加载大宗商品模块中…",
        span: true,
      },
    ],
  },
  {
    id: "futures-options",
    title: "期货 · 期权 量化回测实验室",
    desc: "基于 1 分钟 K 线合成 5/15/30/45/60/240 分钟多周期，蜡烛图 + 策略回测 + 回放动画（逐步建设中）· 纯行情研究，非实盘建议。",
    cards: [
      {
        title: "多周期策略回测与回放",
        desc: "蜡烛图 + 策略回测 + 回放动画",
        status: "加载回测实验室模块中…",
        span: true,
      },
    ],
  },
  {
    id: "intel",
    title: "资金情报台",
    desc: "先看 1/3/5/10/20/30 日持续流向，再下钻行业与个股的大单结构；多周期同向、板块与龙头同步，才是值得跟踪的主力信号。",
    cards: [
      {
        title: "🌊 资金流全景",
        desc: "统一资金流模型：流向·流量·流速·持续·质量 —— 机构/游资/散户分层 × 杠杆 × ETF场外 × 板块迁徙 一屏看清",
        status: "加载资金流全景中…",
        live: "panorama",
      },
      {
        title: "🧭 今日重点方向",
        desc: "一屏看清 大盘温度 · 主力方向 · 连续净流入题材板块 · 游资在抓什么",
        status: "加载中…",
      },
      {
        title: "🎯 多路共振总览",
        desc: "同一只票被越多路独立力量点名 = 信号越硬（主力/龙虎榜/机构/融资/内部人/券商/模型…）",
        status: "汇总多路力量中…",
      },
      {
        title: "主力资金雷达",
        desc: "找主力资金在哪里 · 全市场主力(大单+超大单)净流向",
        status: "加载主力资金雷达中…",
        live: "radar",
        to: "/capital-flow",
      },
      {
        title: "筹码低位吸筹 · 主力在套牢区建仓",
        desc: "现价≤加权成本 + 获利盘低 + 主力净流入 = 主力在多数人套牢的低位吸筹（筹码分布口径）",
        status: "加载中…",
      },
      {
        title: "主力 × 游资 · 联合追踪",
        desc: "两路聪明钱同向=共识抢筹、逆向=分歧预警 · 主力(大单+超大单) × 游资(龙虎榜席位)",
        status: "加载主力×游资中…",
        to: "/lhb-v3",
      },
      {
        title: "板块资金轮动",
        desc: "资金在往哪个概念板块走 · 今日板块净流入涌入榜 + 撤离榜（点板块看成分股）",
        status: "加载板块资金轮动中…",
        live: "themes",
        to: "/capital-flow",
      },
      {
        title: "盘中涨速榜",
        desc: "扫全市场近 5 分钟 1 分钟线找急拉 / 急跌",
        status: "扫描盘中涨速中…",
      },
      {
        title: "今日龙虎榜",
        desc: "谁上榜 · 游资 / 机构席位真金白银在扫谁",
        status: "加载龙虎榜中…",
        live: "lhb-today",
        to: "/lhb",
      },
      {
        title: "龙虎榜霸榜 · 近10日",
        desc: "近10日频繁上榜的强势股 · 游资持续接力 / 高位换手龙头（点🔍看席位）",
        status: "加载龙虎榜霸榜中…",
        live: "dominance",
        to: "/lhb-v3",
      },
      {
        title: "北向资金",
        desc: "外资（沪深股通）今日净买入 + 近期趋势",
        status: "加载北向资金中…",
      },
      {
        title: "融资融券 · 杠杆资金",
        desc: "杠杆资金今日加仓谁 · 融资净买入（融资买入−偿还）榜",
        status: "加载融资融券中…",
      },
      {
        title: "内部人视角 · 增持与回购",
        desc: "内部人 / 公司真金白银买自己 · 股东增持 + 公司回购（高确信度）",
        status: "加载内部人动作中…",
      },
      {
        title: "今日大宗交易",
        desc: "机构/大股东大额转让 · 折价甩卖 / 溢价接货（折溢价见意向）",
        status: "加载大宗交易中…",
      },
      {
        title: "游资动向 · 谁在抢票",
        desc: "知名游资今日净买（已剔除机构/北向席位）· 席位名可看简介",
        status: "加载游资动向中…",
        live: "hotmoney",
        to: "/lhb-v3",
      },
      {
        title: "近期券商评级",
        desc: "卖方在推谁 · 近期获券商买入/增持评级，按覆盖券商数排",
        status: "加载券商评级中…",
      },
      {
        title: "机构调研热度",
        desc: "买方在看谁 · 近30日机构密集调研（基金/保险/券商），越多机构=关注度越高",
        status: "加载机构调研中…",
      },
      {
        title: "风险预警 · 谁在卖 / 有什么雷",
        desc: "避雷用 · 股东减持（内部人在跑）+ 高质押（爆仓风险）",
        status: "加载风险预警中…",
      },
    ],
  },
  {
    id: "sector-map",
    title: "板块资金流地图",
    desc: "用申万与东财双口径寻找持续流入行业，再用 K 线、资金分层趋势和龙头股验证。",
    cards: [
      {
        title: "板块资金流向 · 市场资金池视图",
        desc: "读图顺序① 绿色板块资金流出→② 汇入市场资金池→③ 红色板块获得流入；线越粗，金额越大；不代表逐笔资金路径",
        status: "加载板块资金地图中…",
        span: true,
      },
      {
        title: "ETF 申赎资金 · 真金白银",
        desc: "份额日变化×收盘价=投资者实际申购/赎回，与盘口主力资金互相印证；主题按跟踪指数归类",
        status: "加载中…",
      },
      {
        title: "所选板块多周期资金矩阵",
        desc: "点击地图节点，比较1日至1年的流量、流速与方向。",
        status: "请选择板块",
        cols: ["周期", "数据区间", "覆盖率", "累计流量", "日均流速", "趋势斜率", "资金流向", "同向日占比"],
      },
      {
        title: "板块精确数据",
        desc: "地图内板块的可排序明细，作为视觉图的数值校验。",
        status: "暂无数据",
        cols: ["板块", "类型", "资金状态", "当日涨跌", "今日实时", "周期累计", "主力单", "模型BUY", "日均流速", "趋势斜率", "连续同向", "同向日占比", "涨/跌家数", "涨幅龙头"],
      },
    ],
  },
  {
    id: "heatmap",
    title: "板块热力图",
    desc: "全市场个股按板块聚合 · 面积=成交额/流通市值 · 颜色=今日涨跌幅（红涨绿跌）· 双击看K线",
    cards: [
      {
        title: "全市场板块热力图",
        desc: "面积=成交额/流通市值 · 颜色=今日涨跌幅 · 双击看K线",
        status: "加载热力图中…",
        to: "/kline",
        span: true,
      },
    ],
  },
  {
    id: "sim",
    title: "模拟盘",
    desc: "100 万初始资金模拟炒股，按周期分工：中/长线跟模型选股、短线走规则策略。真实成交摩擦（佣金 0.03% + 印花税 0.1% + 滑点 0.1%）、涨停不可买 / 跌停不可卖 / 停牌跳过、A 股 T+1。不接实盘。",
    cards: [
      {
        title: "四账户策略对比",
        desc: "综合 / 短期 / 中期 / 长期 并排——各账户独立跟随自家周期选股，PK 哪个梯度更赚",
        status: "加载中…",
      },
      {
        title: "净值曲线",
        desc: "建仓后逐交易日生成 · 对比上证指数",
        status: "尚无组合",
      },
      {
        title: "每日选股快照 · 历史对比",
        desc: "中/长策略每天跟模型 BUY 榜换仓——连续在榜=保留、跌出榜=被换",
        status: "暂无快照",
      },
      {
        title: "盈利分析",
        desc: "持仓盯市复盘 · 胜率/盈亏比 · 分行业归因 · 集中度风控",
        status: "暂无持仓",
      },
      {
        title: "自动操作",
        desc: "按最新「买入」Top-N 等权一键建仓/调仓（卖掉不在榜的、目标买到位）",
        status: "未启用",
      },
      {
        title: "手动买入",
        desc: "输入代码与买入金额，自动取整手成交",
        status: "待接入",
      },
      {
        title: "🤖 大模型决策调仓",
        desc: "把 三周期模型候选 + 当前持仓 一起发给已配置的大模型，让它决定买卖，程序按决策在模拟盘自动执行（不接实盘）",
        status: "需先在「AI 设置」配置大模型",
      },
      {
        title: "调仓建议",
        desc: "对照最新策略 BUY 榜：该补的仓、该减的仓（点代码看详情，按钮快捷下单）",
        status: "暂无数据",
      },
      {
        title: "持仓",
        desc: "代码 | 名称 | 数量 | 成本 | 现价 | 今日 | 20日走势 | 市值 | 盈亏 | 盈亏% | 信号 | 健康 | 仓位 | 操作",
        status: "暂无持仓",
        cols: ["代码", "名称", "数量", "成本", "现价", "今日", "20日走势", "市值", "盈亏", "盈亏%", "信号", "健康", "仓位", "操作"],
      },
      {
        title: "分析师观点",
        desc: "持仓个股近 6 个月券商评级（机构数 / 评级分布，盈绿亏红）",
        status: "暂无持仓",
      },
      {
        title: "持仓动态",
        desc: "持仓个股近期研报与新闻",
        status: "暂无持仓",
      },
      {
        title: "已平仓盈亏（实现）",
        desc: "按 FIFO 配对买卖流水，含买入/卖出费后的真实落袋盈亏",
        status: "暂无数据",
        cols: ["代码", "名称", "买入价(含费)", "卖出价", "数量", "持有天", "盈亏", "盈亏%", "卖出日"],
      },
      {
        title: "交易流水",
        desc: "时间 | 方向 | 代码 | 名称 | 价格 | 数量 | 金额 | 费用",
        status: "暂无数据",
        cols: ["时间", "方向", "代码", "名称", "价格", "数量", "金额", "费用"],
      },
      {
        title: "止盈止损 · 策略回测",
        desc: "均线 / 技术指标挂单入场 + 通用止盈止损（可配置）。先在这里回测验证，保存后「模拟挂单」子页共用同一套配置。",
        status: "未配置",
      },
      {
        title: "策略配置",
        desc: "入场用「前 N 日收盘均线」挂单；回测用日线，实盘化的每日挂单按 1 分钟线实时触发",
        status: "加载中…",
      },
      {
        title: "回测结果",
        desc: "分标的盈亏 · 成交明细（买入均线挂单 / 卖出止盈止损）",
        status: "暂无数据",
      },
      {
        title: "模拟挂单 · 实盘化每日执行",
        desc: "用「策略回测」子页配好并保存的同一套策略，交易时段按实时 1 分钟价自动挂单。仍是模拟盘，不接实盘。",
        status: "未启用",
      },
      {
        title: "🎯 主题挂单 · 能源 × AI算力 × 存储",
        desc: "每日收盘后按三主线漏斗逐票算出挂在什么价买、为什么买、什么价走，盘中触价自动成交——挂不到就不成交，不成交不亏钱",
        status: "加载主题挂单中…",
      },
      {
        title: "⚔️ 算法擂台 · 多策略并行对比",
        desc: "每个算法在独立模拟账户各跑各的（初始 100 万），启用后交易时段每分钟自动挂单——谁强谁弱真金白银见分晓",
        status: "加载算法擂台中…",
      },
      {
        title: "持仓盯盘 · 止盈止损",
        desc: "这套策略买入的持仓与盈亏，并按实时 1 分钟价盯每只的止盈价 / 止损价（触发即卖）",
        status: "暂无持仓",
      },
      {
        title: "试运行看信号",
        desc: "预览此刻这套策略会怎么挂单买卖，不真正下单",
        status: "未配置",
      },
    ],
  },
  {
    id: "theme-track",
    title: "主题追踪台",
    desc: "收藏你看好的主题，实时跟踪各主题里主力资金在往哪只票走。收藏的主题也会纳入每日 AI 盯盘简报。",
    cards: [
      {
        title: "我的主题",
        desc: "收藏主题 · 实时资金去向 · 纳入每日 AI 盯盘简报",
        status: "加载中…",
        span: true,
      },
    ],
  },
  {
    id: "watch",
    title: "关注 · 跨资产盯盘",
    desc: "把股票 / ETF / 基金 / 期货 / 期权 / 可转债加进关注，一屏盯它们的最新价、涨跌幅，以及各自最贴切的资金信号。",
    cards: [
      {
        title: "关注列表",
        desc: "A股主力净流入 · 期货/期权持仓 · ETF/转债成交额 · 基金净值 · A股带今日 1 分钟分时",
        status: "加载中…",
        span: true,
      },
      {
        title: "关注动态 · 研报与新闻",
        desc: "关注 A股近期研报与新闻；新闻按股名匹配，研报按证券代码精确关联。仅研究，非投资建议。",
        status: "暂无动态",
      },
    ],
  },
  {
    id: "convertible",
    title: "可转债 · 转债 × 正股",
    desc: "可转债 = 债性保底 + 股性弹性。转股溢价率越低越偏股性、<0 表示折价、价格贴近正股；双低 = 债底托着、又保留股性弹性；触发强赎会催促转股、压制债价。仅供研究，非投资建议。",
    cards: [
      {
        title: "全部可转债 · 按转股溢价率排序",
        desc: "可搜索转债 / 正股名称并翻页查看全部",
        status: "加载可转债中…",
      },
      {
        title: "双低榜",
        desc: "价格 + 转股溢价率 双低 · 攻守兼备（跌有底、涨有弹性），双低值越小越优",
        status: "加载双低榜中…",
      },
      {
        title: "强赎预警",
        desc: "已满足 / 公告强赎 · 触发强赎会催促转股并压制债价，持有需回避（避雷）",
        status: "加载强赎预警中…",
      },
      {
        title: "近期下修博弈",
        desc: "转股价下修 = 转股价值抬升，利好转债 · 每只取最近一次下修，链正股",
        status: "加载下修记录中…",
      },
    ],
  },
  {
    id: "etf",
    title: "ETF · 场内基金",
    desc: "ETF = 跟踪某指数 / 商品的场内基金，可像股票一样在盘中买卖。列出全部上市 ETF 的最新价、当日涨跌与成交额，并标注跟踪指数、管理人与管理费率。仅供数据研究，不构成投资建议。",
    cards: [
      {
        title: "全部 ETF",
        desc: "默认按成交额（流动性）从高到低 · 可搜索 ETF / 跟踪指数名称并翻页查看全部",
        status: "加载 ETF 中…",
        span: true,
      },
    ],
  },
  {
    id: "options",
    title: "期权 · 情绪与波动率",
    desc: "股指 / ETF 期权的 IV 偏斜与 PCR —— 大资金的对冲成本与看跌看涨结构。两者都是情绪反指类的历史统计，不构成投资建议。",
    cards: [
      {
        title: "期权 IV 偏斜 · 恐慌溢价的期限结构",
        desc: "虚值 Put 相对平值贵多少（百分点）。历史统计显示偏斜越陡后市反而越好——它是情绪反指，不是预警信号。",
        status: "加载中…",
      },
      {
        title: "期权情绪 · PCR",
        desc: "股指/ETF期权 认沽÷认购（持仓量）· 大资金对冲情绪 · PCR 高=看跌情绪浓（常为反向底部信号）",
        status: "加载期权情绪中…",
      },
    ],
  },
  {
    id: "fund",
    title: "基金 · 场外基金",
    desc: "场外基金 = 通过银行 / 券商 / 三方平台申购赎回的公募基金，按每日单位净值成交。列出全部场外基金的最新单位净值、累计净值与较上一净值日的涨跌，并标注基金类型、管理人、管理费率与业绩比较基准。仅供数据研究，不构成投资建议。",
    cards: [
      {
        title: "全部场外基金",
        desc: "单位净值 = 每份基金的当前价值 · 累计净值含历史分红 · 可搜索基金名称并翻页查看全部",
        status: "加载基金中…",
        span: true,
      },
    ],
  },
  {
    id: "admin",
    title: "后台管理 · 用户与权限",
    desc: "管理研究台账户与角色权限。密码由系统动态生成、仅在创建/重置时显示一次，请及时保存转交。",
    cards: [
      {
        title: "新建用户",
        desc: "动态生成初始密码；新用户首次登录建议改密",
        status: "待接入",
      },
      {
        title: "登录情况",
        status: "暂无数据",
      },
      {
        title: "用户列表",
        status: "暂无数据",
      },
      {
        title: "新建角色",
        desc: "创建自定义角色并勾选可访问页面；去掉「选股」即得到「无模型」角色",
        status: "待接入",
      },
      {
        title: "角色权限",
        desc: "内置角色的页面权限范围（当前按角色配置，页面级）",
        status: "暂无数据",
      },
    ],
  },
];

function go(to: string) {
  void router.push(to);
}
/* ============ 内部数据拉通：资金复盘 / 龙虎榜 / 游资 / 搜索 ============ */

const fundflow = ref<FundFlowReview | null>(null);
const lhbDaily = ref<LhbDailyItem[]>([]);
const lhbDailyDate = ref("");
const dominance = ref<LhbDominanceItem[]>([]);
const dominanceMeta = ref<{ days: number; count: number } | null>(null);
const hotMoneyList = ref<HotMoneyTrader[]>([]);
const hotMoneyTrades = ref<HotMoneyTradeItem[]>([]);
const hotMoneyTrader = ref<HotMoneyTrader | null>(null);
const hotMoneyBusy = ref(false);
const liveLoading = ref(false);
const liveError = ref("");

const searchQuery = ref("");
const searchResults = ref<StockSearchItem[]>([]);
const searchBusy = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let liveAbort: AbortController | null = null;

function liveMsg(e: unknown): string {
  if ((e as Error).name === "AbortError") return "";
  return e instanceof Error ? e.message : "加载失败";
}

async function loadLive() {
  liveAbort?.abort();
  liveAbort = new AbortController();
  const signal = liveAbort.signal;
  liveLoading.value = true;
  liveError.value = "";
  const jobs: Promise<void>[] = [
    fetchFundFlowReview(false, undefined, signal)
      .then((d) => {
        fundflow.value = d;
      })
      .catch((e) => {
        const m = liveMsg(e);
        if (m) liveError.value += `资金复盘：${m}。`;
      }),
    fetchLhbDaily(null, signal)
      .then((d) => {
        lhbDaily.value = d.items;
        lhbDailyDate.value = d.trade_date;
      })
      .catch((e) => {
        const m = liveMsg(e);
        if (m) liveError.value += `龙虎榜：${m}。`;
      }),
    fetchLhbDominance(10, signal)
      .then((d) => {
        dominance.value = d.items;
        dominanceMeta.value = { days: d.days, count: d.count };
      })
      .catch((e) => {
        const m = liveMsg(e);
        if (m) liveError.value += `霸榜：${m}。`;
      }),
    fetchHotMoneyList(null, signal)
      .then((d) => {
        hotMoneyList.value = d;
      })
      .catch((e) => {
        const m = liveMsg(e);
        if (m) liveError.value += `游资名录：${m}。`;
      }),
  ];
  await Promise.allSettled(jobs);
  if (!signal.aborted) liveLoading.value = false;
}

const inflowTop = computed(() => (fundflow.value?.inflows ?? []).slice(0, 8));
const outflowTop = computed(() => (fundflow.value?.outflows ?? []).slice(0, 6));
const themesIn = computed(() =>
  (fundflow.value?.themes ?? []).filter((t) => t.side === "in"),
);
const themesOut = computed(() =>
  (fundflow.value?.themes ?? []).filter((t) => t.side === "out"),
);
const lhbTop = computed(() =>
  [...lhbDaily.value]
    .sort((a, b) => Math.abs(b.net_buy) - Math.abs(a.net_buy))
    .slice(0, 8),
);
const dominanceTop = computed(() => dominance.value.slice(0, 8));
const marketRows = computed(() => {
  const m = fundflow.value?.market;
  if (!m) return null;
  return [
    { label: "上证", value: m.sh },
    { label: "深证", value: m.sz },
    { label: "创业板", value: m.cyb },
  ];
});
const consensusRows = computed(() => {
  if (!fundflow.value || !lhbDaily.value.length) return [];
  const byCode = new Map(lhbDaily.value.map((i) => [i.code, i]));
  return (fundflow.value.inflows ?? [])
    .filter((f) => byCode.has(f.code))
    .map((f) => ({ fund: f, lhb: byCode.get(f.code)! }))
    .slice(0, 6);
});
const hotMoneyFeatured = computed(() =>
  [...hotMoneyList.value]
    .filter((h) => h.featured)
    .sort((a, b) => (b.tier ?? "A").localeCompare(a.tier ?? "A"))
    .slice(0, 6),
);

function pctClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return v > 0 ? "up" : v < 0 ? "down" : "";
}

function signedPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function openKline(code: string, name: string) {
  void router.push({ name: "kline", query: { code, name } });
}

async function loadHotMoneyTrades(trader: HotMoneyTrader) {
  if (hotMoneyBusy.value) return;
  hotMoneyBusy.value = true;
  hotMoneyTrader.value = trader;
  hotMoneyTrades.value = [];
  try {
    const d = await fetchHotMoneyTrades(trader.id, { days: 7 });
    hotMoneyTrades.value = d.items;
  } catch {
    hotMoneyTrades.value = [];
    hotMoneyTrader.value = null;
  } finally {
    hotMoneyBusy.value = false;
  }
}

async function doSearch() {
  const q = searchQuery.value.trim();
  if (!q) {
    searchResults.value = [];
    return;
  }
  searchBusy.value = true;
  try {
    searchResults.value = await searchStocks(q, 8);
  } catch {
    searchResults.value = [];
  } finally {
    searchBusy.value = false;
  }
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void doSearch();
  }, 260);
}

function pickSearch(item: StockSearchItem) {
  searchQuery.value = "";
  searchResults.value = [];
  openKline(item.code, item.name);
}

onMounted(() => {
  void loadLive();
});

onBeforeUnmount(() => {
  liveAbort?.abort();
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="qnt-page">
    <header class="qnt-hero">
      <div class="qnt-hero-text">
        <p class="qnt-kicker">Quant · Data Intelligence</p>
        <h1>数据量化</h1>
        <p class="qnt-sub">
          全市场情绪与资金 · 模型因子与训练 · 回测回撤 · 资金情报台 · 模拟盘 —— 一屏尽览。布局像素参考大波浪数据量化台，主题沿用本项目默认主题。
        </p>
        <p class="qnt-ref">
          布局参考
          <a
            href="https://www.yyqyx.com/quant/"
            target="_blank"
            rel="noreferrer"
          >yyqyx.com/quant</a>
          ；本项目已有能力在右侧快捷入口，其余模块待数据源接入后逐项点亮。
        </p>
      </div>
      <div class="qnt-quick">
        <span class="qnt-quick-label">本项目已有能力</span>
        <div class="qnt-quick-links">
          <button
            v-for="q in quickLinks"
            :key="q.to"
            type="button"
            class="qnt-chip"
            @click="go(q.to)"
          >
            {{ q.label }} →
          </button>
        </div>
      </div>
    </header>

    <nav class="qnt-toc" aria-label="模块导航">
      <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="qnt-toc-item">
        {{ s.title }}
      </a>
    </nav>

    <section v-for="s in sections" :id="s.id" :key="s.id" class="qnt-section">
      <div class="qnt-section-head">
        <h2>{{ s.title }}</h2>
        <p>{{ s.desc }}</p>
        <em v-if="s.meta" class="qnt-meta">{{ s.meta }}</em>
      </div>

      <div class="qnt-grid">
        <article
          v-for="c in s.cards"
          :key="c.title"
          class="qnt-card"
          :class="{ 'qnt-card-span': c.span }"
        >
          <header class="qnt-card-head">
            <h3>{{ c.title }}</h3>
            <span v-if="c.badge" class="qnt-badge">{{ c.badge }}</span>
          </header>
          <p v-if="c.desc" class="qnt-desc">{{ c.desc }}</p>
          <div v-if="c.live" class="qnt-live">
            <!-- 大盘实时 -->
            <template v-if="c.live === 'market'">
              <div v-if="liveLoading && !marketRows" class="qnt-live-empty">正在加载大盘资金…</div>
              <div v-else-if="marketRows" class="qnt-metrics">
                <div v-for="m in marketRows" :key="m.label" class="qnt-metric">
                  <span>{{ m.label }}</span>
                  <strong :class="pctClass(m.value)">{{ formatFlowAmount(m.value) }}</strong>
                </div>
              </div>
              <div v-else class="qnt-live-empty">
                今日全市场主力：净流入合计 {{ formatFlowAmount(fundflow?.inflow_total) }} · 净流出合计 {{ formatFlowAmount(fundflow?.outflow_total) }}
              </div>
            </template>

            <!-- 市场情绪综述 -->
            <template v-else-if="c.live === 'sentiment'">
              <div v-if="fundflow?.summary" class="qnt-summary">{{ fundflow.summary }}</div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在加载市场情绪…</div>
              <div v-else class="qnt-live-empty">暂无情绪数据</div>
              <div v-if="fundflow" class="qnt-chip-row">
                <span class="qnt-tag up">净流入 {{ (fundflow.inflows ?? []).length }} 家</span>
                <span class="qnt-tag down">净流出 {{ (fundflow.outflows ?? []).length }} 家</span>
                <span v-if="lhbDaily.length" class="qnt-tag">龙虎榜 {{ lhbDaily.length }} 家</span>
              </div>
            </template>

            <!-- 主力资金看点 -->
            <template v-else-if="c.live === 'inflow'">
              <div v-if="inflowTop.length" class="qnt-rows">
                <button
                  v-for="row in inflowTop"
                  :key="row.code"
                  type="button"
                  class="qnt-row"
                  @dblclick="openKline(row.code, row.name)"
                >
                  <span class="qnt-rank">{{ row.rank }}</span>
                  <span class="qnt-id"><strong>{{ row.name }}</strong><em>{{ row.code }}</em></span>
                  <span class="qnt-num up">{{ formatFlowAmount(row.net_amount) }}</span>
                  <span class="qnt-num" :class="pctClass(row.change_pct)">{{ signedPct(row.change_pct) }}</span>
                </button>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在加载主力资金…</div>
              <div v-else class="qnt-live-empty">暂无主力净流入数据</div>
            </template>

            <!-- 主力 × 游资 共识 -->
            <template v-else-if="c.live === 'consensus'">
              <div v-if="consensusRows.length" class="qnt-rows">
                <button
                  v-for="r in consensusRows"
                  :key="r.fund.code"
                  type="button"
                  class="qnt-row"
                  @dblclick="openKline(r.fund.code, r.fund.name)"
                >
                  <span class="qnt-id"><strong>{{ r.fund.name }}</strong><em>{{ r.fund.code }}</em></span>
                  <span class="qnt-num up">{{ formatFlowAmount(r.fund.net_amount) }}</span>
                  <span class="qnt-num" :class="pctClass(r.lhb.net_buy)">{{ formatAmount(r.lhb.net_buy) }}</span>
                </button>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在比对主力 × 龙虎榜…</div>
              <div v-else class="qnt-live-empty">今日暂无主力 × 游资共振（两榜无同日交集）</div>
            </template>

            <!-- 资金流全景 -->
            <template v-else-if="c.live === 'panorama'">
              <div v-if="fundflow" class="qnt-metrics qnt-metrics-2">
                <div class="qnt-metric"><span>净流入合计</span><strong class="up">{{ formatFlowAmount(fundflow.inflow_total) }}</strong></div>
                <div class="qnt-metric"><span>净流出合计</span><strong class="down">{{ formatFlowAmount(fundflow.outflow_total) }}</strong></div>
                <div class="qnt-metric"><span>题材方向</span><strong>{{ (fundflow.themes ?? []).length }}</strong></div>
                <div class="qnt-metric"><span>龙虎榜家数</span><strong>{{ lhbDaily.length }}</strong></div>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在加载资金全景…</div>
              <div v-else class="qnt-live-empty">暂无资金全景数据</div>
            </template>

            <!-- 主力资金雷达 -->
            <template v-else-if="c.live === 'radar'">
              <div v-if="inflowTop.length || outflowTop.length" class="qnt-split">
                <div class="qnt-split-col">
                  <h4 class="up">净流入</h4>
                  <button
                    v-for="row in inflowTop.slice(0, 5)"
                    :key="'i' + row.code"
                    type="button"
                    class="qnt-row"
                    @dblclick="openKline(row.code, row.name)"
                  >
                    <span class="qnt-id"><strong>{{ row.name }}</strong><em>{{ row.code }}</em></span>
                    <span class="qnt-num up">{{ formatFlowAmount(row.net_amount) }}</span>
                  </button>
                </div>
                <div class="qnt-split-col">
                  <h4 class="down">净流出</h4>
                  <button
                    v-for="row in outflowTop.slice(0, 5)"
                    :key="'o' + row.code"
                    type="button"
                    class="qnt-row"
                    @dblclick="openKline(row.code, row.name)"
                  >
                    <span class="qnt-id"><strong>{{ row.name }}</strong><em>{{ row.code }}</em></span>
                    <span class="qnt-num down">{{ formatFlowAmount(row.net_amount) }}</span>
                  </button>
                </div>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在加载主力雷达…</div>
              <div v-else class="qnt-live-empty">暂无主力资金雷达数据</div>
            </template>

            <!-- 板块资金轮动 -->
            <template v-else-if="c.live === 'themes'">
              <div v-if="themesIn.length || themesOut.length" class="qnt-theme-block">
                <div v-if="themesIn.length" class="qnt-theme-row">
                  <span class="qnt-theme-label up">涌入</span>
                  <span
                    v-for="t in themesIn.slice(0, 5)"
                    :key="t.name"
                    class="qnt-tag up"
                    :title="formatFlowAmount(t.net_amount)"
                  >{{ t.name }} {{ formatFlowAmount(t.net_amount) }}</span>
                </div>
                <div v-if="themesOut.length" class="qnt-theme-row">
                  <span class="qnt-theme-label down">撤离</span>
                  <span
                    v-for="t in themesOut.slice(0, 5)"
                    :key="t.name"
                    class="qnt-tag down"
                    :title="formatFlowAmount(t.net_amount)"
                  >{{ t.name }} {{ formatFlowAmount(t.net_amount) }}</span>
                </div>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在加载板块轮动…</div>
              <div v-else class="qnt-live-empty">暂无板块资金数据</div>
            </template>

            <!-- 今日龙虎榜 -->
            <template v-else-if="c.live === 'lhb-today'">
              <div v-if="lhbTop.length" class="qnt-rows">
                <button
                  v-for="row in lhbTop"
                  :key="row.code"
                  type="button"
                  class="qnt-row"
                  @dblclick="openKline(row.code, row.name)"
                >
                  <span class="qnt-id"><strong>{{ row.name }}</strong><em>{{ row.code }} · {{ row.trade_date }}</em></span>
                  <span class="qnt-num" :class="pctClass(row.net_buy)">{{ formatAmount(row.net_buy) }}</span>
                  <span class="qnt-num" :class="pctClass(row.change_pct)">{{ signedPct(row.change_pct) }}</span>
                </button>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在加载龙虎榜…</div>
              <div v-else class="qnt-live-empty">今日暂无龙虎榜数据</div>
            </template>

            <!-- 龙虎榜霸榜 -->
            <template v-else-if="c.live === 'dominance'">
              <div v-if="dominanceTop.length" class="qnt-rows">
                <button
                  v-for="row in dominanceTop"
                  :key="row.code"
                  type="button"
                  class="qnt-row"
                  @dblclick="openKline(row.code, row.name)"
                >
                  <span class="qnt-rank">{{ row.days_on_board }}日</span>
                  <span class="qnt-id"><strong>{{ row.name }}</strong><em>{{ row.code }}</em></span>
                  <span class="qnt-num" :class="pctClass(row.net_buy)">{{ formatAmount(row.net_buy) }}</span>
                  <span class="qnt-num muted">{{ row.last_date }}</span>
                </button>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在统计近10日霸榜…</div>
              <div v-else class="qnt-live-empty">近10日暂无重复上榜个股</div>
              <div v-if="dominanceMeta" class="qnt-live-meta">近 {{ dominanceMeta.days }} 日共 {{ dominanceMeta.count }} 只上榜，双击个股进入 K 线</div>
            </template>

            <!-- 游资动向 -->
            <template v-else-if="c.live === 'hotmoney'">
              <div v-if="hotMoneyFeatured.length" class="qnt-rows">
                <button
                  v-for="h in hotMoneyFeatured"
                  :key="h.id"
                  type="button"
                  class="qnt-row"
                  :class="{ 'qnt-row-active': hotMoneyTrader?.id === h.id }"
                  @click="loadHotMoneyTrades(h)"
                >
                  <span class="qnt-id"><strong>{{ h.name }}</strong><em>{{ h.seat }}</em></span>
                  <span class="qnt-num muted">{{ h.tier ?? 'A' }} 级</span>
                </button>
              </div>
              <div v-else-if="liveLoading" class="qnt-live-empty">正在加载游资名录…</div>
              <div v-else class="qnt-live-empty">暂无游资名录数据</div>
              <div v-if="hotMoneyBusy" class="qnt-live-empty">正在加载 {{ hotMoneyTrader?.name }} 近期交易…</div>
              <div v-else-if="hotMoneyTrader && hotMoneyTrades.length" class="qnt-rows qnt-sub">
                <button
                  v-for="(t, i) in hotMoneyTrades.slice(0, 4)"
                  :key="t.code + i"
                  type="button"
                  class="qnt-row"
                  @dblclick="openKline(t.code, t.name)"
                >
                  <span class="qnt-id"><strong>{{ t.name }}</strong><em>{{ t.trade_date }} · {{ t.side === 'buy' ? '买入' : '卖出' }}</em></span>
                  <span class="qnt-num" :class="t.side === 'buy' ? 'up' : 'down'">{{ formatAmount(t.net_amount) }}</span>
                </button>
              </div>
              <div v-else-if="hotMoneyTrader" class="qnt-live-empty">近7日暂无该游资席位交易记录</div>
            </template>

            <!-- 技术 K 线找股 -->
            <template v-else-if="c.live === 'tech-search'">
              <div class="qnt-search">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="输入代码 / 名称 / 拼音，回车或点选进入 K 线复盘"
                  @input="onSearchInput"
                  @keydown.enter="doSearch"
                />
                <span v-if="searchBusy" class="qnt-live-meta">搜索中…</span>
              </div>
              <div v-if="searchResults.length" class="qnt-rows qnt-sub">
                <button
                  v-for="s in searchResults"
                  :key="s.code"
                  type="button"
                  class="qnt-row"
                  @click="pickSearch(s)"
                >
                  <span class="qnt-id"><strong>{{ s.name }}</strong><em>{{ s.code }} · {{ s.market ?? '' }}</em></span>
                  <span class="qnt-num muted">进入 K 线 →</span>
                </button>
              </div>
              <div v-else-if="!searchQuery" class="qnt-live-empty">输入股票后进入 K 线复盘查看蜡烛形态与技术指标</div>
            </template>

            <div v-if="liveError" class="qnt-live-error">{{ liveError }}</div>
          </div>

          <table v-if="c.cols && !c.live" class="qnt-table">
            <thead>
              <tr>
                <th v-for="col in c.cols" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td :colspan="c.cols.length" class="qnt-td-empty">
                  {{ c.status ?? "暂无数据" }}
                </td>
              </tr>
            </tbody>
          </table>

          <div v-else-if="!c.live" class="qnt-status">
            <span
              class="qnt-dot"
              :class="{
                'qnt-dot-busy': (c.status ?? '').includes('加载'),
                'qnt-dot-ready': (c.status ?? '').includes('就绪'),
              }"
            />
            <span>{{ c.status ?? "等待接入数据源" }}</span>
          </div>

          <button v-if="c.to" type="button" class="qnt-go" @click="go(c.to)">
            前往现有页面 →
          </button>
        </article>
      </div>
    </section>

    <footer class="qnt-foot">
      当前为信息架构占位版：布局像素参考大波浪数据量化台，主题沿用本项目默认主题；各量化模块（模型因子、回测、期权、可转债等）项目尚无数据源，先以占位呈现，需要接真实数据时再单独确定优先级。
    </footer>
  </div>
</template>

<style scoped>
.qnt-page {
  height: 100%;
  overflow: auto;
  padding: 22px 26px 48px;
  background: var(--color-bg);
  color: var(--color-text);
  scroll-behavior: smooth;
}

.qnt-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  padding: 18px 0 16px;
  border-bottom: 1px solid var(--color-border);
}

.qnt-hero-text {
  min-width: 0;
}

.qnt-kicker {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.qnt-hero h1 {
  margin: 4px 0 0;
  font-size: 34px;
  font-weight: 750;
  letter-spacing: -0.03em;
}

.qnt-sub {
  margin: 8px 0 0;
  max-width: 46rem;
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1.6;
}

.qnt-ref {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.qnt-ref a {
  color: var(--color-accent);
  text-decoration: none;
}

.qnt-ref a:hover {
  text-decoration: underline;
}

.qnt-quick {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.qnt-quick-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.qnt-quick-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  max-width: 460px;
}

.qnt-chip {
  appearance: none;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  color: var(--color-text);
  border-radius: 999px;
  padding: 7px 13px;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.2s ease;
}

.qnt-chip:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.qnt-chip:active {
  transform: scale(0.98);
}

.qnt-toc {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 12px 0;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
}

.qnt-toc-item {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-muted);
  text-decoration: none;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid transparent;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.qnt-toc-item:hover {
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

.qnt-section {
  scroll-margin-top: 74px;
  padding: 24px 0 6px;
}

.qnt-section-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 12px;
}

.qnt-section-head h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 750;
  letter-spacing: -0.01em;
}

.qnt-section-head p {
  margin: 0;
  max-width: 62rem;
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.qnt-meta {
  font-style: normal;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
  border-radius: 999px;
  padding: 3px 10px;
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

.qnt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.qnt-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 15px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg-elevated);
  min-width: 0;
}

.qnt-card-span {
  grid-column: 1 / -1;
}

.qnt-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.qnt-card h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.qnt-badge {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-accent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
  border-radius: 999px;
  padding: 2px 9px;
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

.qnt-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-muted);
}

.qnt-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  font-size: 12.5px;
  color: var(--color-text-muted);
}

.qnt-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-text-muted) 55%, transparent);
  flex-shrink: 0;
}

.qnt-dot-busy {
  background: var(--color-accent);
  animation: qnt-pulse 1.1s ease-in-out infinite;
}

.qnt-dot-ready {
  background: var(--color-down);
}

@keyframes qnt-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.qnt-go {
  align-self: flex-start;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font-size: 12.5px;
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}

.qnt-go:hover {
  text-decoration: underline;
}

.qnt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.qnt-table th {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  padding: 6px 8px;
  white-space: nowrap;
}

.qnt-table td {
  padding: 10px 8px;
  color: var(--color-text-muted);
}

.qnt-td-empty {
  text-align: center;
}

.qnt-foot {
  margin-top: 26px;
  padding: 16px 18px;
  border: 1px dashed var(--color-border);
  border-radius: 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-bg-elevated) 60%, transparent);
}

/* Apple / Gemini 玻璃主题：让卡片吃到 Liquid Glass / 幻彩 */
:global(html[data-theme="apple"]) .qnt-page,
:global(html[data-theme="apple-dark"]) .qnt-page,
:global(html[data-theme="gemini-light"]) .qnt-page,
:global(html[data-theme="gemini"]) .qnt-page,
:global(html[data-theme="goose"]) .qnt-page {
  background: transparent;
}

:global(html[data-theme="apple"]) .qnt-card,
:global(html[data-theme="apple-dark"]) .qnt-card,
:global(html[data-theme="gemini-light"]) .qnt-card,
:global(html[data-theme="gemini"]) .qnt-card {
  background: var(--glass-bg);
  background-color: var(--color-bg-elevated);
  border-color: var(--glass-border);
  border-radius: var(--radius-surface);
  box-shadow: var(--glass-shadow);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  backdrop-filter: blur(var(--glass-blur)) saturate(180%);
}

:global(html[data-theme="apple"]) .qnt-toc,
:global(html[data-theme="apple-dark"]) .qnt-toc,
:global(html[data-theme="gemini-light"]) .qnt-toc,
:global(html[data-theme="gemini"]) .qnt-toc {
  background: transparent;
}

:global(html[data-theme="goose"]) .qnt-card {
  background: #fffceb;
  border-color: color-mix(in srgb, #96939b 42%, #faf4d3);
}

@media (max-width: 900px) {
  .qnt-hero {
    flex-direction: column;
    align-items: stretch;
  }

  .qnt-quick {
    align-items: flex-start;
  }

  .qnt-quick-links {
    justify-content: flex-start;
  }
}
/* ---------- 内部数据拉通：真实数据卡片 ---------- */
.qnt-live {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
  min-width: 0;
}

.qnt-live-empty,
.qnt-live-error {
  font-size: 12.5px;
  color: var(--color-text-muted);
  line-height: 1.6;
  padding: 8px 0;
}

.qnt-live-error {
  color: var(--color-up);
}

.qnt-live-meta {
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.qnt-summary {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 18%, var(--color-border));
  border-radius: 10px;
  padding: 10px 12px;
}

.qnt-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.qnt-metrics-2 {
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
}

.qnt-metric {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-bg) 55%, transparent);
}

.qnt-metric span {
  font-size: 11.5px;
  color: var(--color-text-muted);
}

.qnt-metric strong {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.qnt-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.qnt-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 9px;
  color: var(--color-text-muted);
  background: var(--color-bg);
  white-space: nowrap;
}

.qnt-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.qnt-sub {
  border-top: 1px dashed var(--color-border);
  padding-top: 6px;
}

.qnt-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font-size: 12.5px;
  text-align: left;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.qnt-row:hover {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
}

.qnt-row-active {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.qnt-rank {
  font-size: 11.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  justify-self: start;
}

.qnt-id {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.qnt-id strong {
  font-size: 12.5px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qnt-id em {
  font-style: normal;
  font-size: 11px;
  color: var(--color-accent);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qnt-num {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  justify-self: end;
  white-space: nowrap;
}

.qnt-num.muted {
  color: var(--color-text-muted);
  font-size: 11.5px;
}

.qnt-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.qnt-split-col {
  min-width: 0;
}

.qnt-split-col h4 {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
}

.qnt-theme-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qnt-theme-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.qnt-theme-label {
  font-size: 11.5px;
  font-weight: 700;
  margin-right: 2px;
}

.qnt-search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qnt-search input {
  flex: 1;
  min-width: 0;
  appearance: none;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
}

.qnt-search input:focus {
  border-color: var(--color-accent);
}

.up {
  color: var(--color-up);
}

.down {
  color: var(--color-down);
}

@media (max-width: 640px) {
  .qnt-split {
    grid-template-columns: 1fr;
  }
}
</style>
