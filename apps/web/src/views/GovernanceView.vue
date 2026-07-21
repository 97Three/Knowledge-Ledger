<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock3,
  Flame,
  Gavel,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-vue-next";
import { ElMessage } from "element-plus";
import {
  ApiProblem,
  applyGovernanceAction,
  createLifecycleContribution,
  getAssets,
  getContributions,
} from "@/api/client";
import type { ConsoleAsset, ContributionListItem } from "@/api/types";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { formatRelativeTime, percent, shortId, shortRevision } from "@/utils/format";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatusBadge from "@/components/StatusBadge.vue";

type LifecycleAction = "deprecate" | "revoke" | "erase";
type GovernanceAction = "publish" | LifecycleAction;

const TERMINAL_STATUSES: readonly string[] = ["accepted", "rejected", "quarantined", "withdrawn"];
const ACTION_ICONS: Readonly<Record<GovernanceAction, Component>> = {
  deprecate: Archive,
  erase: Trash2,
  publish: Gavel,
  revoke: Flame,
};

const {
  data: contributionData,
  error: contributionsError,
  loading: contributionsLoading,
  refresh: refreshContributions,
} = useAsyncResource<readonly ContributionListItem[]>(() => getContributions("publisher"));
const {
  data: assetData,
  error: assetsError,
  loading: assetsLoading,
  refresh: refreshAssets,
} = useAsyncResource<readonly ConsoleAsset[]>(getAssets);

const contributions = computed<readonly ContributionListItem[]>(() => contributionData.value ?? []);
const assets = computed<readonly ConsoleAsset[]>(() => assetData.value ?? []);

const ready = computed(() => contributions.value.filter((item) => item.receipt.status === "verified"));
const history = computed(() =>
  contributions.value
    .filter((item) => TERMINAL_STATUSES.includes(item.receipt.status))
    .slice(0, 12),
);

const publishedCount = computed(
  () => assets.value.filter((asset) => asset.status === "published").length,
);
const deprecatedCount = computed(
  () => assets.value.filter((asset) => asset.status === "deprecated").length,
);
const retiredCount = computed(
  () => assets.value.filter((asset) => asset.status === "revoked" || asset.status === "erased").length,
);
const scatterScale = computed(() => Math.max(1, ready.value.length + assets.value.length));
const policyEpoch = computed(
  () => contributions.value[0]?.receipt.policyEpoch ?? "本地策略纪元",
);

const acting = ref<string | undefined>(undefined);
const actionError = ref<string | undefined>(undefined);
const staleNotice = ref<string | undefined>(undefined);

function actionOf(item: ContributionListItem): GovernanceAction {
  const kind = item.receipt.kind;
  return kind === "deprecate" || kind === "revoke" || kind === "erase" ? kind : "publish";
}

function actionLabel(action: string): string {
  if (action === "publish") return "批准发布";
  if (action === "deprecate") return "执行废弃";
  if (action === "revoke") return "紧急撤销";
  return "监管擦除";
}

function actionButtonClass(action: GovernanceAction): string {
  if (action === "publish") return "btn-primary";
  return action === "revoke" || action === "erase" ? "btn-danger" : "";
}

function actionHint(item: ContributionListItem): string {
  const action = actionOf(item);
  if (action === "publish") return `绑定策略水位 ${item.receipt.policyEpoch} 后进入已发布通道`;
  if (action === "revoke") return "需要 Incident Responder 权限；撤销会立即停止后续消费";
  if (action === "erase") return "需要 Erasure Officer 权限；擦除后不可恢复";
  return "废弃后仍可审计，但不再推荐用于新场景";
}

function titleOf(item: ContributionListItem): string {
  const value = item.request.manifest?.title;
  if (typeof value === "string" && value.trim().length > 0) return value;
  return `${item.receipt.kind} · ${shortId(item.receipt.subjectRevisionId)}`;
}

function spaceTail(spaceId: string): string {
  return spaceId.split("/").at(-1) ?? spaceId;
}

function attestationRefsOf(item: ContributionListItem): readonly string[] {
  const raw = item.reviewDecision?.attestationRefs;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === "string")
    : [];
}

async function refreshAll(): Promise<void> {
  await Promise.all([refreshContributions(), refreshAssets()]);
}

