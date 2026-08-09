import { createRouter, createWebHistory } from "vue-router";

import MainLayout from "@/components/MainLayout.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: MainLayout,
      children: [
        {
          path: "",
          name: "home",
          component: () => import("@/views/Home.vue"),
        },
        {
          path: "lhb",
          name: "lhb",
          component: () => import("@/views/Lhb.vue"),
        },
        {
          path: "lhb-v3",
          name: "lhb-v3",
          component: () => import("@/views/LhbV3.vue"),
        },
        {
          path: "kline",
          name: "kline",
          component: () => import("@/views/Kline.vue"),
        },
        {
          path: "capital-flow",
          name: "capital-flow",
          component: () => import("@/views/CapitalFlow.vue"),
        },
        {
          path: "quant",
          name: "quant",
          component: () => import("@/views/Quant.vue"),
        },
        {
          path: "research",
          name: "research",
          component: () => import("@/views/Research.vue"),
        },
        {
          path: "backtest",
          name: "backtest",
          component: () => import("@/views/Backtest.vue"),
        },
      ],
    },
  ],
});
export default router;
