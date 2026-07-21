<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle, ArrowRight, Info, ShieldCheck } from "lucide-vue-next";
import { getEvidenceSummary, getOverview, getServiceHealth } from "@/api/client";
import type { EvidenceSummary, Overview, ServiceHealth } from "@/api/types";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { formatDateTime, percent, shortId } from "@/utils/format";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import PageHeader from "@/components/PageHeader.vue";

interface EvaluationData {
  readonly evidence: EvidenceSummary;
  readonly health: ServiceHealth;
  readonly overview: Overview;
}

type FunnelTone = "accent" | "gold" | "ink" | "jade" | "slate";

interface FunnelStep {
  readonly caption: string;
  readonly label: string;
  readonly tone: FunnelTone;
  readonly value: string;
}

type HarmedSignal = EvidenceSummary["harmed"][number];

const { data, error, loading, refresh } = useAsyncResource<EvaluationData>(async () => {
  const [overview, evidence, health] = await Promise.all([
    getOverview(),
    getEvidenceSummary(),
    getServiceHealth(),
  ]);
  return { evidence, health, overview };
});

const view = computed(() => data.value);
const healthOk = computed(() => data.value?.health.status === "meeting_objective");

const helpedRate = computed(() => {
  const value = data.value;
  if (value === undefined) return 0;
  const denominator = Math.max(value.evidence.totals.eligibleFeedback, 1);
  return (value.evidence.outcomes.helped / denominator) * 100;
});

const statCeiling = computed(() => {
  const value = data.value;
  if (value === undefined) return 1;
  return Math.max(
    1,
    value.overview.totals.published,
    value.evidence.totals.usage,
    value.evidence.totals.feedback,
  );
});

function share(count: number): string {
  return `${Math.max(3, Math.round((count / statCeiling.value) * 100))}%`;
}

const p95Share = computed(() => {
  const value = data.value;
  if (value === undefined) return "3%";
  const objective = Math.max(value.health.objective.p95Milliseconds, 1);
  const ratio = value.health.window.p95Milliseconds / objective;
  return `${Math.min(100, Math.max(3, Math.round(ratio * 100)))}%`;
});

const funnel = computed<readonly FunnelStep[]>(() => {
  const value = data.value;
  if (value === undefined) return [];
  return [
    {
      caption: "发布版本",
      label: "Published",
      tone: "ink",
      value: String(value.overview.totals.published),
    },
    {
      caption: "可验证使用",
      label: "Usage",
      tone: "jade",
      value: String(value.evidence.totals.usage),
    },
    {
      caption: "原始反馈",
      label: "Raw Feedback",
      tone: "slate",
      value: String(value.evidence.totals.feedback),
    },
    {
      caption: "具备聚合资格",
      label: "Eligible",
      tone: "gold",
      value: String(value.evidence.totals.eligibleFeedback),
    },
    {
      caption: "帮助 / 伤害",
      label: "Helped / Harmed",
      tone: "accent",
      value: `${value.evidence.outcomes.helped} / ${value.evidence.outcomes.harmed}`,
    },
  ];
});

function eligibilityLabel(item: HarmedSignal): string {
  return item.eligibleForAggregation ? "可聚合" : `待核验 · ${item.correlationClass}`;
}
</script>