async function execute(item: ContributionListItem): Promise<void> {
  const action = actionOf(item);
  acting.value = item.receipt.contributionId;
  actionError.value = undefined;
  staleNotice.value = undefined;
  try {
    await applyGovernanceAction({
      action,
      attestationRefs: attestationRefsOf(item),
      contributionId: item.receipt.contributionId,
      etag: item.etag,
      policyEpoch: item.receipt.policyEpoch,
      rationale:
        action === "publish"
          ? "批准进入 Published Channel，并绑定当前策略纪元。"
          : `批准执行 ${action} 生命周期动作。`,
    });
    ElMessage.success(
      action === "publish" ? "已批准发布，并绑定当前策略纪元。" : `已执行${actionLabel(action)}。`,
    );
    await refreshAll();
  } catch (caught) {
    if (caught instanceof ApiProblem && caught.status === 412) {
      staleNotice.value =
        "这条决策的 ETag 已过期：可能已被其他人执行，或策略水位已经变化。队列已重新读取，请核对最新状态后再决定。";
      ElMessage.warning("决策已过期，已重新读取队列");
      await refreshAll();
    } else {
      actionError.value = caught instanceof Error ? caught.message : "治理动作执行失败";
    }
  } finally {
    acting.value = undefined;
  }
}

const lifecycleOpen = ref(false);
const lifecycleAction = ref<LifecycleAction>("deprecate");
const lifecycleRevisionId = ref("");
const lifecycleRationale = ref("该知识已不再适用，需要通过受治理流程变更生命周期状态。");
const lifecycleSubmitting = ref(false);
const lifecycleError = ref<string | undefined>(undefined);

const actionableAssets = computed<readonly ConsoleAsset[]>(() =>
  assets.value.filter((asset) => asset.status !== "revoked" && asset.status !== "erased"),
);
const selectedAsset = computed(() =>
  actionableAssets.value.find((asset) => asset.revisionId === lifecycleRevisionId.value),
);
const lifecycleNote = computed(() => {
  if (lifecycleAction.value === "deprecate") return "废弃后仍可审计，但不再推荐用于新场景。";
  if (lifecycleAction.value === "revoke") return "撤销会立即停止后续消费，仅用于高风险错误。";
  return "擦除按监管要求执行，提交后不可撤回。";
});
const lifecycleValid = computed(
  () =>
    selectedAsset.value !== undefined &&
    lifecycleRationale.value.trim().length >= 4 &&
    !lifecycleSubmitting.value,
);

watch(
  actionableAssets,
  (list) => {
    if (list.length === 0) {
      lifecycleRevisionId.value = "";
      return;
    }
    if (!list.some((asset) => asset.revisionId === lifecycleRevisionId.value)) {
      lifecycleRevisionId.value = list[0]?.revisionId ?? "";
    }
  },
  { immediate: true },
);

function openLifecycle(): void {
  lifecycleError.value = undefined;
  lifecycleOpen.value = true;
}

async function submitLifecycle(): Promise<void> {
  const asset = selectedAsset.value;
  if (asset === undefined || !lifecycleValid.value) return;
  lifecycleSubmitting.value = true;
  lifecycleError.value = undefined;
  try {
    await createLifecycleContribution({
      action: lifecycleAction.value,
      rationale: lifecycleRationale.value.trim(),
      revisionId: asset.revisionId,
      spaceId: asset.spaceId,
    });
    lifecycleOpen.value = false;
    ElMessage.success(`${actionLabel(lifecycleAction.value)}候选已创建，等待独立审核。`);
    await refreshContributions();
  } catch (caught) {
    lifecycleError.value = caught instanceof Error ? caught.message : "创建生命周期候选失败";
  } finally {
    lifecycleSubmitting.value = false;
  }
}
</script>

