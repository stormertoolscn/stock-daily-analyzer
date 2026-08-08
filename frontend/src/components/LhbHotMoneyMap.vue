<script setup lang="ts">
/**
 * 游资图谱（研究用）
 * 像素级参考：https://vis-free.10jqka.com.cn/billboard/indexV3.html#/mapview
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { HOT_MONEY_LIST, type HotMoneyItem } from "@/data/hotMoneyMap";

const props = defineProps<{
  /** 当日相关营业部名称（用于标注「当日操作」） */
  activeSeats?: string[];
}>();

const router = useRouter();
const selectedId = ref(HOT_MONEY_LIST[0]?.id ?? "");
const leftColRef = ref<HTMLElement | null>(null);
const rightColRef = ref<HTMLElement | null>(null);
const mapBodyRef = ref<HTMLElement | null>(null);
const linePath = ref("");

const selected = computed(
  () => HOT_MONEY_LIST.find((h) => h.id === selectedId.value) ?? HOT_MONEY_LIST[0],
);

const activeSeatSet = computed(() => {
  const set = new Set<string>();
  for (const s of props.activeSeats ?? []) {
    const t = (s || "").trim();
    if (t) set.add(t);
  }
  return set;
});

function isTodaySeat(item: HotMoneyItem): boolean {
  if (!activeSeatSet.value.size) return false;
  for (const seat of activeSeatSet.value) {
    if (seat.includes(item.seat.slice(0, 6)) || item.seat.includes(seat.slice(0, 6))) {
      return true;
    }
    if (seat.includes(item.name)) return true;
  }
  return false;
}

function selectItem(item: HotMoneyItem) {
  selectedId.value = item.id;
  void nextTick(() => {
    updateLine();
    scrollDetailIntoView(item.id);
  });
}

function openTracker(item: HotMoneyItem) {
  void router.push({
    path: "/lhb-v3",
    query: { tab: "hotmoney", hm: item.id },
  });
}

function scrollDetailIntoView(id: string) {
  const el = document.getElementById(`v3-hm-detail-${id}`);
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function updateLine() {
  const body = mapBodyRef.value;
  const left = leftColRef.value?.querySelector<HTMLElement>(".v3-hm-item.active");
  const right = rightColRef.value?.querySelector<HTMLElement>(".v3-hm-item.active");
  if (!body || !left || !right) {
    linePath.value = "";
    return;
  }
  const br = body.getBoundingClientRect();
  const lr = left.getBoundingClientRect();
  const rr = right.getBoundingClientRect();
  const x1 = lr.right - br.left;
  const y1 = lr.top + lr.height / 2 - br.top;
  const x2 = rr.left - br.left;
  const y2 = rr.top + rr.height / 2 - br.top;
  const mx = (x1 + x2) / 2;
  linePath.value = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function onResize() {
  updateLine();
}

watch(selectedId, () => nextTick(updateLine));
watch(
  () => props.activeSeats,
  () => nextTick(updateLine),
  { deep: true },
);

onMounted(() => {
  nextTick(updateLine);
  window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
});
</script>

<template>
  <div class="v3-hm">
    <section class="v3-hm-map">
      <header class="v3-hm-title">
        <span>游资图谱</span>
        <button
          v-if="selected"
          type="button"
          class="v3-hm-jump"
          @click="openTracker(selected)"
        >
          查看「{{ selected.name }}」交易 →
        </button>
      </header>
      <div ref="mapBodyRef" class="v3-hm-body">
        <svg class="v3-hm-svg" aria-hidden="true">
          <path
            v-if="linePath"
            :d="linePath"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            stroke-dasharray="4 3"
            class="v3-hm-link"
          />
        </svg>

        <div class="v3-hm-col">
          <div class="v3-hm-col-head">游资</div>
          <div ref="leftColRef" class="v3-hm-list">
            <button
              v-for="item in HOT_MONEY_LIST"
              :key="item.id"
              type="button"
              class="v3-hm-item left"
              :class="{ active: selectedId === item.id, today: isTodaySeat(item) }"
              @click="selectItem(item)"
            >
              <span class="radio" aria-hidden="true" />
              <span class="label">{{ item.name }}</span>
            </button>
          </div>
        </div>

        <div class="v3-hm-col">
          <div class="v3-hm-col-head">营业部</div>
          <div ref="rightColRef" class="v3-hm-list">
            <button
              v-for="item in HOT_MONEY_LIST"
              :key="'seat-' + item.id"
              type="button"
              class="v3-hm-item right"
              :class="{ active: selectedId === item.id, today: isTodaySeat(item) }"
              :title="item.seat"
              @click="selectItem(item)"
            >
              <span class="label">{{ item.seat }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="v3-hm-detail">
      <header class="v3-hm-title">
        <span class="bar" aria-hidden="true" />
        游资详情
      </header>
      <ul class="v3-hm-detail-list">
        <li
          v-for="item in HOT_MONEY_LIST"
          :id="'v3-hm-detail-' + item.id"
          :key="'d-' + item.id"
          class="v3-hm-detail-row"
          :class="{ active: selectedId === item.id }"
          @click="selectItem(item)"
        >
          <div class="left">
            <button type="button" class="name">{{ item.name }}</button>
            <span class="intro">简介：{{ item.intro || "—" }}</span>
          </div>
          <div class="right">
            当日操作营业部：
            <em>{{ item.seat }}</em>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.v3-hm {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--v3-bg);
  color: var(--v3-text);
}

.v3-hm-map {
  flex: 1 1 58%;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--v3-border);
  overflow: hidden;
}

.v3-hm-detail {
  flex: 1 1 42%;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.v3-hm-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--v3-border);
  background: var(--v3-panel);
  flex-shrink: 0;
}

