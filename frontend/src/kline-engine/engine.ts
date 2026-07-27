import type { EChartsOption } from "echarts";

import {
  detectBarFeatures,
  resolveLimitRatio,
  buildFeatureOverlay,
  FEATURE_COLORS,
} from "./features";
import { detectPriceGaps } from "./gaps";
import { formatVolume, macd, sma } from "./indicators";
import { getAShareTheme } from "./theme";
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
    const macdSeries = macd(closes);
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
      tooltip: { show: false },
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
    const featureOverlay = showFeatures
      ? buildFeatureOverlay(
          bars,
          detectBarFeatures(bars, {
            maPeriods: maPeriodsForFeatures,
            pierceN: 6,
            limitRatio: resolveLimitRatio(params?.stockCode, params?.stockName),
          }),
          { upColor: theme.upColor, downColor: theme.downColor },
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

    const macdBarData = macdSeries.macd.map((v) => ({
      value: v,
      itemStyle: {
        color: v >= 0 ? theme.upColor : theme.downColor,
      },
    }));

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

    const candleWidth =
      bars.length <= 24 ? 14 : bars.length <= 60 ? 9 : bars.length <= 120 ? 7 : 5;
    const volWidth = Math.max(3, candleWidth - 1);
    const macdWidth = Math.max(2, Math.floor(candleWidth * 0.55));

    const lastBar = bars[bars.length - 1];
    const lastClose = lastBar?.close;
    const priceDigits =
      lastClose != null && lastClose >= 10 ? 2 : 3;

    const gapMarkArea = showGaps
      ? {
          silent: true,
          data: detectPriceGaps(bars).map(
            (gap) =>
              [
                {
                  xAxis: dates[gap.index - 1],
                  yAxis: gap.low,
                  itemStyle: {
                    color:
                      gap.direction === "up"
                        ? "rgba(245, 34, 45, 0.16)"
                        : "rgba(64, 128, 255, 0.16)",
                    borderColor:
                      gap.direction === "up"
                        ? "rgba(245, 34, 45, 0.35)"
                        : "rgba(64, 128, 255, 0.35)",
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
          ),
        }
      : undefined;

    const candleSeries = {
      type: "candlestick" as const,
      name: "K线",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: candleData,
      barMaxWidth: candleWidth,
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

    const featurePaintSeries =
      featureOverlay && featureOverlay.paintRects.length
        ? {
            type: "custom" as const,
            name: "特征框",
            xAxisIndex: 0,
            yAxisIndex: 0,
            silent: true,
            z: 5,
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
              const half = Math.max(2.5, (size[0] as number) * 0.38);
              const x = p0[0] - half;
              const y = Math.min(p0[1], p1[1]);
              const h = Math.max(2, Math.abs(p1[1] - p0[1]));
              return {
                type: "rect" as const,
                shape: { x, y, width: half * 2, height: h },
                style: {
                  fill: rect.fill,
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

    const series = [
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
      {
        type: "bar" as const,
        name: "VOLUME",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeData,
        barMaxWidth: volWidth,
        z: 1,
      },
      ...volMaSeries.map((line) => ({
        type: "line" as const,
        name: line.name ?? `MA${line.period}`,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: line.data,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: maStrokeWidth(line.width), color: line.color },
        emphasis: { disabled: true },
        z: 3,
      })),
      {
        type: "bar" as const,
        name: "MACD",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdBarData,
        barMaxWidth: macdWidth,
        barGap: "10%",
      },
      {
        type: "line",
        name: "DIF",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdSeries.dif,
        showSymbol: false,
        lineStyle: { width: 1.1, color: theme.macdDifColor },
        emphasis: { disabled: true },
      },
      {
        type: "line",
        name: "DEA",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdSeries.dea,
        showSymbol: false,
        lineStyle: { width: 1.1, color: theme.macdDeaColor },
        emphasis: { disabled: true },
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
      tooltip: { show: false },
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
