/**
 * K线渲染引擎 —— 类型定义。
 *
 * 设计目标（对应需求说明书 3.2）：数据（KlineBar）与渲染规则
 * （KlineTheme / PatternRule）完全解耦，核心引擎 (engine.ts) 只做
 * "数据 + 配置 -> ECharts option" 的纯函数转换，不包含任何硬编码的
 * 视觉判断逻辑；新增形态识别规则通过注册 PatternRule 完成，无需
 * 改动引擎或 Vue 组件本身。
 */

/** 单根K线的原始行情数据（与具体渲染方式无关）。 */
export interface KlineBar {
  /** 毫秒级时间戳 */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 分时均价（VWAP），仅 intraday 模式有 */
  avg?: number;
  /** 分时阶段：集合竞价 / 连续竞价 */
  phase?: "auction" | "continuous";
}

/** 图表模式：日/周/月用 candle；分时用折线。 */
export type ChartMode = "candle" | "intraday";

export interface BuildOptionParams {
  mode?: ChartMode;
  /** 昨收，分时图画基准线并用它算涨跌幅 */
  prevClose?: number | null;
  /** 是否显示跳空缺口，默认 true */
  showGaps?: boolean;
  /** 分时是否显示集合竞价区，默认 true */
  showAuction?: boolean;
  /** 覆盖主图均线（最多 12 根） */
  maLines?: MaLineStyle[];
  /** 覆盖量能均线 */
  volMaLines?: MaLineStyle[];
  /** K 线底部区域选择滑条，默认 true（仅 candle） */
  showSlider?: boolean;
  /** 通达信风格特征叠加（涨停/破板/壹泽洗等），默认 true */
  showFeatures?: boolean;
  /** 股票代码（用于涨跌停幅度：主板10%/创业科创20%/ST5%） */
  stockCode?: string;
  /** 股票名称（检测 ST） */
  stockName?: string;
  /** 保留当前 dataZoom 窗口（百分比 0–100） */
  zoomStart?: number;
  zoomEnd?: number;
}

/** 均线周期 / 颜色 / 线宽（远航版可自定义；width=0 不可见）。 */
export interface MaLineStyle {
  period: number;
  color: string;
  name?: string;
  /** 线宽，0 表示不绘制 */
  width?: number;
}

/** 视觉主题配置：颜色、柱体样式等，均来自配置而非组件内硬编码。 */
export interface KlineTheme {
  /** 上涨（收盘价 >= 开盘价）颜色 —— A股标准为红色 */
  upColor: string;
  /** 下跌颜色 —— A股标准为绿色 */
  downColor: string;
  upBorderColor?: string;
  downBorderColor?: string;
  volumeUpColor: string;
  volumeDownColor: string;
  /** A股要求实心柱体；hollow 仅为将来兼容其他市场预留 */
  candleStyle: "solid" | "hollow";
  /** 主图均线样式 */
  maLines: MaLineStyle[];
  /** 量柱副图均线 */
  volMaLines: MaLineStyle[];
  /** MACD 线色 */
  macdDifColor: string;
  macdDeaColor: string;
  /** 十字光标 / 坐标轴标签 */
  axisPointerBg: string;
  textColor: string;
  mutedTextColor: string;
  splitLineColor: string;
  backgroundColor: string;
}

/** 十字线悬停时向外抛出的行情快照。 */
export interface KlineQuoteSnapshot {
  index: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
  ma: Record<string, number | null>;
  avg: number | null;
  volumeLabel: string;
  macd: { dif: number; dea: number; macd: number };
  /** 量能均线当前值 */
  volMa: Record<string, number | null>;
}

/** 一次形态识别命中结果。 */
export interface PatternMatch {
  ruleId: string;
  name: string;
  /** 命中区间在 bars 数组中的起止下标（含） */
  startIndex: number;
  endIndex: number;
  confidence?: number;
  meta?: Record<string, unknown>;
}

/**
 * 形态规则插件接口。
 * 基础展示（红绿实心柱）走 KlineTheme 配置；复杂形态（岛型反转、
 * 多方炮等）都实现为独立的 PatternRule，通过 engine.registerRule
 * 动态挂载，互不影响、可插拔。
 */
export interface PatternRule {
  id: string;
  name: string;
  description?: string;
  /** 在下标 index 处尝试匹配该形态；不匹配返回 null。 */
  detect(bars: KlineBar[], index: number): PatternMatch | null;
}

/** 副图指标配置（MA/MACD等），同样走配置驱动，不写死在组件里。 */
export interface IndicatorConfig {
  id: string;
  type: "MA" | "MACD" | "VOL" | "KDJ" | "CUSTOM";
  params?: Record<string, unknown>;
  visible: boolean;
}

/** 渲染引擎的整体配置：主题 + 规则 + 指标。 */
export interface KlineRenderConfig {
  theme: KlineTheme;
  rules: PatternRule[];
  indicators: IndicatorConfig[];
}

/**
 * 规则来源抽象。规则既可以硬编码在 TS 里（StaticRuleSource），
 * 也可以来自外部 markdown 规则文件（MarkdownRuleSource，解析
 * kline_custom_rules.md），引擎本身不关心规则从哪里来。
 */
export interface KlineRuleSource {
  loadRules(): Promise<PatternRule[]>;
}
