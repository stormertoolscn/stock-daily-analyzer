import type { EChartsOption } from "echarts";

import {
  detectBarFeatures,
  resolveLimitRatio,
  buildFeatureOverlay,
  detectAllIslandReversals,
  islandLabel,
  ISLAND_BOX_STYLE,
  BIG_ISLAND_BOX_STYLE,
} from "./features";
import { detectPriceGaps } from "./gaps";
import { formatVolume, sma } from "./indicators";
import { buildMacdVisual, MACD_LONG, MACD_MM, MACD_SHORT } from "./macdVisual";
import { getAShareTheme } from "./theme";
import {
  detectVolumeFeatures,
  buildVolumeOverlaySeries,
} from "./volumeFeatures";
import type {
  BuildOptionParams,
  ChartMode,
  KlineBar,
  KlineQuoteSnapshot,
  KlineRenderConfig,
  PatternMatch,
  PatternRule,
} from "./types";

/**
 * K线渲染引擎。
 *
 * 唯一职责：把 (KlineBar[], KlineRenderConfig) 转换成 ECharts option。
 * candle：主图 K+MA → 量柱 → MACD
 * intraday：主图分时价+均价 → 量柱（同花顺分时样式）
 */

/** 与右侧筹码图共用的主图几何（远航版；无底部缩略选区） */
export const KLINE_LAYOUT = {
  main: { topPx: 8, heightPct: 58 },
  volume: { topPct: 64, heightPct: 12 },
  macd: { topPct: 78, heightPct: 16 },
} as const;

/** 设置里的线宽 → 实际描边（宽度 1 画得更细，贴近远航版） */
function maStrokeWidth(width?: number): number {
  const w = width ?? 1;
  if (w <= 0) return 0;
  if (w <= 1) return 0.7;
  if (w <= 1.5) return 1;
  return Math.min(4, w * 0.75);
}

export interface KlineRenderEngine {
  registerRule(rule: PatternRule): void;
  unregisterRule(ruleId: string): void;
  setTheme(theme: KlineRenderConfig["theme"]): void;
  buildOption(bars: KlineBar[], params?: BuildOptionParams): EChartsOption;
  detectPatterns(bars: KlineBar[]): PatternMatch[];
  getQuoteSnapshot(
    bars: KlineBar[],
    index: number,
    params?: BuildOptionParams,
  ): KlineQuoteSnapshot | null;
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

  function resolveMaLines(params?: BuildOptionParams) {
    return (params?.maLines ?? theme.maLines)
      .map((line) => ({
        ...line,
        name: line.name ?? `MA${line.period}`,
        width: line.width ?? 1,
      }))
      .filter((line) => line.period > 0 && (line.width ?? 1) > 0);
  }

  function resolveVolMaLines(params?: BuildOptionParams) {
    return (params?.volMaLines ?? theme.volMaLines ?? [])
      .map((line) => ({
        ...line,
        name: line.name ?? `MA${line.period}`,
        width: line.width ?? 1,
        lineType: line.lineType ?? "solid",
      }))
      .filter((line) => line.period > 0 && (line.width ?? 1) > 0);
  }

  function computeSeries(bars: KlineBar[], params?: BuildOptionParams) {
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const maSeries = resolveMaLines(params).map((line) => ({
      ...line,
      data: sma(closes, line.period),
    }));
    const volMaSeries = resolveVolMaLines(params).map((line) => ({
      ...line,
      data: sma(volumes, line.period),
    }));
    const macdSeries = buildMacdVisual(bars, {
      short: params?.macdShort ?? MACD_SHORT,
      long: params?.macdLong ?? MACD_LONG,
      mm: params?.macdMm ?? MACD_MM,
    });
    return { closes, maSeries, volMaSeries, macdSeries };
  }