<template>
  <LoadingState
    v-if="(contributionsLoading && contributions.length === 0) || (assetsLoading && assets.length === 0)"
    label="正在读取治理状态"
  />
  <ErrorState
    v-else-if="contributionsError"
    :error="contributionsError"
    @retry="refreshContributions"
  />
  <ErrorState v-else-if="assetsError" :error="assetsError" @retry="refreshAssets" />
  <template v-else>
    <PageHeader
      eyebrow="Publication &amp; Lifecycle"
      title="发布决策"
      subtitle="只有完成独立审核的候选才能执行。发布绑定当前策略水位；撤销与擦除使用更高权限，并立即影响后续检索。"
    >
      <template #actions>
        <button class="btn" @click="openLifecycle"><Plus :size="15" /> 生命周期动作</button>
        <button
          class="btn btn-ghost"
          :disabled="contributionsLoading || assetsLoading"
          @click="refreshAll"
        >
          <RefreshCw :size="15" /> 刷新
        </button>
      </template>
    </PageHeader>

    <div class="governance-body">
      <div v-if="staleNotice" class="note-block is-warn" role="status">
        <AlertTriangle :size="15" />
        <span>{{ staleNotice }}</span>
        <button class="btn btn-sm btn-ghost" @click="refreshAll">重新读取</button>
      </div>

      <div v-if="actionError" class="form-error" role="alert">
        <AlertTriangle :size="14" />
        <span>{{ actionError }}</span>
        <button class="btn btn-sm btn-ghost" @click="actionError = undefined">关闭</button>
      </div>

      <section class="stat-strip" aria-label="治理水位">
        <div class="stat-cell">
          <div class="stat-cell-top">
            <span class="stat-label"><Clock3 :size="13" /> 待发布决策</span>
            <em>DECISIONS</em>
          </div>
          <div class="stat-cell-value">{{ ready.length }}<small>条已核验候选</small></div>
          <div class="stat-track is-gold">
            <i :style="{ width: percent(ready.length, scatterScale) }" />
          </div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell-top">
            <span class="stat-label"><CheckCircle2 :size="13" /> 已发布</span>
            <em>PUBLISHED</em>
          </div>
          <div class="stat-cell-value">{{ publishedCount }}<small>条可用修订</small></div>
          <div class="stat-track">
            <i :style="{ width: percent(publishedCount, scatterScale) }" />
          </div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell-top">
            <span class="stat-label"><Archive :size="13" /> 已废弃</span>
            <em>DEPRECATED</em>
          </div>
          <div class="stat-cell-value">{{ deprecatedCount }}<small>条不再推荐</small></div>
          <div class="stat-track is-slate">
            <i :style="{ width: percent(deprecatedCount, scatterScale) }" />
          </div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell-top">
            <span class="stat-label"><ShieldAlert :size="13" /> 撤回 · 擦除</span>
            <em>REVOKED / ERASED</em>
          </div>
          <div class="stat-cell-value">{{ retiredCount }}<small>条已冻结</small></div>
          <div class="stat-track is-accent">
            <i :style="{ width: percent(retiredCount, scatterScale) }" />
          </div>
        </div>
      </section>

      <div class="split split-main-side">
        <section class="panel" aria-labelledby="governance-decisions">
          <header class="panel-head">
            <div>
              <h2 id="governance-decisions">等待执行的决策</h2>
              <p>Publisher、Incident Responder 与 Erasure Officer 分权执行。</p>
            </div>
            <span class="panel-count mono">{{ ready.length }} 待执行</span>
          </header>

          <EmptyState
            v-if="ready.length === 0"
            title="没有待执行决策"
            description="审核通过的候选会出现在这里；平台不会自动跨越发布边界。"
          >
            <template #icon><Gavel :size="19" /></template>
          </EmptyState>

          <div v-else class="row-list">
            <div
              v-for="item in ready"
              :key="item.receipt.contributionId"
              class="decision-row"
            >
              <span class="decision-icon" :class="`action-${actionOf(item)}`">
                <component :is="ACTION_ICONS[actionOf(item)]" :size="14" />
              </span>
              <div class="decision-main">
                <strong class="decision-title truncate">{{ titleOf(item) }}</strong>
                <span class="decision-meta">
                  {{ actionLabel(actionOf(item)) }} · {{ spaceTail(item.receipt.spaceId) }}
                </span>
                <span class="decision-rev mono">
                  rev {{ shortRevision(item.receipt.subjectRevisionId) }}
                </span>
              </div>
              <StatusBadge :status="item.receipt.status" />
              <el-tooltip :content="actionHint(item)" placement="top" :show-after="180">
                <button
                  class="btn btn-sm"
                  :class="actionButtonClass(actionOf(item))"
                  :disabled="acting !== undefined"
                  @click="execute(item)"
                >
                  {{
                    acting === item.receipt.contributionId
                      ? "执行中…"
                      : actionLabel(actionOf(item))
                  }}
                </button>
              </el-tooltip>
            </div>
          </div>
        </section>

        <aside class="panel policy-panel">
          <div class="panel-body policy-body">
            <p class="eyebrow">Current Policy Epoch</p>
            <div class="policy-epoch">
              <Gavel :size="15" />
              <code>{{ policyEpoch }}</code>
            </div>
            <p class="policy-copy">
              执行时服务端会比较候选记录的 Policy Epoch。策略变化后，旧决策不能静默沿用。
            </p>
            <div class="note-block is-warn policy-rule">
              <AlertTriangle :size="15" />
              <span>
                高风险错误使用 <strong>revoke</strong>，监管擦除使用 <strong>erase</strong>，
                不要用普通下架替代。
              </span>
            </div>
            <ul class="scope-list" aria-label="执行权限">
              <li class="scope-row">
                <span class="scope-role">PUBLISHER</span>
                <span class="scope-desc">发布 · 废弃</span>
              </li>
              <li class="scope-row">
                <span class="scope-role">INCIDENT</span>
                <span class="scope-desc">紧急撤销</span>
              </li>
              <li class="scope-row">
                <span class="scope-role">ERASURE</span>
                <span class="scope-desc">监管擦除</span>
              </li>
            </ul>
            <p class="policy-foot">
              发布边界不会自动跨越：候选即使通过审核，也需要有人按下执行，并对结果负责。
            </p>
          </div>
        </aside>
      </div>

      <section class="panel" aria-labelledby="governance-history">
        <header class="panel-head">
          <div>
            <h2 id="governance-history">最近治理轨迹</h2>
            <p>终态贡献仍保留 Receipt 与决策引用，不覆盖历史。</p>
          </div>
        </header>

        <EmptyState
          v-if="history.length === 0"
          title="还没有已完成的治理动作"
          description="发布、废弃、撤销与擦除都会在这里留下回执；终态记录不会被覆盖。"
        >
          <template #icon><Clock3 :size="19" /></template>
          <template #action>
            <button class="btn btn-sm" @click="openLifecycle">发起生命周期动作</button>
          </template>
        </EmptyState>

        <div v-else class="history-scroll">
          <div class="table-head history-grid">
            <span>知识 / 动作</span><span>状态</span><span>更新时间</span><span>Contribution</span>
          </div>
          <div
            v-for="item in history.slice(0, 8)"
            :key="item.receipt.contributionId"
            class="row history-row"
          >
            <div class="history-main">
              <strong class="history-title truncate">{{ titleOf(item) }}</strong>
              <small class="history-kind mono">{{ item.receipt.kind }}</small>
            </div>
            <StatusBadge :status="item.receipt.status" />
            <span class="history-time">{{ formatRelativeTime(item.updatedAt) }}</span>
            <code class="history-id">{{ shortId(item.receipt.contributionId, 22) }}</code>
          </div>
          <p v-if="history.length > 8" class="list-more">
            共 {{ history.length }} 条治理记录，这里只显示最近 8 条。
          </p>
        </div>
      </section>
    </div>

    <el-dialog
      v-model="lifecycleOpen"
      title="发起生命周期动作"
      width="520px"
      :close-on-click-modal="false"
      :show-close="!lifecycleSubmitting"
      @closed="lifecycleError = undefined"
    >
      <div class="lifecycle-intro">
        <p class="eyebrow">New lifecycle candidate</p>
        <p>该动作先生成候选，仍需 Curator 审核后由对应高权限角色执行。</p>
      </div>

      <div v-if="actionableAssets.length === 0" class="note-block">
        <span>没有可执行生命周期动作的知识：已撤销或已擦除的修订不能再次变更状态。</span>
      </div>

      <div v-else class="dialog-fields">
        <div class="field">
          <label>目标知识</label>
          <el-select v-model="lifecycleRevisionId" filterable placeholder="选择目标知识">
            <el-option
              v-for="asset in actionableAssets"
              :key="asset.revisionId"
              :label="`${asset.title} · ${asset.status}`"
              :value="asset.revisionId"
            >
              <span class="select-option">
                <span class="truncate">{{ asset.title }}</span>
                <span class="select-option-meta mono">{{ asset.status }}</span>
              </span>
            </el-option>
          </el-select>
          <small v-if="selectedAsset">
            修订 {{ shortRevision(selectedAsset.revisionId) }} · {{ selectedAsset.spaceId }}
          </small>
        </div>

        <div class="field">
          <label>动作</label>
          <el-select v-model="lifecycleAction">
            <el-option label="Deprecate · 仍可审计但不再推荐" value="deprecate" />
            <el-option label="Revoke · 立即停止后续消费" value="revoke" />
            <el-option label="Erase · 执行监管擦除" value="erase" />
          </el-select>
        </div>

        <div class="field">
          <label>理由</label>
          <el-input
            v-model="lifecycleRationale"
            type="textarea"
            :rows="3"
            maxlength="240"
            show-word-limit
          />
          <small>至少 4 个字符；理由会写入回执，作为审核依据。</small>
        </div>

        <div class="note-block" :class="{ 'is-warn': lifecycleAction !== 'deprecate' }">
          <AlertTriangle v-if="lifecycleAction !== 'deprecate'" :size="14" />
          <span>{{ lifecycleNote }}</span>
        </div>

        <p v-if="lifecycleError" class="form-error" role="alert">{{ lifecycleError }}</p>
      </div>

      <template #footer>
        <div class="dialog-actions">
          <button class="btn btn-ghost" :disabled="lifecycleSubmitting" @click="lifecycleOpen = false">
            取消
          </button>
          <button
            class="btn btn-primary"
            :disabled="!lifecycleValid || actionableAssets.length === 0"
            @click="submitLifecycle"
          >
            {{ lifecycleSubmitting ? "创建中…" : "创建候选" }}
          </button>
        </div>
      </template>
    </el-dialog>
  </template>
