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
          path: "kline",
          name: "kline",
          component: () => import("@/views/Kline.vue"),
        },
      ],
    },
  ],
});

export default router;
