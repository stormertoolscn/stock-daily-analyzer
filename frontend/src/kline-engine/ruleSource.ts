import type { KlineRuleSource, PatternRule } from "./types";

/** 硬编码在代码里的规则来源，适合内置的基础形态。 */
export class StaticRuleSource implements KlineRuleSource {
  constructor(private readonly rules: PatternRule[]) {}

  async loadRules(): Promise<PatternRule[]> {
    return this.rules;
  }
}

/**
 * 从 kline_custom_rules.md 解析形态规则的规则来源。
 *
 * 需求说明书第5步要求"读取 kline_custom_rules.md，将具体绘图逻辑
 * 注入渲染引擎"，但该文件尚未提供，因此这里先占位：接口就绪，
 * 拿到文件后只需实现 parseMarkdown() 的具体解析逻辑（约定格式、
 * 提取规则描述并映射为 PatternRule[]），无需改动引擎或组件代码。
 */
export class MarkdownRuleSource implements KlineRuleSource {
  constructor(private readonly markdownUrl: string) {}

  async loadRules(): Promise<PatternRule[]> {
    const res = await fetch(this.markdownUrl);
    if (!res.ok) {
      throw new Error(
        `无法加载规则文件 ${this.markdownUrl}: HTTP ${res.status}`,
      );
    }
    const markdown = await res.text();
    return this.parseMarkdown(markdown);
  }

  // TODO: 待 kline_custom_rules.md 提供后，按约定格式实现解析。
  private parseMarkdown(_markdown: string): PatternRule[] {
    return [];
  }
}