</template>

<style scoped>
.governance-body {
  display: grid;
  gap: var(--gap);
}

.note-block > span {
  flex: 1;
}

.note-block .btn {
  flex: 0 0 auto;
}

.form-error > span {
  flex: 1;
}

.form-error .btn {
  flex: 0 0 auto;
}

.stat-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.stat-label svg {
  color: var(--faint);
}

.panel-count {
  flex: 0 0 auto;
  color: var(--faint);
  font: 600 10px/1 var(--mono);
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.decision-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.decision-row:last-child {
  border-bottom: 0;
}

.decision-row:hover {
  background: var(--card-warm);
}

.decision-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--slate-soft);
  color: var(--slate);
}

.decision-icon.action-publish {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.decision-icon.action-deprecate {
  border-color: var(--line-2);
  background: var(--slate-soft);
  color: var(--slate);
}

.decision-icon.action-revoke,
.decision-icon.action-erase {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.decision-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.decision-title {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.decision-meta {
  color: var(--faint);
  font: 500 10.5px/1.5 var(--mono);
  letter-spacing: 0.02em;
}

.decision-rev {
  color: var(--muted);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}

.decision-row .btn {
  justify-self: end;
}

.decision-row .badge {
  justify-self: start;
}

.policy-body {
  display: grid;
  gap: 14px;
}

.policy-body .eyebrow {
  margin-bottom: 0;
}

.policy-epoch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink-2);
}

.policy-epoch svg {
  color: var(--accent);
}

.policy-epoch code {
  font: 600 14px/1.35 var(--mono);
  letter-spacing: 0.01em;
  word-break: break-all;
}

.policy-copy {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.policy-rule {
  align-items: flex-start;
}

.policy-rule strong {
  color: var(--gold);
  font-weight: 600;
}

.scope-list {
  border-top: 1px solid var(--line);
}

.scope-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line-soft);
}

