<script setup lang="ts">
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { LhbGraphEdge, LhbGraphNode } from "@/api/lhb";

const props = defineProps<{
  nodes: LhbGraphNode[];
  edges: LhbGraphEdge[];
}>();

const containerRef = ref<HTMLElement | null>(null);
let cy: Core | null = null;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function seatColor(kind: string | null | undefined): string {
  if (kind === "institution") return "#8b5cf6";
  if (kind === "other") return "#64748b";
  return "#f59e0b";
}

function toElements(nodes: LhbGraphNode[], edges: LhbGraphEdge[]): ElementDefinition[] {
  const maxEdge = Math.max(1, ...edges.map((e) => e.amount || 0));
  const maxSeat = Math.max(1, ...nodes.filter((n) => n.kind === "seat").map((n) => n.amount || 0));
  const els: ElementDefinition[] = nodes.map((n) => {
    const size =
      n.kind === "stock" ? 56 : Math.round(28 + (18 * (n.amount || 0)) / maxSeat);
    return {
      data: {
        id: n.id,
        label: n.label,
        kind: n.kind,
        seatKind: n.seat_kind || "hotmoney",
        fullLabel: n.full_label || n.label,
        amount: n.amount,
        size,
        color:
          n.kind === "stock"
            ? cssVar("--color-accent", "#3b82f6")
            : seatColor(n.seat_kind),
      },
    };
  });

  for (const e of edges) {
    const weight = 2 + (8 * (e.amount || 0)) / maxEdge;
    els.push({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        side: e.side,
        label: e.label,
        weight,
      },
    });
  }
  return els;
}

function render() {
  if (!containerRef.value) return;

  const up = cssVar("--color-up", "#f5222d");
  const down = cssVar("--color-down", "#16a34a");
  const text = cssVar("--color-text", "#1f2329");
  const muted = cssVar("--color-text-muted", "#6b7280");
  const border = cssVar("--color-border", "#e2e5ea");
  const accent = cssVar("--color-accent", "#3b82f6");

  const elements = toElements(props.nodes, props.edges);

  if (cy) {
    cy.destroy();
    cy = null;
  }

  cy = cytoscape({
    container: containerRef.value,
    elements,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          color: text,
          "font-size": 11,
          "text-wrap": "wrap",
          "text-max-width": 72,
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 6,
          "background-color": "data(color)",
          "border-width": 2,
          "border-color": "data(color)",
          width: "data(size)",
          height: "data(size)",
          opacity: 0.92,
        },
      },
      {
        selector: 'node[kind = "stock"]',
        style: {
          color: text,
          "font-size": 13,
          "font-weight": 600,
          "text-margin-y": 8,
          "background-color": accent,
          "border-color": accent,
        },
      },
      {
        selector: 'node[kind = "seat"]',
        style: {
          "border-color": border,
        },
      },
      {
        selector: "edge",
        style: {
          width: "data(weight)",
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.9,
          label: "data(label)",
          "font-size": 9,
          color: muted,
          "text-rotation": "autorotate",
          "text-margin-y": -8,
          opacity: 0.85,
        },
      },
      {
        selector: 'edge[side = "buy"]',
        style: {
          "line-color": up,
          "target-arrow-color": up,
        },
      },
      {
        selector: 'edge[side = "sell"]',
        style: {
          "line-color": down,
          "target-arrow-color": down,
        },
      },
    ],
    layout: {
      name: "concentric",
      concentric(node: { data: (key: string) => unknown }) {
        return node.data("kind") === "stock" ? 10 : 1;
      },
      levelWidth() {
        return 1;
      },
      minNodeSpacing: 48,
      padding: 24,
      animate: false,
    },
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
  });

  cy.fit(undefined, 28);
}

onMounted(() => {
  render();
  window.addEventListener("resize", render);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", render);
  if (cy) {
    cy.destroy();
    cy = null;
  }
});

watch(
  () => [props.nodes, props.edges] as const,
  () => render(),
  { deep: true },
);
</script>

<template>
  <div class="relative h-full min-h-[360px] w-full overflow-hidden rounded-lg border border-border bg-bg">
    <div ref="containerRef" class="h-full w-full" />
    <div
      v-if="!nodes.length"
      class="absolute inset-0 flex items-center justify-center text-sm text-text-muted"
    >
      暂无席位关系数据
    </div>
  </div>
</template>
