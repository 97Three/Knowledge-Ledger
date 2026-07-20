<script setup lang="ts">
import { computed } from "vue";
import { Plus, Search } from "lucide-vue-next";
import { getOverview } from "@/api/client";
import type { Overview } from "@/api/types";
import { BRAND } from "@/brand";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { formatRelativeTime } from "@/utils/format";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import StatusBadge from "@/components/StatusBadge.vue";

const { data, error, loading, refresh } = useAsyncResource<Overview>(getOverview);

const overview = computed(() => data.value);
const totals = computed(() => overview.value?.totals);
const workflow = computed(() => overview.value?.workflow);

const today = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());

/** 首页的一句话判断：优先说“现在该干什么”，而不是报数字。 */
const headline = computed(() => {
  const value = overview.value;
  if (value === undefined) return "正在读取知识账本";
  if (value.totals.pendingReview > 0) return `${value.totals.pendingReview} 条候选等待审核`;
  if (value.totals.knowledge === 0) return "还没有第一条受治理的知识";
  if (value.totals.usage === 0) return "知识已发布，但还没有被引用过";
  return "账本运转正常，没有待办积压";
});

const subline = computed(() => {
  const value = overview.value;
  if (value === undefined) return BRAND.description;
  if (value.totals.pendingReview > 0) {
    return "审核通过后由 Publisher 绑定当前策略水位发布；发布之后，引用、使用与反馈都会记到同一条修订上。";
  }
  if (value.totals.knowledge === 0) {
    return "从一条有明确来源、用途和负责人的知识开始：它先成为候选，经过独立审核，才会进入已发布账本。";
  }
  return "已发布的知识可被检索和引用；一旦发现高风险错误，走撤回与擦除流程，而不是直接改写历史。";
});

interface DeskTask {
  id: string;
  role: string;
  tone: string;
  title: string;
  description: string;
  to: string;
  cta: string;
}

const tasks = computed<DeskTask[]>(() => {
  const value = overview.value;
  if (value === undefined) return [];
  const list: DeskTask[] = [];
  const candidates = value.workflow.candidate + value.workflow.validating;

  if (candidates > 0) {
    list.push({
      id: "review",
      role: "CURATOR",
      tone: "is-curator",
      title: `核验 ${candidates} 条候选的来源与适用范围`,
      description: "先读正文与来源，再决定是补证、拒绝还是通过",
      to: "/review",
      cta: "进入审核",
    });
  }
  if (value.workflow.needs_evidence > 0) {
    list.push({
      id: "evidence",
      role: "AUTHOR",
      tone: "is-contributor",
      title: `为 ${value.workflow.needs_evidence} 条候选补齐证据`,
      description: "缺少来源或验证材料的候选不会进入发布队列",
      to: "/contribute",
      cta: "补充证据",
    });
  }
  if (value.workflow.verified > 0) {
    list.push({
      id: "publish",
      role: "PUBLISHER",
      tone: "is-publisher",
      title: `发布 ${value.workflow.verified} 条已通过审核的修订`,
      description: `发布会绑定当前策略水位 ${value.node.policyEpoch}`,
      to: "/governance",
      cta: "执行发布",
    });
  }
  if (value.totals.knowledge === 0) {
    list.push({
      id: "first",
      role: "AUTHOR",
      tone: "is-contributor",
      title: "提交第一条受治理的知识",
      description: "从一个真实场景开始：写清前提、边界和失效条件",
      to: "/contribute",
      cta: "贡献知识",
    });
  } else if (value.totals.usage === 0) {
    list.push({
      id: "usage",
      role: "READER",
      tone: "is-reader",
      title: `为 ${value.totals.knowledge} 条已发布知识补充引用`,
      description: "只有被真实调用的知识，才会产生可验证的使用证据",
      to: "/knowledge",
      cta: "检索知识",
    });
  }
  if (list.length === 0) {
    list.push({
      id: "observe",
      role: "OWNER",
      tone: "",
      title: "复盘知识的使用效果",
      description: "检查引用、反馈与服务目标，决定下一轮维护重点",
      to: "/evaluation",
      cta: "查看证据",
    });
  }
  return list.slice(0, 3);
});

