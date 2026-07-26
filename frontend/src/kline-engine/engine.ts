import type { EChartsOption } from "echarts";

import { getAShareTheme } from "./theme";
import type {
  KlineBar,
  KlineRenderConfig,
  PatternMatch,
  PatternRule,
} from "./types";

/**
 * K线渲染引擎。
 *
 * 唯一职责：把 (KlineBar[], KlineRenderConfig) 转换成 ECharts option。
 * 不读取网络、不持有业务状态、不关心数据从哪来 —— 数据获取是调用方
 * (Vue 组件 / API 层) 的事，规则集合通过 KlineRuleSource 注入，
 * 都不会硬编码进这个文件。
 */
export interface KlineRenderEngine {
  registerRule(rule: PatternRule): void;
  unregisterRule(ruleId: string): void;
  setTheme(theme: KlineRenderConfig["theme"]): void;
  buildOption(bars: KlineBar[]): EChartsOption;
  detectPatterns(bars: KlineBar[]): PatternMatch[];
}

export function createKlineEngine(
  initialConfig?: Partial<KlineRenderConfig>,
): KlineRenderEngine {
  let theme = initialConfig?.theme ?? getAShareTheme();
  const rules = new Map<string, PatternRule>(
    (initialConfig?.rules ?? []).map((rule) => [rule.id, rule]),
  );

  function registerRule(rule: PatternRule) {
    rules.set(rule.id, rule);
  }

  function unregisterRule(ruleId: string) {
    rules.delete(ruleId);
  }

  function setTheme(next: KlineRenderConfig["theme"]) {
    theme = next;
  }

  function detectPatterns(bars: KlineBar[]): PatternMatch[] {
    const matches: PatternMatch[] = [];
    for (const rule of rules.values()) {
      for (let i = 0; i < bars.length; i += 1) {
        const match = rule.detect(bars, i);
        if (match) matches.push(match);
      }
    }
    return matches;
  }

  function buildOption(bars: KlineBar[]): EChartsOption {
    const dates = bars.map((bar) => formatDate(bar.timestamp));
    // ECharts candlestick 数据顺序为 [open, close, low, high]
    const candleData = bars.map((bar) => [
      bar.open,
      bar.close,
      bar.low,
      bar.high,
    ]);
    const volumeData = bars.map((bar, i) => ({
      value: bar.volume,
      itemStyle: {
        color: bar.close >= bar.open ? theme.volumeUpColor : theme.volumeDownColor,
      },
    }));

    return {
      animation: false,
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        label: { backgroundColor: "#777" },
      },
      grid: [
        { left: 56, right: 24, top: 16, height: "58%" },
        { left: 56, right: 24, top: "72%", height: "18%" },
      ],
      xAxis: [
        {
          type: "category",
          data: dates,
          gridIndex: 0,
          axisLine: { onZero: false },
          splitLine: { show: false },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 1,
          axisLine: { onZero: false },
          splitLine: { show: false },
          axisLabel: { show: false },
        },
      ],
      yAxis: [
        { scale: true, gridIndex: 0, splitArea: { show: false } },
        { scale: true, gridIndex: 1, axisLabel: { show: false } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 50, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], top: "92%", height: 16 },
      ],
      series: [
        {
          type: "candlestick",
          name: "K线",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: candleData,
          // itemStyle.color/color0 走实心填充（不透明色块），
          // 满足 A股"实心柱体"规范；如需空心柱只需把 color 换成 transparent。
          itemStyle: {
            color: theme.upColor,
            color0: theme.downColor,
            borderColor: theme.upBorderColor ?? theme.upColor,
            borderColor0: theme.downBorderColor ?? theme.downColor,
          },
        },
        {
          type: "bar",
          name: "成交量",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumeData,
        },
      ],
    };
  }

  return { registerRule, unregisterRule, setTheme, buildOption, detectPatterns };
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