<template>
  <LoadingState v-if="loading" label="正在聚合效果证据" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh" />
  <template v-else-if="view">
    <PageHeader
      eyebrow="Evidence, not vanity metrics"
      title="使用证据"
      subtitle="真实展示 Query → Exposure → Usage → Feedback，并把 harmed 信号送入复审队列；反馈不会直接改排名或发布。"
    />

    <section class="stat-strip" aria-label="使用证据概览">
      <div class="stat-cell">
        <div class="stat-cell-top"><span>发布版本</span><em>PUBLISHED</em></div>
        <div class="stat-cell-value">
          {{ view.overview.totals.published }}<small>条发布修订</small>
        </div>
        <div class="stat-track"><i :style="{ width: share(view.overview.totals.published) }" /></div>
        <p class="stat-hint">具备 Profile 要求的不可变证明链</p>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-top"><span>可验证使用</span><em>USAGE</em></div>
        <div class="stat-cell-value">
          {{ view.evidence.totals.usage }}<small>次引用使用</small>
        </div>
        <div class="stat-track is-accent">
          <i :style="{ width: share(view.evidence.totals.usage) }" />
        </div>
        <p class="stat-hint">绑定 Exposure 与 Passage Citation</p>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-top"><span>反馈证据</span><em>FEEDBACK</em></div>
        <div class="stat-cell-value">
          {{ view.evidence.totals.feedback }}<small>条结果信号</small>
        </div>
        <div class="stat-track is-slate">
          <i :style="{ width: share(view.evidence.totals.feedback) }" />
        </div>
        <p class="stat-hint">
          {{ view.evidence.totals.eligibleFeedback }} 条具备聚合资格 · 帮助率
          {{ helpedRate.toFixed(1) }}%
        </p>
      </div>
      <div class="stat-cell">
        <div class="stat-cell-top"><span>服务 P95</span><em>SERVICE</em></div>
        <div class="stat-cell-value">
          {{ view.health.window.p95Milliseconds.toFixed(0) }}<small>ms</small>
        </div>
        <div class="stat-track" :class="{ 'is-accent': !healthOk }">
          <i :style="{ width: p95Share }" />
        </div>
        <p class="stat-hint">目标 ≤ {{ view.health.objective.p95Milliseconds }} ms</p>
      </div>
    </section>

    <section class="service-strip" aria-label="服务健康">
      <span class="service-state" :class="{ 'is-warn': !healthOk }">
        <i aria-hidden="true" />
        {{ healthOk ? "当前满足服务目标" : "当前服务指标需要关注" }}
      </span>
      <span>{{ view.health.window.requestCount }} 个请求样本</span>
      <span>5xx {{ (view.health.window.errorRate * 100).toFixed(2) }}%</span>
      <span>事件循环 P95 {{ view.health.window.eventLoopP95Milliseconds.toFixed(1) }} ms</span>
    </section>

    <div class="split split-main-side evaluation-split">
      <div class="main-stack">
        <section class="panel">
          <header class="panel-head">
            <div>
              <h2>任务证据漏斗</h2>
              <p>
                原始反馈与可聚合反馈严格分开，避免把未通过相关性和隐私门禁的信号算成质量结论。
              </p>
            </div>
            <span class="panel-kicker mono">QUERY → FEEDBACK</span>
          </header>
          <div class="panel-body">
            <div class="funnel" aria-label="Published 到反馈的证据漏斗">
              <template v-for="(step, index) in funnel" :key="step.label">
                <div class="funnel-step">
                  <span class="funnel-label">{{ step.label }}</span>
                  <strong class="funnel-value" :class="`is-${step.tone}`">{{ step.value }}</strong>
                  <span class="funnel-caption">{{ step.caption }}</span>
                </div>
                <ArrowRight
                  v-if="index < funnel.length - 1"
                  class="funnel-arrow"
                  :size="18"
                  aria-hidden="true"
                />
              </template>
            </div>

            <div class="task-section">
              <div class="task-head">
                <p class="eyebrow">按任务类别</p>
                <span class="mono faint">USAGE → FEEDBACK</span>
              </div>
              <p v-if="view.evidence.taskCategories.length === 0" class="muted-copy">
                还没有可归因的任务类别证据。
              </p>
              <div v-else class="task-list">
                <div
                  v-for="category in view.evidence.taskCategories"
                  :key="category.name"
                  class="task-row"
                >
                  <span class="task-name mono truncate">{{ category.name }}</span>
                  <span class="task-number">{{ category.usage }}<small>使用</small></span>
                  <ArrowRight :size="12" class="task-arrow" aria-hidden="true" />
                  <span class="task-number">{{ category.feedback }}<small>反馈</small></span>
                  <span class="task-rate mono">{{ percent(category.feedback, category.usage) }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="rail-stack">
        <section class="panel evidence-model">
          <header class="panel-head">
            <div>
              <p class="eyebrow model-eyebrow">Qualified task success</p>
              <h2>合格的任务成功</h2>
            </div>
            <ShieldCheck :size="22" class="model-icon" aria-hidden="true" />
          </header>
          <div class="panel-body">
            <div
              class="formula"
              aria-label="合格的任务成功 = 正确 + 可引用 + 未越权 + 满足 SLO"
            >
              <span class="formula-eq">=</span>
              <span class="formula-term">正确</span>
              <i>+</i>
              <span class="formula-term">可引用</span>
              <i>+</i>
              <span class="formula-term">未越权</span>
              <i>+</i>
              <span class="formula-term">满足 SLO</span>
            </div>
            <p class="model-copy">
              当前帮助率只覆盖主动反馈样本，不能冒充总体任务成功率。真实黄金任务集接入后，EvaluationRun
              才会加入 Recall@5、无答案准确率、引用重定位和伤害评测。
            </p>
            <div class="attest-chain" aria-label="Required Attestations 到 Feedback">
              <span>Required Attestations</span>
              <ArrowRight :size="12" aria-hidden="true" />
              <span>Gate</span>
              <ArrowRight :size="12" aria-hidden="true" />
              <span>Usage</span>
              <ArrowRight :size="12" aria-hidden="true" />
              <span>Feedback</span>
            </div>
          </div>
        </section>

        <div class="note-block evidence-note">
          <Info :size="15" aria-hidden="true" />
          <span>
            只有服务端判定 eligible 的反馈才进入聚合统计；原始反馈只用于人工复审，不会自动改排名或发布。服务
            P95、5xx 与事件循环指标来自同一节点的健康窗口。
          </span>
        </div>
      </div>
    </div>

    <section class="panel revision-panel">
      <header class="panel-head">
        <div>
          <h2>按 Revision 的使用与合格结果</h2>
          <p>Usage 显示全部可验证使用；Helped/Harmed 只统计服务端判定可聚合的反馈。</p>
        </div>
        <span class="panel-kicker mono">{{ view.evidence.revisions.length }} REVISIONS</span>
      </header>

      <EmptyState
        v-if="view.evidence.revisions.length === 0"
        title="还没有可归因的任务证据"
        description="请从知识检索结果记录“有帮助 / 一般 / 有伤害”。"
      />

      <template v-else>
        <div class="table-head revision-grid">
          <span>Revision</span><span>Usage</span><span>Helped</span><span>Harmed</span>
        </div>
        <div class="row-list">
          <div
            v-for="item in view.evidence.revisions"
            :key="item.revisionId"
            class="row revision-grid"
          >
            <el-tooltip :content="item.revisionId" placement="top">
              <code class="hash-chip revision-id">{{ shortId(item.revisionId, 34) }}</code>
            </el-tooltip>
            <strong class="mono revision-number">{{ item.usage }}</strong>
            <span class="mono revision-number">{{ item.helped }}</span>
            <span class="mono revision-number" :class="{ 'is-harm': item.harmed > 0 }">
              {{ item.harmed }}
            </span>
          </div>
        </div>
      </template>
    </section>

    <section class="panel harm-panel">
      <header class="panel-head">
        <div>
          <h2>伤害与复审队列</h2>
          <p>
            所有 harmed 信号都进入人工调查；只有合格信号进入统计，任何信号都不会自动删知识或改排名。
          </p>
        </div>
        <span class="panel-kicker mono">{{ view.evidence.harmed.length }} SIGNALS</span>
      </header>

      <EmptyState
        v-if="view.evidence.harmed.length === 0"
        title="当前没有 harmed 证据"
        description="新的伤害信号会先进入人工复审；只有合格信号进入统计，也不会有任何信号自动改排名或删除知识。"
      >
        <template #icon><ShieldCheck :size="19" /></template>
      </EmptyState>

      <div v-else class="harm-list">
        <div
          v-for="item in view.evidence.harmed"
          :key="item.feedbackId"
          class="harm-row"
        >
          <span class="harm-icon"><AlertTriangle :size="15" aria-hidden="true" /></span>
          <div class="harm-body">
            <strong>{{ item.taskCategory }}</strong>
            <small class="mono">
              <el-tooltip :content="item.revisionIds.join(' · ')" placement="top">
                <span>
                  {{
                    item.revisionIds.map((revision) => shortId(revision, 24)).join(" · ")
                      || "未绑定 revision"
                  }}
                </span>
              </el-tooltip>
            </small>
            <small class="harm-class mono">关联类 {{ item.correlationClass }}</small>
          </div>
          <span
            class="harm-tag"
            :class="item.eligibleForAggregation ? 'is-qualified' : 'is-pending'"
          >
            {{ eligibilityLabel(item) }}
          </span>
          <time class="harm-time">
            {{ item.observedAt === undefined ? "待处理" : formatDateTime(item.observedAt) }}
          </time>
        </div>
      </div>
    </section>
  </template>
</template>

<style scoped>
/* ---------- 服务健康条 ---------- */
.service-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 18px;
  margin-top: var(--gap-sm);
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card-warm);
  color: var(--muted);
  font: 500 11px/1.5 var(--mono);
}

