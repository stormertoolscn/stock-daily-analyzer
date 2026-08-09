<script setup lang="ts">
/**
 * 龙虎榜席位关系气泡图
 * 样式参考 CB Insights「Y Combinator 投资主题地图」的嵌套气泡打包布局：
 * 中心=股票，外围按 机构 / 游资 / 通道 分组，组内席位气泡大小=金额，红买绿卖。
 */
import { computed, ref } from "vue";

import { formatAmount, type LhbGraphEdge, type LhbGraphNode } from "@/api/lhb";

const props = defineProps<{
  nodes: LhbGraphNode[];
  edges: LhbGraphEdge[];
}>();

const W = 680;
const H = 560;
const CX = W / 2;
const CY = H / 2;
const STOCK_R = 84;

type Kind = "institution" | "hotmoney" | "other";

interface SeatBubble {
  id: string;
  label: string;
  fullLabel: string;
  kind: Kind;
  amount: number;
  buy: number;
  sell: number;
  net: number;
  r: number;
  x: number;
  y: number;
}

interface GroupPack {
  kind: Kind;
  label: string;
  color: string;
  soft: string;
  bubbles: SeatBubble[];
  cx: number;
  cy: number;
  r: number;
  buyTotal: number;
  sellTotal: number;
}

const KIND_META: Record<Kind, { label: string; color: string; soft: string }> = {
  institution: { label: "机构", color: "#8b5cf6", soft: "rgba(139,92,246,0.10)" },
  hotmoney: { label: "游资", color: "#f59e0b", soft: "rgba(245,158,11,0.10)" },
  other: { label: "通道", color: "#64748b", soft: "rgba(100,116,139,0.14)" },
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function shortLabel(text: string, max = 8): string {
  const t = text || "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

const stock = computed(() => props.nodes.find((n) => n.kind === "stock"));

const groups = computed<GroupPack[]>(() => {
  const byId = new Map<string, { buy: number; sell: number }>();
  for (const e of props.edges) {
    const s = byId.get(e.source) ?? { buy: 0, sell: 0 };
    if (e.side === "buy") s.buy += e.amount || 0;
    byId.set(e.source, s);
    const t = byId.get(e.target) ?? { buy: 0, sell: 0 };
    if (e.side === "sell") t.sell += e.amount || 0;
    byId.set(e.target, t);
  }

  const seats: SeatBubble[] = props.nodes
    .filter((n) => n.kind === "seat")
    .map((n) => {
      const m = byId.get(n.id) ?? { buy: 0, sell: 0 };
      return {
        id: n.id,
        label: shortLabel(n.full_label || n.label),
        fullLabel: n.full_label || n.label,
        kind: (n.seat_kind || "hotmoney") as Kind,
        amount: n.amount || Math.max(m.buy, m.sell) || 1,
        buy: m.buy,
        sell: m.sell,
        net: m.buy - m.sell,
        r: 12,
        x: 0,
        y: 0,
      };
    });
  const maxAmt = Math.max(1, ...seats.map((s) => s.amount));
  for (const s of seats) {
    s.r = Math.max(12, Math.round(13 + 18 * Math.sqrt(s.amount / maxAmt)));
  }

  const kinds: Kind[] = ["institution", "hotmoney", "other"];
  const packs: GroupPack[] = [];
  for (const kind of kinds) {
    const list = seats
      .filter((s) => s.kind === kind)
      .sort((a, b) => b.amount - a.amount);
    if (!list.length) continue;
    packs.push({
      kind,
      label: KIND_META[kind].label,
      color: KIND_META[kind].color,
      soft: KIND_META[kind].soft,
      bubbles: list,
      cx: 0,
      cy: 0,
      r: 0,
      buyTotal: list.reduce((sum, b) => sum + b.buy, 0),
      sellTotal: list.reduce((sum, b) => sum + b.sell, 0),
    });
  }

  // 组内席位环形排布，组圆半径由外圈决定
  const CAP = 8;
  for (const g of packs) {
    const n = g.bubbles.length;
    const maxR = Math.max(...g.bubbles.map((b) => b.r), 14);
    const ring1 = Math.max(44, 2.25 * maxR);
    const ring2 = n > CAP ? ring1 + 2.25 * maxR : 0;
    const ringOuter = ring2 || ring1;
    g.r = Math.round(ringOuter + maxR + 20);
    g.bubbles.forEach((b, i) => {
      const ring = i < CAP ? ring1 : ring2;
      const count = i < CAP ? Math.min(CAP, n) : n - CAP;
      const base = i < CAP ? 0 : 0.36;
      const angle = base + (i % CAP) * ((Math.PI * 2) / Math.max(count, 1));
      b.x = Math.cos(angle) * ring;
      b.y = Math.sin(angle) * ring;
    });
  }

  // 组中心围绕股票按角度均匀分布
  const angleStep = (Math.PI * 2) / Math.max(packs.length, 1);
  const startAngle = -Math.PI / 2;
  for (let i = 0; i < packs.length; i++) {
    const g = packs[i];
    const dist = STOCK_R + g.r * 0.52 + 38;
    const a = startAngle + angleStep * i;
    g.cx = CX + Math.cos(a) * dist;
    g.cy = CY + Math.sin(a) * dist;
    for (const b of g.bubbles) {
      b.x += g.cx;
      b.y += g.cy;
    }
  }

  // 组间防重叠：迭代推开
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < packs.length; i++) {
      for (let j = i + 1; j < packs.length; j++) {
        const a = packs[i];
        const b = packs[j];
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r + 8;
        if (d > 0 && d < min) {
          const push = (min - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.cx -= ux * push;
          a.cy -= uy * push;
          b.cx += ux * push;
          b.cy += uy * push;
          for (const bb of a.bubbles) {
            bb.x -= ux * push;
            bb.y -= uy * push;
          }
          for (const bb of b.bubbles) {
            bb.x += ux * push;
            bb.y += uy * push;
          }
        }
      }
    }
  }
  return packs;
});

const bubbleFill = computed(() => {
  const up = cssVar("--color-up", "#ff2438");
  const down = cssVar("--color-down", "#107c10");
  const accent = cssVar("--color-accent", "#3b82f6");
  return (net: number) => (net > 0 ? up : net < 0 ? down : accent);
});

const hasAny = computed(() => props.nodes.length > 0);

/* ============ 方案切换：气泡打包 / 堆叠柱 / 环形占比 ============ */
type GraphMode = "bubble" | "stacked" | "donut";

const MODES: { id: GraphMode; label: string; icon: string }[] = [
  { id: "bubble", label: "气泡打包图", icon: "◉" },
  { id: "stacked", label: "堆叠柱图", icon: "▤" },
  { id: "donut", label: "环形占比图", icon: "◍" },
];
const GRAPH_MODE_KEY = "sda-lhb-graph-mode";

function readSavedMode(): GraphMode {
  try {
    const v = localStorage.getItem(GRAPH_MODE_KEY);
    if (v === "bubble" || v === "stacked" || v === "donut") return v;
  } catch {
    /* ignore */
  }
  return "bubble";
}

const mode = ref<GraphMode>(readSavedMode());

function selectMode(m: GraphMode) {
  mode.value = m;
  try {
    localStorage.setItem(GRAPH_MODE_KEY, m);
  } catch {
    /* ignore */
  }
}

/* ---- 堆叠柱数据：买入 / 卖出各一段，席位按类别着色 ---- */
interface StackSeg {
  label: string;
  fullLabel: string;
  value: number;
  color: string;
}

const stackedBars = computed(() => {
  const buy: StackSeg[] = [];
  const sell: StackSeg[] = [];
  for (const g of groups.value) {
    for (const b of g.bubbles) {
      if (b.buy > 0) {
        buy.push({ label: b.label, fullLabel: b.fullLabel, value: b.buy, color: g.color });
      }
      if (b.sell > 0) {
        sell.push({ label: b.label, fullLabel: b.fullLabel, value: b.sell, color: g.color });
      }
    }
  }
  buy.sort((a, b) => b.value - a.value);
  sell.sort((a, b) => b.value - a.value);
  return { buy, sell };
});

const buyTotal = computed(() => stackedBars.value.buy.reduce((s, x) => s + x.value, 0));
const sellTotal = computed(() => stackedBars.value.sell.reduce((s, x) => s + x.value, 0));

/* ---- 环形数据：按席位类别净买入占比 ---- */
const donutSlices = computed(() =>
  groups.value.map((g) => ({
    kind: g.kind,
    label: g.label,
    color: g.color,
    net: g.buyTotal - g.sellTotal,
  })),
);
const donutTotal = computed(() =>
  donutSlices.value.reduce((s, x) => s + Math.max(x.net, 0), 0),
);

/* ---- 堆叠柱 SVG 布局常量 ---- */
const BAR_W = 96;
const BAR_X_BUY = 195;
const BAR_X_SELL = 430;
const BAR_TOP = 78;
const BAR_BOTTOM = 470;
const BAR_HEIGHT = BAR_BOTTOM - BAR_TOP;

function stackedSegs(kind: "buy" | "sell"): { segs: StackSeg[]; total: number } {
  const segs = kind === "buy" ? stackedBars.value.buy : stackedBars.value.sell;
  const total = kind === "buy" ? buyTotal.value : sellTotal.value;
  return { segs, total };
}

function segRects(kind: "buy" | "sell") {
  const { segs, total } = stackedSegs(kind);
  const x = kind === "buy" ? BAR_X_BUY : BAR_X_SELL;
  let acc = 0;
  return segs.map((s) => {
    const h = total > 0 ? (s.value / total) * BAR_HEIGHT : 0;
    const rect = {
      x,
      y: BAR_BOTTOM - acc - h,
      w: BAR_W,
      h,
      seg: s,
      showText: h >= 22,
      pct: total > 0 ? (s.value / total) * 100 : 0,
    };
    acc += h;
    return rect;
  });
}

/* ---- 环形 SVG 布局常量 ---- */
const DONUT_CX = 310;
const DONUT_CY = 270;
const DONUT_R = 112;
const DONUT_STROKE = 44;
const DONUT_C = 2 * Math.PI * DONUT_R;

const stackedLegend = computed(() => {
  const map = new Map<
    string,
    { label: string; color: string; buy: number; sell: number }
  >();
  for (const b of stackedBars.value.buy) {
    const it = map.get(b.label) ?? { label: b.label, color: b.color, buy: 0, sell: 0 };
    it.buy += b.value;
    map.set(b.label, it);
  }
  for (const s of stackedBars.value.sell) {
    const it = map.get(s.label) ?? { label: s.label, color: s.color, buy: 0, sell: 0 };
    it.sell += s.value;
    map.set(s.label, it);
  }
  return [...map.values()];
});
function donutArcs() {
  const total = donutTotal.value || 1;
  let offset = 0;
  return donutSlices.value
    .filter((s) => s.net > 0)
    .map((s) => {
      const frac = s.net / total;
      const arc = {
        ...s,
        frac,
        dash: `${frac * DONUT_C} ${DONUT_C}`,
        offset: -offset * DONUT_C,
      };
      offset += frac;
      return arc;
    });
}
</script><template>
  <div class="relative h-full min-h-[360px] w-full overflow-hidden rounded-lg border border-border bg-bg">
    <div class="lhb-toolbar">
      <div class="lhb-modes">
        <button
          v-for="m in MODES"
          :key="m.id"
          type="button"
          class="lhb-mode-btn"
          :class="{ 'lhb-mode-active': mode === m.id }"
          :title="m.label"
          @click="selectMode(m.id)"
        >
          {{ m.icon }}
        </button>
      </div>
    </div>
    <svg
      v-if="hasAny && mode === 'bubble'"
      class="lhb-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <!-- 分组圆 -->
      <g v-for="g in groups" :key="g.kind">
        <circle
          :cx="g.cx"
          :cy="g.cy"
          :r="g.r"
          :fill="g.soft"
          :stroke="g.color"
          stroke-width="1.2"
          stroke-dasharray="4 4"
        />
        <text
          :x="g.cx"
          :y="g.cy - g.r - 9"
          text-anchor="middle"
          :fill="g.color"
          font-size="13"
          font-weight="700"
        >
          {{ g.label }} · {{ formatAmount(g.buyTotal - g.sellTotal) }}
        </text>

        <!-- 席位气泡 -->
        <g v-for="b in g.bubbles" :key="b.id" class="lhb-seat">
          <circle
            :cx="b.x"
            :cy="b.y"
            :r="b.r"
            :fill="bubbleFill(b.net)"
            fill-opacity="0.9"
            stroke="var(--color-bg-elevated)"
            stroke-width="2"
          >
            <title>
              {{ b.fullLabel }} · 买 {{ formatAmount(b.buy) }} / 卖 {{ formatAmount(b.sell) }} / 净 {{ formatAmount(b.net) }}
            </title>
          </circle>
          <text
            v-if="b.r >= 22"
            :x="b.x"
            :y="b.y + 3"
            text-anchor="middle"
            font-size="9.5"
            font-weight="650"
            fill="#fff"
          >
            {{ formatAmount(b.net) }}
          </text>
          <text
            :x="b.x"
            :y="b.y + b.r + 11"
            text-anchor="middle"
            font-size="9"
            fill="var(--color-text-muted)"
          >
            {{ b.label }}
          </text>
        </g>
      </g>

      <!-- 股票中心 -->
      <g v-if="stock">
        <circle :cx="CX" :cy="CY" :r="STOCK_R" fill="var(--color-accent)" opacity="0.95" />
        <text
          :x="CX"
          :y="CY - 10"
          text-anchor="middle"
          font-size="15"
          font-weight="750"
          fill="#fff"
        >
          {{ stock.label }}
        </text>
        <text
          :x="CX"
          :y="CY + 12"
          text-anchor="middle"
          font-size="11"
          fill="rgba(255,255,255,0.88)"
        >
          {{ stock.code }}
        </text>
        <text
          :x="CX"
          :y="CY + 28"
          text-anchor="middle"
          font-size="9.5"
          fill="rgba(255,255,255,0.75)"
        >
          席位关系
        </text>
      </g>

      <!-- 图例 -->
      <g transform="translate(14, 16)">
        <rect width="132" height="66" rx="10" fill="var(--color-bg-elevated)" stroke="var(--color-border)" stroke-width="1" />
        <circle cx="24" cy="24" r="9" fill="var(--color-up)" />
        <text x="40" y="28" font-size="11" fill="var(--color-text-muted)">买入</text>
        <circle cx="24" cy="48" r="9" fill="var(--color-down)" />
        <text x="40" y="52" font-size="11" fill="var(--color-text-muted)">卖出</text>
      </g>
      <g transform="translate(14, 96)">
        <text x="0" y="10" font-size="10" fill="var(--color-text-muted)">气泡大小 = 席位金额</text>
      </g>
    </svg>
    <svg
      v-else-if="hasAny && mode === 'stacked'"
      class="lhb-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <g v-for="p in [0, 25, 50, 75, 100]" :key="p">
        <line
          :x1="80"
          :x2="556"
          :y1="BAR_BOTTOM - (p / 100) * BAR_HEIGHT"
          :y2="BAR_BOTTOM - (p / 100) * BAR_HEIGHT"
          stroke="var(--color-border)"
          stroke-width="1"
          stroke-dasharray="3 4"
        />
        <text
          :x="72"
          :y="BAR_BOTTOM - (p / 100) * BAR_HEIGHT + 3"
          text-anchor="end"
          font-size="9"
          fill="var(--color-text-muted)"
        >
          {{ p }}%
        </text>
      </g>

      <text
        :x="BAR_X_BUY + BAR_W / 2"
        :y="BAR_TOP - 16"
        text-anchor="middle"
        font-size="12"
        font-weight="700"
        fill="var(--color-text)"
      >
        买入 · {{ formatAmount(buyTotal) }}
      </text>
      <rect
        v-for="(r, i) in segRects('buy')"
        :key="'b' + i"
        :x="r.x"
        :y="r.y"
        :width="r.w"
        :height="Math.max(r.h, 0)"
        :fill="r.seg.color"
        fill-opacity="0.9"
      >
        <title>{{ r.seg.fullLabel }} · {{ formatAmount(r.seg.value) }}（{{ r.pct.toFixed(1) }}%）</title>
      </rect>
      <g v-for="(r, i) in segRects('buy')" :key="'bt' + i">
        <text
          v-if="r.showText"
          :x="r.x + r.w / 2"
          :y="r.y + 14"
          text-anchor="middle"
          font-size="9.5"
          font-weight="650"
          fill="#fff"
        >
          {{ formatAmount(r.seg.value) }}
        </text>
      </g>

      <text
        :x="BAR_X_SELL + BAR_W / 2"
        :y="BAR_TOP - 16"
        text-anchor="middle"
        font-size="12"
        font-weight="700"
        fill="var(--color-text)"
      >
        卖出 · {{ formatAmount(sellTotal) }}
      </text>
      <rect
        v-for="(r, i) in segRects('sell')"
        :key="'s' + i"
        :x="r.x"
        :y="r.y"
        :width="r.w"
        :height="Math.max(r.h, 0)"
        :fill="r.seg.color"
        fill-opacity="0.9"
      >
        <title>{{ r.seg.fullLabel }} · {{ formatAmount(r.seg.value) }}（{{ r.pct.toFixed(1) }}%）</title>
      </rect>
      <g v-for="(r, i) in segRects('sell')" :key="'st' + i">
        <text
          v-if="r.showText"
          :x="r.x + r.w / 2"
          :y="r.y + 14"
          text-anchor="middle"
          font-size="9.5"
          font-weight="650"
          fill="#fff"
        >
          {{ formatAmount(r.seg.value) }}
        </text>
      </g>

      <g transform="translate(560, 64)">
        <text x="0" y="10" font-size="11" font-weight="700" fill="var(--color-text)">席位</text>
        <g
          v-for="(s, i) in stackedLegend"
          :key="s.label"
          :transform="`translate(0, ${24 + i * 30})`"
        >
          <rect width="11" height="11" rx="2" :fill="s.color" />
          <text x="17" y="9" font-size="10" font-weight="600" fill="var(--color-text)">
            {{ s.label }}
          </text>
          <text x="17" y="22" font-size="9" fill="var(--color-text-muted)">
            买 {{ formatAmount(s.buy) }} · 卖 {{ formatAmount(s.sell) }}
          </text>
        </g>
      </g>
    </svg>

    <svg
      v-else-if="hasAny && mode === 'donut'"
      class="lhb-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <circle
        :cx="DONUT_CX"
        :cy="DONUT_CY"
        :r="DONUT_R"
        fill="none"
        stroke="var(--color-border)"
        :stroke-width="DONUT_STROKE"
        opacity="0.45"
      />
      <circle
        v-for="a in donutArcs()"
        :key="a.kind"
        :cx="DONUT_CX"
        :cy="DONUT_CY"
        :r="DONUT_R"
        fill="none"
        :stroke="a.color"
        :stroke-width="DONUT_STROKE"
        :stroke-dasharray="a.dash"
        :stroke-dashoffset="a.offset"
        transform="rotate(-90 310 270)"
      >
        <title>{{ a.label }} 净买 {{ formatAmount(a.net) }} · {{ (a.frac * 100).toFixed(1) }}%</title>
      </circle>
      <text
        :x="DONUT_CX"
        :y="DONUT_CY - 16"
        text-anchor="middle"
        font-size="15"
        font-weight="750"
        fill="var(--color-text)"
      >
        {{ stock?.label }}
      </text>
      <text
        :x="DONUT_CX"
        :y="DONUT_CY + 6"
        text-anchor="middle"
        font-size="11"
        fill="var(--color-text-muted)"
      >
        {{ stock?.code }}
      </text>
      <text
        :x="DONUT_CX"
        :y="DONUT_CY + 28"
        text-anchor="middle"
        font-size="10"
        font-weight="650"
        fill="var(--color-accent)"
      >
        净买 {{ formatAmount(donutTotal) }}
      </text>
      <g transform="translate(500, 118)">
        <text x="0" y="8" font-size="11" font-weight="700" fill="var(--color-text)">净买入占比</text>
        <g
          v-for="(s, i) in donutSlices"
          :key="s.kind"
          :transform="`translate(0, ${26 + i * 46})`"
        >
          <circle cx="6" cy="0" r="6" :fill="s.color" />
          <text x="18" y="4" font-size="11" font-weight="600" fill="var(--color-text)">
            {{ s.label }}
          </text>
          <text x="18" y="19" font-size="10" fill="var(--color-text-muted)">
            {{ formatAmount(s.net) }}
          </text>
          <text
            x="120"
            y="4"
            font-size="11"
            font-weight="700"
            :fill="s.net >= 0 ? 'var(--color-up)' : 'var(--color-down)'"
          >
            {{ donutTotal > 0 && s.net > 0 ? ((s.net / donutTotal) * 100).toFixed(1) + '%' : '—' }}
          </text>
        </g>
      </g>
    </svg>
    <div
      v-else
      class="absolute inset-0 flex items-center justify-center text-sm text-text-muted"
    >
      暂无席位关系数据
    </div>
  </div>
</template>

<style scoped>
.lhb-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.lhb-toolbar {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
}

.lhb-modes {
  display: flex;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-bg-elevated) 92%, transparent);
  box-shadow: 0 2px 8px rgb(15 23 42 / 10%);
}

.lhb-mode-btn {
  appearance: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 15px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}

.lhb-mode-btn:hover {
  color: var(--color-text);
  border-color: var(--color-border);
}

.lhb-mode-active {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}
.lhb-seat {
  cursor: default;
  transition: opacity 0.15s ease;
}

.lhb-seat:hover circle {
  stroke: var(--color-text);
  stroke-width: 2.5;
  fill-opacity: 1;
}
</style>