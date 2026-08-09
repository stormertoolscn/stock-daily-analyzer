<script setup lang="ts">
/**
 * 龙虎榜席位关系气泡图
 * 样式参考 CB Insights「Y Combinator 投资主题地图」的嵌套气泡打包布局：
 * 中心=股票，外围按 机构 / 游资 / 通道 分组，组内席位气泡大小=金额，红买绿卖。
 */
import { computed } from "vue";

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
</script><template>
  <div class="relative h-full min-h-[360px] w-full overflow-hidden rounded-lg border border-border bg-bg">
    <svg
      v-if="hasAny"
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