.service-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--jade);
  font-weight: 600;
}

.service-state i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.service-state.is-warn {
  color: var(--gold);
}

/* ---------- 统计单元补充 ---------- */
.stat-hint {
  margin-top: 8px;
  color: var(--faint);
  font-size: 11px;
  line-height: 1.5;
}

/* ---------- 主栅格 ---------- */
.evaluation-split {
  margin-top: var(--gap);
}

.main-stack,
.rail-stack {
  display: grid;
  gap: var(--gap);
}

.panel-kicker {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: 10px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

/* ---------- 证据漏斗 ---------- */
.funnel {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 4px;
}

.funnel-step {
  flex: 1 1 0;
  min-width: 104px;
  padding: 14px 12px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card-warm);
}

.funnel-label {
  display: block;
  color: var(--faint);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.funnel-value {
  display: block;
  margin-top: 9px;
  color: var(--ink);
  font: 600 26px/1.1 var(--sans);
  letter-spacing: -0.6px;
  font-variant-numeric: tabular-nums;
}

.funnel-value.is-jade {
  color: var(--jade);
}

.funnel-value.is-gold {
  color: var(--gold);
}

.funnel-value.is-accent {
  color: var(--accent);
}

.funnel-value.is-slate {
  color: var(--slate);
}

.funnel-caption {
  display: block;
  margin-top: 5px;
  color: var(--muted);
  font-size: 11px;
}

.funnel-arrow {
  align-self: center;
  color: var(--line-2);
}

/* ---------- 任务类别 ---------- */
.task-section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.task-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.task-head .eyebrow {
  margin: 0;
}

.task-list {
  display: grid;
}

.task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 14px auto 48px;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line-soft);
}