  function getQuoteSnapshot(
    bars: KlineBar[],
    index: number,
    params?: BuildOptionParams,
  ): KlineQuoteSnapshot | null {
    if (!bars.length || index < 0 || index >= bars.length) return null;
    const bar = bars[index];
    const mode: ChartMode = params?.mode ?? "candle";
    const baseline =
      mode === "intraday" && params?.prevClose != null && params.prevClose > 0
        ? params.prevClose
        : (index > 0 ? bars[index - 1].close : bar.open);
    const change = bar.close - baseline;
    const changePct = baseline === 0 ? 0 : (change / baseline) * 100;
    const { maSeries, volMaSeries, macdSeries } = computeSeries(bars, params);
    const ma: Record<string, number | null> = {};
    for (const line of maSeries) {
      ma[line.name ?? `MA${line.period}`] = line.data[index];
    }
    const volMa: Record<string, number | null> = {};
    for (const line of volMaSeries) {
      volMa[line.name ?? `MA${line.period}`] = line.data[index];
    }
    return {
      index,
      date:
        mode === "intraday"
          ? formatDateTime(bar.timestamp)
          : formatDate(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      change,
      changePct,
      ma,
      volMa,
      avg: bar.avg ?? null,
      volumeLabel: formatVolume(bar.volume),
      macd: {
        dif: macdSeries.dif[index],
        dea: macdSeries.dea[index],
        macd: macdSeries.macd[index],
      },
    };
  }

  function buildIntradayOption(
    bars: KlineBar[],
    prevClose?: number | null,
    showAuction = true,
    rangeHighlight?: { start: number; end: number } | null,
  ): EChartsOption {
    const filtered = showAuction
      ? bars
      : bars.filter((b) => b.phase !== "auction");
    const view = filtered.length ? filtered : bars;

    const times = view.map((b) => formatTime(b.timestamp));
    const closes = view.map((b) => b.close);
    const avgs = view.map((b) => b.avg ?? null);
    const baseline = prevClose && prevClose > 0 ? prevClose : view[0].open;

    const auctionEndIdx = (() => {
      let last = -1;
      view.forEach((b, i) => {
        if (b.phase === "auction") last = i;
      });
      return last;
    })();
    const hasAuction = auctionEndIdx >= 0;

    const volumeData = view.map((bar, i) => {
      const prev = i > 0 ? view[i - 1].close : bar.open;
      const isAuction = bar.phase === "auction";
      return {
        value: bar.volume,
        itemStyle: {
          color: isAuction
            ? "rgba(64, 128, 255, 0.55)"
            : bar.close >= prev
              ? theme.volumeUpColor
              : theme.volumeDownColor,
        },
      };
    });

    // 价格轴相对昨收对称，分时图更稳
    const maxDev = Math.max(
      ...closes.map((c) => Math.abs(c - baseline)),
      baseline * 0.01,
    );
    const yMin = baseline - maxDev * 1.15;
    const yMax = baseline + maxDev * 1.15;

    const axisLabelStyle = {
      color: theme.mutedTextColor,
      fontSize: 11,
    };
    const splitLine = {
      show: true,
      lineStyle: {
        color: theme.splitLineColor,
        type: "dashed" as const,
        width: 0.5,
        opacity: 0.7,
      },
    };

    const priceColor =
      closes[closes.length - 1] >= baseline ? theme.upColor : theme.downColor;

    // X 轴刻度：竞价起点 / 开盘 / 上午收 / 下午开 / 收盘
    const labelSet = new Set(["09:15", "09:25", "09:30", "10:30", "11:30", "13:00", "14:00", "15:00"]);
    const labelIdx = new Set<number>();
    times.forEach((t, i) => {
      if (labelSet.has(t)) labelIdx.add(i);
    });
    if (times.length) {
      labelIdx.add(0);
      labelIdx.add(times.length - 1);
    }

    const auctionMarkArea =
      hasAuction && showAuction
        ? {
            silent: true,
            itemStyle: {
              color: "rgba(64, 128, 255, 0.06)",
            },
            data: [
              [
                {
                  xAxis: times[0],
                  name: "集合竞价",
                  label: {
                    show: true,
                    position: "insideTopLeft",
                    color: "#4080ff",
                    fontSize: 10,
                    offset: [4, 2],
                  },
                },
                { xAxis: times[auctionEndIdx] },
              ],
            ],
          }
        : undefined;

    /** 将全量 bars 下标映射到当前 view（可能已去掉竞价） */
    const mapToView = (fullIdx: number): number => {
      if (view === bars) {
        return Math.max(0, Math.min(view.length - 1, fullIdx));
      }
      const ts = bars[fullIdx]?.timestamp;
      if (ts == null) return 0;
      let best = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < view.length; i += 1) {
        const d = Math.abs(view[i].timestamp - ts);
        if (d < bestDiff) {
          bestDiff = d;
          best = i;
        }
      }
      return best;
    };

    const rangeMarkArea = (() => {
      if (!rangeHighlight || view.length < 2) return undefined;
      let a = mapToView(rangeHighlight.start);
      let b = mapToView(rangeHighlight.end);
      if (a > b) [a, b] = [b, a];
      // 全日未缩进时不铺底；一推拉就出左侧浅红选区
      if (a <= 0 && b >= view.length - 1) return undefined;
      return {
        silent: true,
        itemStyle: {
          color: "rgba(245, 34, 45, 0.10)",
        },
        data: [[{ xAxis: times[a] }, { xAxis: times[b] }]],
      };
    })();

    return {
      animation: false,
      backgroundColor: theme.backgroundColor,
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        label: {
          backgroundColor: theme.axisPointerBg,
          color: "#fff",
          borderRadius: 2,
          padding: [3, 6],
          fontSize: 11,
        },
        lineStyle: { color: "#9aa3af", width: 1, type: "dashed" },
      },
      tooltip: {
        show: true,
        trigger: "axis",
        triggerOn: "mousemove|click",
        formatter: () => "",
        backgroundColor: "transparent",
        borderWidth: 0,
        padding: 0,
        textStyle: { fontSize: 0, color: "transparent" },
        extraCssText: "width:0;height:0;overflow:hidden;pointer-events:none;",
        axisPointer: {
          type: "line",
          snap: true,
          animation: false,
          lineStyle: {
            color: "#9aa3af",
            width: 1,
            type: "dashed",
          },
          label: { show: false },
          link: [{ xAxisIndex: "all" }],
        },
      },
      grid: [
        { left: 12, right: 56, top: 28, height: "62%" },
        { left: 12, right: 56, top: "74%", height: "18%" },
      ],
      xAxis: [
        {
          type: "category",
          data: times,
          gridIndex: 0,
          boundaryGap: false,
          axisLine: { lineStyle: { color: theme.splitLineColor } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          axisPointer: {
            show: true,
            type: "line",
            snap: true,
            label: { show: false },
            lineStyle: {
              color: "#9aa3af",
              width: 1,
              type: "dashed",
            },
          },
        },
        {
          type: "category",
          data: times,
          gridIndex: 1,
          boundaryGap: false,
          axisLine: { lineStyle: { color: theme.splitLineColor } },
          axisTick: { show: false },
          axisLabel: {
            ...axisLabelStyle,
            interval: (idx: number) => labelIdx.has(idx),
            showMaxLabel: true,
            showMinLabel: true,
          },
          splitLine: { show: false },
          axisPointer: {
            show: true,
            type: "line",
            snap: true,
            lineStyle: {
              color: "#9aa3af",
              width: 1,
              type: "dashed",
            },
          },
        },
      ],
      yAxis: [
        {
          type: "value",
          min: yMin,
          max: yMax,
          gridIndex: 0,
          position: "right",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            ...axisLabelStyle,
            formatter: (v: number) => v.toFixed(2),
          },
          splitLine,
          splitNumber: 4,
          axisPointer: { show: false },
        },
        {
          scale: true,
          gridIndex: 1,
          position: "right",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          splitNumber: 2,
        },
      ],
      series: [
        {
          type: "line",
          name: "分时",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: closes,
          showSymbol: false,
          lineStyle: { width: 1.4, color: priceColor },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${priceColor}22` },
                { offset: 1, color: `${priceColor}00` },
              ],
            },
          },
          markArea: auctionMarkArea,
          markLine: {
            silent: true,
            symbol: "none",
            label: {
              show: true,
              position: "end",
              formatter: () => baseline.toFixed(2),
              color: theme.mutedTextColor,
              fontSize: 10,
            },
            lineStyle: {
              color: theme.mutedTextColor,
              type: "dashed",
              width: 1,
              opacity: 0.7,
            },
            data: [{ yAxis: baseline }],
          },
          z: 3,
        },
        ...(rangeMarkArea
          ? [
              {
                type: "line" as const,
                name: "区间底色",
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: closes.map(() => null),
                showSymbol: false,
                lineStyle: { width: 0, opacity: 0 },
                markArea: rangeMarkArea,
                z: 1,
                silent: true,
              },
              {
                type: "line" as const,
                name: "区间底色量",
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: volumeData.map(() => null),
                showSymbol: false,
                lineStyle: { width: 0, opacity: 0 },
                markArea: rangeMarkArea,
                z: 1,
                silent: true,
              },
            ]
          : []),
        ...(hasAuction && showAuction
          ? [
              {
                type: "line" as const,
                name: "竞价分隔",
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: closes.map(() => null),
                showSymbol: false,
                lineStyle: { width: 0, opacity: 0 },
                markLine: {
                  silent: true,
                  symbol: "none",
                  label: { show: false },
                  lineStyle: {
                    color: "#4080ff",
                    type: "solid" as const,
                    width: 1,
                    opacity: 0.45,
                  },
                  data: [{ xAxis: times[auctionEndIdx] }],
                },
                z: 2,
              },
            ]
          : []),
        {
          type: "line",
          name: "均价",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: avgs,
          showSymbol: false,
          lineStyle: { width: 1.1, color: "#e6a23c" },
          emphasis: { disabled: true },
          z: 4,
        },
        {
          type: "bar",
          name: "VOLUME",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumeData,
          barMaxWidth: 4,
          markArea: auctionMarkArea,
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1],
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
      ],
    } as EChartsOption;
  }
  function buildCandleOption(
    bars: KlineBar[],
    params?: BuildOptionParams,
  ): EChartsOption {
    const showGaps = params?.showGaps !== false;
    const showFeatures = params?.showFeatures !== false;
    const defaultStart =
      bars.length <= 80
        ? 0
        : Math.max(0, 100 - Math.min(100, (120 / bars.length) * 100));
    const zoomStart =
      typeof params?.zoomStart === "number" ? params.zoomStart : defaultStart;
    const zoomEnd =
      typeof params?.zoomEnd === "number" ? params.zoomEnd : 100;
    const dates = bars.map((bar) => formatDate(bar.timestamp));
    const { maSeries, volMaSeries, macdSeries } = computeSeries(bars, params);

    const maPeriodsForFeatures = (params?.maLines ?? theme.maLines)
      .filter((l) => l.period > 0)
      .slice(0, 10)
      .map((l) => l.period);
    const period = params?.klinePeriod ?? "day";
    // 周/月及以上：涨停/跌停/破板是日线概念，不套到更高周期；壹泽洗等形态仍保留
    const includeDailyLimitHints = period === "day" || period === "intraday";
    const featureOverlay = showFeatures
      ? buildFeatureOverlay(
          bars,
          detectBarFeatures(bars, {
            maPeriods: maPeriodsForFeatures,
            pierceN: 6,
            limitRatio: resolveLimitRatio(params?.stockCode, params?.stockName),
          }),
          { upColor: theme.upColor, downColor: theme.downColor },
          { includeDailyLimitHints },
        )
      : null;

    const candleData = featureOverlay
      ? featureOverlay.candleData
      : bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);

    const volumeData = bars.map((bar) => ({
      value: bar.volume,
      itemStyle: {
        color:
          bar.close >= bar.open ? theme.volumeUpColor : theme.volumeDownColor,
      },
    }));

    const macdBarData = macdSeries.macd.map((v, i) => ({
      value: v,
      itemStyle: {
        color: macdSeries.histColors[i] ?? (v >= 0 ? theme.upColor : "#00c2d4"),
      },
    }));

    // 黄柱：MACD 高于峰连线的差额（透明垫高 + 黄柱堆叠）
    const yellowPad: (number | null)[] = [];
    const yellowH: (number | null)[] = [];
    for (let i = 0; i < macdSeries.yellowTop.length; i += 1) {
      const top = macdSeries.yellowTop[i];
      const bot = macdSeries.yellowBot[i];
      if (top == null || bot == null || top <= bot) {
        yellowPad.push(0);
        yellowH.push(0);
      } else {
        yellowPad.push(bot);
        yellowH.push(top - bot);
      }
    }

    const axisLabelStyle = {
      color: theme.mutedTextColor,
      fontSize: 10,
    };
    const splitLine = {
      show: true,
      lineStyle: {
        color: theme.splitLineColor,
        type: "dashed" as const,
        width: 0.5,
        opacity: 0.28,
      },
    };

    // 远航版：主图 + 量 + MACD（无底部缩略选区）
    const grids = [
      {
        left: 4,
        right: 48,
        top: KLINE_LAYOUT.main.topPx,
        height: `${KLINE_LAYOUT.main.heightPct}%`,
      },
      {
        left: 4,
        right: 48,
        top: `${KLINE_LAYOUT.volume.topPct}%`,
        height: `${KLINE_LAYOUT.volume.heightPct}%`,
      },
      {
        left: 4,
        right: 48,
        top: `${KLINE_LAYOUT.macd.topPct}%`,
        height: `${KLINE_LAYOUT.macd.heightPct}%`,
      },
    ];

    // 用百分比柱宽：缩放时由 ECharts 自动变宽/变窄，避免 JS 每帧 setOption
    const candleWidth: string | number = "68%";
    const volWidth: string | number = "68%";
    const macdWidth: string | number = "55%";

    const lastBar = bars[bars.length - 1];
    const lastClose = lastBar?.close;
    const priceDigits =
      lastClose != null && lastClose >= 10 ? 2 : 3;

    const gapMarkAreaData = showGaps
      ? detectPriceGaps(bars).map(
          (gap) =>
            [
              {
                xAxis: dates[gap.index - 1],
                yAxis: gap.low,
                itemStyle: {
                  // 上/下跳空统一透明灰，避免与涨跌色混淆
                  color: "rgba(120, 120, 120, 0.18)",
                  borderColor: "rgba(120, 120, 120, 0.35)",
                  borderWidth: 0.5,
                },
              },
              { xAxis: dates[gap.index], yAxis: gap.high },
            ] as [
              {
                xAxis: string;
                yAxis: number;
                itemStyle: {
                  color: string;
                  borderColor: string;
                  borderWidth: number;
                };
              },
              { xAxis: string; yAxis: number },
            ],
        )
      : [];

    // 短岛 + 大岛型反转；虚线半透明圆角框 +「大岛型反转：N天」
    const islands = showFeatures ? detectAllIslandReversals(bars) : [];

    const gapMarkArea = gapMarkAreaData.length
      ? { silent: true, z: 0, data: gapMarkAreaData }
      : undefined;

    const candleSeries = {
      type: "candlestick" as const,
      id: "kline-candle",
      name: "K线",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: candleData,
      // 百分比宽度：缩放零成本自适应；barMaxWidth 限制拉得过宽
      barWidth: candleWidth,
      barMinWidth: 1,
      barMaxWidth: 22,
      large: bars.length > 500,
      largeThreshold: 500,
      animation: false,
      itemStyle: {
        color: theme.upColor,
        color0: theme.downColor,
        borderColor: theme.upBorderColor ?? theme.upColor,
        borderColor0: theme.downBorderColor ?? theme.downColor,
        borderWidth: 1,
      },
      markPoint:
        featureOverlay && featureOverlay.markPointData.length
          ? {
              silent: true,
              animation: false,
              label: { show: true },
              data: featureOverlay.markPointData,
            }
          : undefined,
      markLine:
        lastClose != null
          ? {
              silent: true,
              symbol: "none",
              animation: false,
              label: {
                show: true,
                position: "end" as const,
                formatter: () => lastClose.toFixed(priceDigits),
                color: "#fff",
                backgroundColor:
                  lastBar.close >= lastBar.open ? theme.upColor : theme.downColor,
                padding: [2, 4] as [number, number],
                fontSize: 10,
                borderRadius: 2,
              },
              lineStyle: {
                color:
                  lastBar.close >= lastBar.open ? theme.upColor : theme.downColor,
                type: "dashed" as const,
                width: 1,
                opacity: 0.75,
              },
              data: [{ yAxis: lastClose }],
            }
          : undefined,
      ...(gapMarkArea ? { markArea: gapMarkArea } : {}),
    };

    const islandBoxSeries =
      islands.length > 0
        ? {
            type: "custom" as const,
            name: "岛型反转",
            xAxisIndex: 0,
            yAxisIndex: 0,
            silent: true,
            z: 0,
            zlevel: 0,
            // 若不声明 encode，ECharts 会把 start/end 索引也并入 Y 轴，把 K 线压扁
            encode: { x: [0, 1], y: [2, 3] },
            renderItem: (
              params: { dataIndex: number },
              api: {
                value: (dim: number) => number;
                coord: (val: [number, number]) => number[];
                size: (val: [number, number]) => number[];
              },
            ) => {
              const start = api.value(0);
              const end = api.value(1);
              const y0 = api.value(2);
              const y1 = api.value(3);
              const variant = api.value(4); // 0=短岛 1=大岛
              const isle = islands[params.dataIndex];
              const style =
                variant === 1 ? BIG_ISLAND_BOX_STYLE : ISLAND_BOX_STYLE;
              const p0 = api.coord([start, y0]);
              const p1 = api.coord([end, y1]);
              const band = Math.max(2, (api.size([1, 0])[0] as number) || 4);
              const pad = band * 0.35;
              const x = Math.min(p0[0], p1[0]) - pad;
              const y = Math.min(p0[1], p1[1]);
              const width = Math.abs(p1[0] - p0[0]) + pad * 2;
              const height = Math.max(4, Math.abs(p1[1] - p0[1]));
              const r = Math.min(style.radius, width * 0.12, height * 0.18);
              const label = isle ? islandLabel(isle) : "岛型反转";
              return {
                type: "group" as const,
                children: [
                  {
                    type: "rect" as const,
                    shape: { x, y, width, height, r },
                    style: {
                      fill: style.fill,
                      stroke: style.border,
                      lineWidth: style.borderWidth,
                      lineDash: [...style.lineDash],
                    },
                    z2: 0,
                  },
                  {
                    type: "text" as const,
                    style: {
                      x: x + 6,
                      y: y + 5,
                      text: label,
                      fill: style.border,
                      font: "bold 11px sans-serif",
                      textAlign: "left",
                      textVerticalAlign: "top",
                    },
                    z2: 1,
                  },
                ],
              };
            },
            data: islands.map((isle) => [
              isle.startIndex,
              isle.endIndex,
              isle.yLow,
              isle.yHigh,
              isle.variant === "bigIsland" ? 1 : 0,
            ]),
          }
        : null;

    const featurePaintSeries =
      featureOverlay && featureOverlay.paintRects.length
        ? {
            type: "custom" as const,
            name: "特征框",
            xAxisIndex: 0,
            yAxisIndex: 0,
            silent: true,
            z: 5,
            encode: { x: 0, y: [1, 2] },
            renderItem: (
              params: { dataIndex: number },
              api: {
                value: (dim: number) => number;
                coord: (val: [number, number]) => number[];
                size: (val: [number, number]) => number[];
              },
            ) => {
              const rect = featureOverlay.paintRects[params.dataIndex];
              if (!rect) return;
              const xIndex = api.value(0);
              const y0 = api.value(1);
              const y1 = api.value(2);
              const p0 = api.coord([xIndex, y0]);
              const p1 = api.coord([xIndex, y1]);
              const size = api.size([1, 0]);
              const half = Math.max(2.5, (size[0] as number) * 0.35);
              const x = p0[0] - half;
              const y = Math.min(p0[1], p1[1]);
              const h = Math.max(2, Math.abs(p1[1] - p0[1]));
              const hollow =
                !rect.fill ||
                rect.fill === "transparent" ||
                rect.fill === "rgba(0,0,0,0)" ||
                rect.fill === "none";
              return {
                type: "rect" as const,
                shape: { x, y, width: half * 2, height: h },
                style: {
                  fill: hollow ? "none" : rect.fill,
                  stroke: rect.stroke,
                  lineWidth: rect.lineWidth,
                },
              };
            },
            data: featureOverlay.paintRects.map((b) => {
              const idx = dates.indexOf(b.date);
              return idx >= 0 ? [idx, b.y0, b.y1] : null;
            }).filter(Boolean),
          }
        : null;

    const volumePack = detectVolumeFeatures(bars);
    const volumeOverlays = buildVolumeOverlaySeries(bars, volumePack, {
      barWidth: volWidth,
      dates,
    });

    const series = [
      ...(islandBoxSeries ? [islandBoxSeries] : []),
      candleSeries,
      ...(featurePaintSeries ? [featurePaintSeries] : []),
      ...maSeries.map((line) => ({
        type: "line" as const,
        name: line.name ?? `MA${line.period}`,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: line.data,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: maStrokeWidth(line.width), color: line.color },
        emphasis: { disabled: true },
        z: 3,
      })),
      ...volumeOverlays.filter((s) => (s as { name?: string }).name === "量能带下沿" || (s as { name?: string }).name === "量能带"),
      {
        type: "bar" as const,
        id: "kline-volume",
        name: "VOLUME",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeData,
        barWidth: volWidth,
        barMinWidth: 1,
        barMaxWidth: 24,
        z: 1,
        barGap: "-100%",
      },
      ...volumeOverlays.filter((s) => {
        const name = (s as { name?: string }).name;
        return name !== "量能带下沿" && name !== "量能带";
      }),
      ...volMaSeries.map((line) => ({
        type: "line" as const,
        name: line.name ?? `MA${line.period}`,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: line.data,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: {
          width: maStrokeWidth(line.width),
          color: line.color,
          type: line.lineType === "dotted" ? ("dotted" as const) : line.lineType === "dashed" ? ("dashed" as const) : ("solid" as const),
        },
        emphasis: { disabled: true },
        z: 3,
      })),
      {
        type: "bar" as const,
        id: "kline-macd",
        name: "MACD",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdBarData,
        barWidth: macdWidth,
        barMinWidth: 1,
        barMaxWidth: 24,
        barGap: "-100%",
        z: 2,
      },
      {
        type: "bar" as const,
        name: "MACD黄垫",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: yellowPad,
        stack: "macd-yellow",
        barWidth: macdWidth,
        barMinWidth: 1,
        barMaxWidth: 24,
        barGap: "-100%",
        itemStyle: { color: "transparent", borderWidth: 0 },
        silent: true,
        z: 3,
        tooltip: { show: false },
      },
      {
        type: "bar" as const,
        name: "MACD黄柱",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: yellowH,
        stack: "macd-yellow",
        barWidth: macdWidth,
        barMinWidth: 1,
        barMaxWidth: 24,
        barGap: "-100%",
        itemStyle: { color: "#f5d76e" },
        z: 4,
      },
      {
        type: "line",
        name: "峰连",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdSeries.peakLine,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1, color: "#f5d76e", type: "dashed", opacity: 0.85 },
        emphasis: { disabled: true },
        z: 5,
      },
      {
        type: "line",
        name: "DIF",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdSeries.dif,
        showSymbol: false,
        lineStyle: { width: 2, color: theme.macdDifColor },
        emphasis: { disabled: true },
        z: 6,
      },
      {
        type: "line",
        name: "DEA",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdSeries.dea,
        showSymbol: false,
        lineStyle: { width: 1.2, color: theme.macdDeaColor },
        emphasis: { disabled: true },
        z: 6,
      },
    ];

    return {
      animation: false,
      backgroundColor: theme.backgroundColor,
      axisPointer: {
        link: [{ xAxisIndex: [0, 1, 2] }],
        label: {
          backgroundColor: theme.axisPointerBg,
          color: "#fff",
          borderRadius: 2,
          padding: [3, 6],
          fontSize: 11,
        },
        lineStyle: {
          color: "#9aa3af",
          width: 1,
          type: "dashed",
        },
      },
      tooltip: {
        show: true,
        trigger: "axis",
        triggerOn: "mousemove|click",
        // 隐藏浮层，仅保留十字轴与交点圆点（同花顺竖线效果）
        formatter: () => "",
        backgroundColor: "transparent",
        borderWidth: 0,
        padding: 0,
        textStyle: { fontSize: 0, color: "transparent" },
        extraCssText: "width:0;height:0;overflow:hidden;pointer-events:none;",
        axisPointer: {
          type: "line",
          snap: true,
          animation: false,
          lineStyle: {
            color: "#9aa3af",
            width: 1,
            type: "dashed",
          },
          label: { show: false },
          link: [{ xAxisIndex: [0, 1, 2] }],
        },
      },
      grid: grids,
      xAxis: [
        {
          type: "category",
          data: dates,
          gridIndex: 0,
          boundaryGap: true,
          axisLine: { lineStyle: { color: theme.splitLineColor } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          axisPointer: {
            show: true,
            type: "line",
            snap: true,
            label: { show: false },
            lineStyle: {
              color: "#9aa3af",
              width: 1,
              type: "dashed",
            },
          },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 1,
          boundaryGap: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          axisPointer: {
            show: true,
            type: "line",
            snap: true,
            label: { show: false },
            lineStyle: {
              color: "#9aa3af",
              width: 1,
              type: "dashed",
            },
          },
        },
        {
          type: "category",
          data: dates,
          gridIndex: 2,
          boundaryGap: true,
          axisLine: { lineStyle: { color: theme.splitLineColor } },
          axisTick: { show: false },
          // 显示当前视窗日期（随 dataZoom 变化，便于确认拖动生效）
          axisLabel: {
            ...axisLabelStyle,
            showMaxLabel: true,
            showMinLabel: true,
            hideOverlap: true,
          },
          splitLine: { show: false },
          axisPointer: {
            show: true,
            type: "line",
            snap: true,
            label: { show: false },
            lineStyle: {
              color: "#9aa3af",
              width: 1,
              type: "dashed",
            },
          },
        },
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          position: "right",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            ...axisLabelStyle,
            formatter: (v: number) => Number(v).toFixed(priceDigits),
          },
          splitLine,
          splitNumber: 4,
          axisPointer: {
            show: true,
            type: "line",
            label: {
              show: true,
              backgroundColor: theme.axisPointerBg,
              color: "#fff",
              fontSize: 10,
              padding: [2, 4],
              formatter: (params: { value?: unknown }) => {
                const n = Number(params.value);
                return Number.isFinite(n) ? n.toFixed(priceDigits) : "";
              },
            },
            lineStyle: {
              color: "#6b7280",
              width: 1,
              type: "dashed",
            },
          },
        },
        {
          scale: true,
          gridIndex: 1,
          position: "right",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          splitNumber: 2,
          axisPointer: { show: false },
        },
        {
          scale: true,
          gridIndex: 2,
          position: "right",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: {
            show: true,
            lineStyle: {
              color: theme.splitLineColor,
              type: "dashed",
              width: 0.5,
              opacity: 0.25,
            },
          },
          splitNumber: 2,
          axisPointer: { show: false },
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1, 2],
          start: zoomStart,
          end: zoomEnd,
          filterMode: "filter",
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          minValueSpan: Math.min(8, Math.max(3, Math.floor(bars.length * 0.05))),
        },
      ],
      series,
    } as EChartsOption;
  }

  function buildOption(
    bars: KlineBar[],
    params?: BuildOptionParams,
  ): EChartsOption {
    if (!bars.length) {
      return {
        title: {
          text: "暂无数据",
          left: "center",
          top: "middle",
          textStyle: {
            color: theme.mutedTextColor,
            fontSize: 14,
            fontWeight: 400,
          },
        },
      };
    }
    if ((params?.mode ?? "candle") === "intraday") {
      return buildIntradayOption(
        bars,
        params?.prevClose,
        params?.showAuction !== false,
        params?.rangeHighlight,
      );
    }
    return buildCandleOption(bars, params);
  }

  return {
    registerRule,
    unregisterRule,
    setTheme,
    buildOption,
    detectPatterns,
    getQuoteSnapshot,
  };
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(timestamp: number): string {
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}
