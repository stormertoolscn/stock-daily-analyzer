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