const totalActivity = computed(() => {
  const value = overview.value;
  if (value === undefined) return 1;
  return Math.max(
    1,
    value.totals.knowledge + value.totals.pendingReview + value.totals.usage + value.totals.feedback,
  );
});

function share(count: number): string {
  return `${Math.max(4, Math.round((count / totalActivity.value) * 100))}%`;
}

const pipeline = computed(() => {
  const value = workflow.value;
  if (value === undefined) return [];
  const rows = [
    { label: "候选", key: "candidate", count: value.candidate },
    { label: "待补证", key: "needs_evidence", count: value.needs_evidence },
    { label: "待发布", key: "verified", count: value.verified },
    { label: "已发布", key: "accepted", count: value.accepted },
  ];
  const max = Math.max(1, ...rows.map((row) => row.count));
  return rows.map((row) => ({
    ...row,
    width: `${Math.max(3, Math.round((row.count / max) * 100))}%`,
  }));
});

function activityLabel(kind: string): string {
  if (kind === "create") return "创建候选";
  if (kind === "revise") return "提交修订";
  return "治理动作";
}

function activityTarget(status: string): string {
  if (status === "candidate" || status === "validating") return "/review";
  if (status === "needs_evidence") return "/contribute";
  if (status === "verified") return "/governance";
  if (status === "accepted") return "/knowledge";
  return "/contribute";
}
</script>