.scope-role {
  color: var(--faint);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.12em;
}

.scope-desc {
  color: var(--ink-2);
  font-size: 11.5px;
}

.policy-foot {
  color: var(--faint);
  font-size: 11px;
  line-height: 1.7;
}

.history-scroll {
  overflow-x: auto;
}

.history-grid,
.history-row {
  grid-template-columns: minmax(0, 1fr) 104px 118px 150px;
  min-width: 520px;
}

.history-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.history-title {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.history-kind {
  color: var(--faint);
  font-size: 10.5px;
}

.history-row .badge {
  justify-self: start;
}

.history-time {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.history-id {
  color: var(--muted);
  font: 500 11px/1.5 var(--mono);
  letter-spacing: 0.02em;
  overflow-wrap: anywhere;
}

.dialog-fields {
  display: grid;
  gap: 14px;
}

.lifecycle-intro {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.lifecycle-intro .eyebrow {
  margin-bottom: 0;
}

.lifecycle-intro > p:last-child {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.field small {
  color: var(--faint);
  font-size: 11px;
  line-height: 1.6;
}

.dialog-fields :deep(.el-select) {
  width: 100%;
}

.select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.select-option-meta {
  color: var(--faint);
  font-size: 10.5px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 720px) {
  .decision-row {
    grid-template-columns: 28px minmax(0, 1fr);
    row-gap: 8px;
  }

  .decision-row .badge,
  .decision-row .btn {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