.v3-hm-jump {
  appearance: none;
  border: 1px solid var(--v3-border);
  background: transparent;
  color: var(--v3-link);
  border-radius: 2px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.v3-hm-jump:hover {
  border-color: var(--v3-link);
}

.v3-hm-title .bar {
  width: 3px;
  height: 12px;
  background: var(--v3-accent);
  border-radius: 1px;
}

.v3-hm-body {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.v3-hm-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  color: var(--v3-link);
}

.v3-hm-link {
  opacity: 0.85;
}

.v3-hm-col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px dashed var(--v3-border);
  z-index: 2;
}

.v3-hm-col:last-child {
  border-right: 0;
}

.v3-hm-col-head {
  padding: 8px 16px;
  color: var(--v3-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--v3-border);
  background: var(--v3-panel);
  flex-shrink: 0;
}

.v3-hm-list {
  overflow: auto;
  padding: 6px 0;
  flex: 1;
}

.v3-hm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--v3-text);
  padding: 8px 16px;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}

.v3-hm-item:hover {
  background: var(--v3-row-hover);
}

.v3-hm-item.active {
  background: var(--v3-row-active);
}

.v3-hm-item.active .label {
  color: var(--v3-link);
  font-weight: 600;
}

.v3-hm-item.today .label::after {
  content: "当日";
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--v3-accent);
  border: 1px solid color-mix(in srgb, var(--v3-accent) 45%, transparent);
  border-radius: 2px;
  padding: 0 3px;
}

.v3-hm-item .radio {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--v3-muted);
  flex-shrink: 0;
  background: transparent;
}

.v3-hm-item.active .radio {
  border-color: var(--v3-link);
  box-shadow: inset 0 0 0 3px var(--v3-link);
}

.v3-hm-item .label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v3-hm-item.right {
  justify-content: flex-start;
  padding-left: 24px;
}

.v3-hm-detail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
}

.v3-hm-detail-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--v3-border);
  cursor: pointer;
}

.v3-hm-detail-row:hover {
  background: var(--v3-row-hover);
}

.v3-hm-detail-row.active {
  background: var(--v3-row-active);
}

.v3-hm-detail-row .name {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--v3-link);
  font-size: 12px;
  font-weight: 600;
  padding: 0;
  cursor: pointer;
  margin-right: 8px;
}

.v3-hm-detail-row .intro {
  color: var(--v3-muted);
}

.v3-hm-detail-row .right {
  color: var(--v3-muted);
  text-align: right;
}

.v3-hm-detail-row .right em {
  font-style: normal;
  color: var(--v3-link);
}

@media (max-width: 900px) {
  .v3-hm-detail-row {
    grid-template-columns: 1fr;
  }
  .v3-hm-detail-row .right {
    text-align: left;
  }
}
</style>