.task-row:last-child {
  border-bottom: 0;
}

.task-name {
  color: var(--ink-2);
  font-size: 11px;
}

.task-number {
  color: var(--ink);
  font: 600 13px/1 var(--mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.task-number small {
  margin-left: 4px;
  color: var(--faint);
  font: 500 10px/1 var(--sans);
}

.task-arrow {
  color: var(--line-2);
}

.task-rate {
  color: var(--jade);
  font-size: 10.5px;
  text-align: right;
}

.muted-copy {
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

/* ---------- 证据模型 ---------- */
.model-eyebrow {
  margin: 0 0 6px;
}

.model-icon {
  color: var(--accent);
}

.formula {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
}

.formula-eq {
  color: var(--faint);
  font: 500 12px/1 var(--mono);
}

.formula-term {
  padding: 4px 7px;
  border: 1px solid var(--jade-line);
  border-radius: var(--radius-sm);
  background: var(--jade-soft);
  color: var(--jade);
  font: 600 10.5px/1 var(--mono);
  letter-spacing: 0.04em;
}

.formula i {
  color: var(--faint);
  font: 500 11px/1 var(--mono);
  font-style: normal;
}

.model-copy {
  margin-top: 14px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.75;
}

.attest-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}

.attest-chain span {
  color: var(--faint);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.attest-chain svg {
  color: var(--line-2);
}

.evidence-note {
  align-items: flex-start;
  line-height: 1.7;
}

/* ---------- Revision 表 ---------- */
.revision-panel,
.harm-panel {
  margin-top: var(--gap);
}

.revision-grid {
  grid-template-columns: minmax(0, 1fr) 86px 86px 86px;
}

.revision-grid > :nth-child(n + 2) {
  text-align: right;
}

.revision-id {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.revision-number {
  color: var(--ink-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.revision-number.is-harm {
  color: var(--accent);
  font-weight: 600;
}

/* ---------- 伤害队列 ---------- */
.harm-list {
  display: grid;
}

.harm-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.harm-row:last-child {
  border-bottom: 0;
}

.harm-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--accent-line);
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}

.harm-body {
  min-width: 0;
}

.harm-body strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.harm-body small {
  display: block;
  margin-top: 2px;
  color: var(--faint);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.harm-tag {
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.harm-tag.is-qualified {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.harm-tag.is-pending {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.harm-time {
  color: var(--muted);
  font: 500 10.5px/1.5 var(--mono);
  white-space: nowrap;
}

/* ---------- 响应式 ---------- */
@media (max-width: 760px) {
  .harm-row {
    grid-template-columns: 26px minmax(0, 1fr);
    align-items: start;
  }

  .harm-tag,
  .harm-time {
    grid-column: 2;
    justify-self: start;
  }

  .funnel-step {
    min-width: 88px;
  }
}

@media (max-width: 560px) {
  .revision-grid {
    grid-template-columns: minmax(0, 1fr) 58px 58px 58px;
  }

  .task-row {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .task-arrow,
  .task-rate {
    display: none;
  }
}
</style>