<template>
  <LoadingState v-if="loading" label="正在汇总知识账本" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh" />
  <template v-else-if="overview">
    <p class="eyebrow">{{ today }} · 知识水位</p>

    <div class="page-head">
      <div>
        <h1>{{ headline }}</h1>
        <p>{{ subline }}</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/knowledge"><Search :size="15" /> 检索知识</RouterLink>
        <RouterLink class="btn btn-primary" to="/contribute"><Plus :size="15" /> 贡献知识</RouterLink>
      </div>
    </div>

    <section class="stat-strip" aria-label="账本概览">
      <div class="stat-cell">
        <div class="stat-cell-top"><span>已发布知识</span><em>CHANNEL</em></div>
        <div class="stat-cell-value">{{ totals!.knowledge }}<small>条可用修订</small></div>
        <div class="stat-track"><i :style="{ width: share(totals!.knowledge) }" /></div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-top"><span>待审核 / 待补证</span><em>QUEUE</em></div>
        <div class="stat-cell-value">{{ totals!.pendingReview }}<small>条在队列中</small></div>
        <div class="stat-track is-gold">
          <i :style="{ width: share(totals!.pendingReview) }" />
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-top"><span>引用使用</span><em>USAGE</em></div>
        <div class="stat-cell-value">{{ totals!.usage }}<small>次真实调用</small></div>
        <div class="stat-track is-accent"><i :style="{ width: share(totals!.usage) }" /></div>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-top"><span>反馈证据</span><em>FEEDBACK</em></div>
        <div class="stat-cell-value">{{ totals!.feedback }}<small>条结果信号</small></div>
        <div class="stat-track is-slate"><i :style="{ width: share(totals!.feedback) }" /></div>
      </div>
    </section>

    <div class="split split-main-side" style="margin-top: 18px">
      <div style="display: grid; gap: 18px">
        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>建议下一步</h2>
              <p>按职责与工作流状态生成，只列出此刻能推进的动作。</p>
            </div>
            <RouterLink class="panel-link" to="/governance">全部队列 →</RouterLink>
          </header>
          <div class="row-list">
            <RouterLink v-for="task in tasks" :key="task.id" class="desk-task" :to="task.to">
              <span class="role-tag" :class="task.tone">{{ task.role }}</span>
              <div>
                <b>{{ task.title }}</b>
                <span>{{ task.description }}</span>
              </div>
              <span class="desk-task-go">{{ task.cta }}</span>
            </RouterLink>
          </div>
        </section>

        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>最近修订</h2>
              <p>每次提交都会生成不可覆盖的新修订，历史引用始终可复现。</p>
            </div>
            <RouterLink class="panel-link" to="/review">打开队列 →</RouterLink>
          </header>

          <EmptyState
            v-if="overview.recentActivity.length === 0"
            title="还没有知识活动"
            description="运行新手任务，或者直接提交第一条候选，账本会从第一笔记录开始。"
          >
            <template #action>
              <RouterLink class="btn btn-sm" to="/contribute">提交候选</RouterLink>
            </template>
          </EmptyState>

          <template v-else>
            <div class="table-head" style="grid-template-columns: minmax(0, 1fr) 110px 96px">
              <span>知识</span><span>状态</span>
              <span style="text-align: right">更新</span>
            </div>
            <div class="row-list">
              <RouterLink
                v-for="item in overview.recentActivity"
                :key="item.contributionId"
                class="row"
                style="grid-template-columns: minmax(0, 1fr) 110px 96px"
                :to="activityTarget(item.status)"
              >
                <div style="min-width: 0">
                  <span class="row-title truncate">{{ item.title }}</span>
                  <span class="row-meta">
                    {{ activityLabel(item.kind) }} · {{ item.spaceId.split("/").at(-1) }}
                  </span>
                </div>
                <StatusBadge :status="item.status" />
                <span class="row-time" style="text-align: right">
                  {{ formatRelativeTime(item.updatedAt) }}
                </span>
              </RouterLink>
            </div>
          </template>
        </section>
      </div>

      <div style="display: grid; gap: 18px">
        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>知识空间</h2>
              <p>权限、用途与策略共同划定的边界。</p>
            </div>
          </header>
          <div class="row-list">
            <RouterLink
              v-for="space in overview.spaces"
              :key="space.id"
              class="space-row"
              :to="`/knowledge?space=${encodeURIComponent(space.id)}`"
            >
              <span class="space-mark">
                {{ space.id.split("/").at(-1)?.slice(0, 2).toUpperCase() ?? "SP" }}
              </span>
              <div style="min-width: 0">
                <b>{{ space.id.split("/").at(-1) }}</b>
                <small>{{ space.id }}</small>
              </div>
              <span class="space-count">{{ space.assetCount }}<small>条</small></span>
            </RouterLink>
          </div>
        </section>

        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>流水线水位</h2>
              <p>候选、待补证、待发布、已发布各自的积压情况。</p>
            </div>
          </header>
          <div class="panel-body">
            <div v-for="row in pipeline" :key="row.key" class="quality-row">
              <span>{{ row.label }}</span>
              <div class="quality-bar">
                <i :class="{ 'is-gold': row.key !== 'accepted' }" :style="{ width: row.width }" />
              </div>
              <b>{{ row.count }}</b>
            </div>
            <div class="note-block" style="margin-top: 6px">
              <span>
                当前策略水位 <code class="hash-chip">{{ overview.node.policyEpoch }}</code>
                ；发布决策只能绑定当下水位，水位变化后旧决策不能静默沿用到新修订。
              </span>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>节点</h2>
              <p>这本账当前所在的知识节点。</p>
            </div>
          </header>
          <div class="panel-body">
            <dl style="display: grid; gap: 10px; font-size: 12px">
              <div style="display: flex; justify-content: space-between; gap: 12px">
                <dt class="muted">名称</dt>
                <dd>{{ overview.node.name }}</dd>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px">
                <dt class="muted">信任域</dt>
                <dd class="mono">{{ overview.node.trustDomain }}</dd>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px">
                <dt class="muted">生成时间</dt>
                <dd>{{ formatRelativeTime(overview.generatedAt) }}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  </template>
</template>
