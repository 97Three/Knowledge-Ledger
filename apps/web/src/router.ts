import { createRouter, createWebHistory } from "vue-router";
import { BRAND } from "@/brand";

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: "/",
      name: "overview",
      component: () => import("@/views/OverviewView.vue"),
      meta: { title: "工作台" },
    },
    {
      path: "/knowledge",
      name: "knowledge",
      component: () => import("@/views/KnowledgeView.vue"),
      meta: { title: "知识库" },
    },
    {
      path: "/contribute",
      name: "contribute",
      component: () => import("@/views/ContributeView.vue"),
      meta: { title: "贡献知识" },
    },
    {
      path: "/review",
      name: "review",
      component: () => import("@/views/ReviewView.vue"),
      meta: { title: "审核中心" },
    },
    {
      path: "/governance",
      name: "governance",
      component: () => import("@/views/GovernanceView.vue"),
      meta: { title: "发布决策" },
    },
    {
      path: "/evaluation",
      name: "evaluation",
      component: () => import("@/views/EvaluationView.vue"),
      meta: { title: "使用证据" },
    },
    {
      path: "/agents",
      name: "agents",
      component: () => import("@/views/AgentsView.vue"),
      meta: { title: "Agent 接入" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/SettingsView.vue"),
      meta: { title: "设置" },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.afterEach((to) => {
  const title = typeof to.meta.title === "string" ? to.meta.title : "工作台";
  document.title = `${title} · ${BRAND.nameZh} ${BRAND.name}`;
});
