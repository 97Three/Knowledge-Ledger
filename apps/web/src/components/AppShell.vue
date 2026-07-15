<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Activity,
  BadgeCheck,
  BookOpenText,
  Bot,
  ChevronRight,
  CircleHelp,
  FilePlus2,
  Gauge,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  X,
} from "lucide-vue-next";
import { getOverview } from "@/api/client";
import { BRAND } from "@/brand";
import { useOnboardingStore } from "@/stores/onboarding";

const route = useRoute();
const router = useRouter();
const onboarding = useOnboardingStore();

const NAVIGATION: { label: string; items: { icon: Component; label: string; to: string }[] }[] = [
  {
    label: "知识运营",
    items: [
      { icon: Gauge, label: "工作台", to: "/" },
      { icon: BookOpenText, label: "知识库", to: "/knowledge" },
      { icon: FilePlus2, label: "贡献知识", to: "/contribute" },
    ],
  },
  {
    label: "治理流水线",
    items: [
      { icon: BadgeCheck, label: "审核中心", to: "/review" },
      { icon: ShieldCheck, label: "发布决策", to: "/governance" },
      { icon: Activity, label: "使用证据", to: "/evaluation" },
    ],
  },
  {
    label: "平台",
    items: [
      { icon: Bot, label: "Agent 接入", to: "/agents" },
      { icon: Settings, label: "设置", to: "/settings" },
    ],
  },
];

const search = ref("");
const searchInput = ref<HTMLInputElement>();
const mobileOpen = ref(false);
const pendingReview = ref(0);

const currentLabel = computed(() => {
  const all = NAVIGATION.flatMap((group) => group.items);
  const hit = all.find((item) =>
    item.to === "/" ? route.path === "/" : route.path.startsWith(item.to),
  );
  return hit?.label ?? "工作台";
});

async function loadBadge(): Promise<void> {
  try {
    const overview = await getOverview();
    pendingReview.value = overview.totals.pendingReview;
  } catch {
    pendingReview.value = 0;
  }
}

function submitSearch(): void {
  const value = search.value.trim();
  if (value.length === 0) return;
  void router.push({ path: "/knowledge", query: { q: value } });
  mobileOpen.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.value?.focus();
  }
  if (event.key === "Escape" && mobileOpen.value) mobileOpen.value = false;
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void loadBadge();
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="shell">
    <button
      v-if="mobileOpen"
      class="side-backdrop is-open"
      aria-label="关闭导航"
      @click="mobileOpen = false"
    />

    <aside class="side" :class="{ 'is-open': mobileOpen }" id="primary-sidebar">
      <div class="brand-row">
        <svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect x="12.6" y="4.4" width="6.8" height="4.6" rx="1.1" fill="#d9683f" />
          <rect x="8.4" y="11.4" width="15.2" height="4.8" rx="1.2" fill="#e9dfce" />
          <rect x="4.6" y="18.8" width="22.8" height="5.2" rx="1.4" fill="#c9bda6" />
          <rect x="1.8" y="26.4" width="28.4" height="3.4" rx="1.2" fill="#8b8272" />
        </svg>
        <div class="brand-copy">
          <b>{{ BRAND.nameZh }} {{ BRAND.name }}</b>
          <span>KNOWLEDGE LEDGER</span>
        </div>
      </div>

      <div class="workspace">
        <span class="workspace-avatar">AC</span>
        <div class="workspace-copy">
          <b>{{ BRAND.workspace.name }}</b>
          <small>space / {{ BRAND.workspace.slug }}</small>
        </div>
        <span class="workspace-env">{{ BRAND.workspace.environment }}</span>
      </div>

      <nav class="nav" aria-label="主要导航">
        <div v-for="group in NAVIGATION" :key="group.label" class="nav-group">
          <p class="nav-label">{{ group.label }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.to"
            class="nav-item"
            :class="{
              'nav-item-active':
                item.to === '/' ? route.path === '/' : route.path.startsWith(item.to),
            }"
            :to="item.to"
            @click="mobileOpen = false"
          >
            <component :is="item.icon" :size="16" aria-hidden="true" />
            <span>{{ item.label }}</span>
            <span v-if="item.to === '/review' && pendingReview > 0" class="nav-badge">
              {{ pendingReview }}
            </span>
          </RouterLink>
        </div>
      </nav>

      <div class="side-foot">
        <button class="nav-toggle" @click="onboarding.open()">
          <span style="display: inline-flex; align-items: center; gap: 8px">
            <CircleHelp :size="15" /> 新手任务
          </span>
          <span class="mono" style="color: #8b8272">
            {{ onboarding.completed.length }}/{{ onboarding.totalSteps }}
          </span>
        </button>
        <div class="nav-progress" aria-hidden="true">
          <i :style="{ width: `${onboarding.progress}%` }" />
        </div>
        <div class="identity">
          <span class="identity-avatar">MO</span>
          <div>
            <b>开发多角色演示</b>
            <small>非真实登录身份</small>
          </div>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button class="icon-button menu-button" aria-label="打开导航" @click="mobileOpen = true">
          <Menu :size="18" />
        </button>
        <div class="crumb">
          {{ BRAND.workspace.name }}
          <span class="crumb-sep">/</span>
          <b>{{ currentLabel }}</b>
        </div>
        <form class="global-search" @submit.prevent="submitSearch">
          <Search :size="14" aria-hidden="true" />
          <input
            ref="searchInput"
            v-model="search"
            aria-label="全局搜索知识"
            placeholder="搜索知识、引用或修订号…"
          />
          <kbd>⌘K</kbd>
        </form>
        <div class="topbar-right">
          <span class="status-pill"><i />{{ BRAND.protocol.name }} · READY</span>
          <button class="icon-button" aria-label="打开新手引导" @click="onboarding.open()">
            <CircleHelp :size="17" />
          </button>
        </div>
      </header>

      <main class="page">
        <RouterView />
      </main>
    </div>
  </div>
</template>
