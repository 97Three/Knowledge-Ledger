<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Fingerprint,
  History,
  Info,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
  XCircle,
} from "lucide-vue-next";
import {
  amendContribution,
  createContribution,
  getContributions,
  withdrawContribution,
} from "@/api/client";
import { buildKnowledgeContribution } from "@/api/knowledge";
import type { KnowledgeDraft } from "@/api/knowledge";
import type {
  BuiltContribution,
  ContributionListItem,
  ContributionReceipt,
} from "@/api/types";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { formatDate, formatRelativeTime, percent, shortId, shortRevision } from "@/utils/format";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatusBadge from "@/components/StatusBadge.vue";

const DEFAULT_SPACE = "https://knowledge.local/spaces/default";
const DEFAULT_RATIONALE = "为团队提供经过独立审核、可稳定引用的任务知识。";
const DEFAULT_PURPOSES = ["customer-support"] as const;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const STEPS = ["描述知识", "边界与依据", "确认提交"] as const;
const TERMINAL_STATUSES = new Set<string>(["accepted", "rejected", "withdrawn"]);
const CONTENT_PLACEHOLDER = "# 操作步骤\n\n1. 先确认…\n2. 然后执行…\n\n## 风险边界";
const SOURCE_PLACEHOLDER = "每行一个绝对 URL\nhttps://docs.example/policy";
const EVIDENCE_PLACEHOLDER = "每行一个绝对 URL\nhttps://evidence.example/review";

const GUARDRAILS = [
  { title: "结构校验", text: "验证 Profile、Manifest 与 Payload 摘要是否一致，摘要不一致会被直接拒绝。" },
  { title: "独立审核", text: "Curator 检查证据、适用范围和风险，可能退回补证或拒绝。" },
  { title: "发布决策", text: "Publisher 绑定当前 Policy Epoch 执行发布；候选不会自动上线。" },
] as const;

interface ContributionForm {
  assetType: "procedure" | "source_document";
  content: string;
  labels: string;
  rationale: string;
  spaceId: string;
  summary: string;
  title: string;
}

const route = useRoute();
const rawSpace = route.query["space"];
const requestedSpace =
  typeof rawSpace === "string" && rawSpace.trim().length > 0 ? rawSpace.trim() : undefined;

const form = reactive<ContributionForm>({
  assetType: "procedure",
  content: "",
  labels: "agent",
  rationale: DEFAULT_RATIONALE,
  spaceId: requestedSpace ?? DEFAULT_SPACE,
  summary: "",
  title: "",
});
const primarySourcesInput = ref("");
const evidenceInput = ref("");

const step = ref(0);
const formError = ref<string>();
const importError = ref<string>();
const submitting = ref(false);
const receipt = ref<ContributionReceipt>();
const built = shallowRef<BuiltContribution>();
const previewLoading = ref(false);
const previewError = ref<string>();
const wizardEl = ref<HTMLElement>();

const {
  data: contributions,
  error: listError,
  loading: listLoading,
  refresh: refreshContributions,
} = useAsyncResource<readonly ContributionListItem[]>(() => getContributions("contributor"));

const items = computed<readonly ContributionListItem[]>(() => contributions.value ?? []);
const stepProgress = computed(() => percent(step.value + 1, STEPS.length));
const profileLabel = computed(() =>
  form.assetType === "procedure" ? "Procedure / 1" : "Source Document / 1",
);
const sourceRefs = computed(() => parseReferences(primarySourcesInput.value));
const evidenceRefs = computed(() => parseReferences(evidenceInput.value));
const payloadSize = computed(() => new TextEncoder().encode(form.content).byteLength);
const contentStats = computed(() =>
  form.content.length === 0
    ? "尚未输入"
    : `${form.content.split("\n").length} 行 · ${form.content.length} 字符`,
);

const stepHint = computed(() => {
  if (step.value === 0) return "下一步条件：标题 ≥ 2 字 · 摘要 ≥ 4 字 · 正文 ≥ 10 字。";
  if (step.value === 1) return "下一步条件：绝对空间 URI · 理由 ≥ 4 字；来源必须都是绝对 URL。";
  return "提交只创建 Candidate；审核与发布由独立角色完成。";
});

watch(
  form,
  () => {
    built.value = undefined;
    previewError.value = undefined;
    formError.value = undefined;
  },
  { deep: true },
);
watch([primarySourcesInput, evidenceInput], () => {
  built.value = undefined;
  previewError.value = undefined;
  formError.value = undefined;
});

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.length > 0 ? caught.message : fallback;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function rawReferences(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

function parseReferences(value: string): readonly string[] {
  return rawReferences(value).filter(isAbsoluteUrl);
}

function invalidReferences(value: string): readonly string[] {
  return rawReferences(value).filter((item) => !isAbsoluteUrl(item));
}

function splitLabels(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeDraft(): KnowledgeDraft {
  return {
    allowedPurposes: [...DEFAULT_PURPOSES],
    assetType: form.assetType,
    content: form.content,
    evidenceRefs: [...evidenceRefs.value],
    labels: splitLabels(form.labels),
    primarySources: [...sourceRefs.value],
    rationale: form.rationale.trim(),
    spaceId: form.spaceId.trim(),
    summary: form.summary.trim(),
    title: form.title.trim(),
  };
}

function validateStep1(): string | undefined {
  if (form.title.trim().length < 2) return "标题至少需要 2 个字符，写清 Agent 能完成的任务。";
  if (form.summary.trim().length < 4) return "摘要至少需要 4 个字符，说明它解决什么问题、适用于谁。";
  if (form.content.trim().length < 10) return "正文至少需要 10 个字符，可以是步骤、模板或边界说明。";
  return undefined;
}

function validateStep2(): string | undefined {
  if (!/^https?:\/\//u.test(form.spaceId.trim())) {
    return "知识空间必须是 http:// 或 https:// 开头的绝对 URI。";
  }
  if (form.rationale.trim().length < 4) {
    return "请用至少 4 个字符说明贡献理由，审核者会据此判断适用范围。";
  }
  const invalid = [
    ...invalidReferences(primarySourcesInput.value),
    ...invalidReferences(evidenceInput.value),
  ];
  if (invalid.length > 0) {
    return `有 ${invalid.length} 行不是合法的绝对 URL：${invalid.slice(0, 2).join("、")}`;
  }
  return undefined;
}

function scrollToWizard(): void {
  void nextTick(() => {
    wizardEl.value?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function goToStep(target: number): void {
  if (target < 0 || target > step.value) return;
  step.value = target;
  formError.value = undefined;
  scrollToWizard();
}

function goBack(): void {
  if (step.value === 0) return;
  step.value -= 1;
  formError.value = undefined;
  scrollToWizard();
}

async function ensurePreview(): Promise<void> {
  if (built.value !== undefined) return;
  previewLoading.value = true;
  previewError.value = undefined;
  try {
    built.value = await buildKnowledgeContribution(normalizeDraft());
  } catch (caught) {
    previewError.value = messageOf(caught, "浏览器内构建候选失败，请检查内容后重试。");
  } finally {
    previewLoading.value = false;
  }
}

async function goNext(): Promise<void> {
  if (submitting.value) return;
  if (step.value === 0) {
    const problem = validateStep1();
    if (problem !== undefined) {
      formError.value = problem;
      return;
    }
    step.value = 1;
    formError.value = undefined;
    scrollToWizard();
    return;
  }
  if (step.value === 1) {
    const problem = validateStep2();
    if (problem !== undefined) {
      formError.value = problem;
      return;
    }
    step.value = 2;
    formError.value = undefined;
    scrollToWizard();
    await ensurePreview();
    return;
  }
  await submit();
}

async function submit(): Promise<void> {
  const problem = validateStep2();
  if (problem !== undefined) {
    formError.value = problem;
    return;
  }
  submitting.value = true;
  formError.value = undefined;
  try {
    if (built.value === undefined) await ensurePreview();
    if (built.value === undefined) return;
    const created = await createContribution(built.value);
    receipt.value = created.data;
    ElMessage.success("候选已提交，等待独立审核。");
    await refreshContributions();
    scrollToWizard();
  } catch (caught) {
    formError.value = messageOf(caught, "提交失败，请稍后重试。");
  } finally {
    submitting.value = false;
  }
}

async function handleFileChange(file: UploadFile): Promise<void> {
  importError.value = undefined;
  const raw = file.raw;
  if (raw === undefined) {
    importError.value = "没有读到文件，请重新选择。";
    return;
  }
  if (!/\.(md|markdown|txt)$/iu.test(raw.name)) {
    importError.value = "只支持 .md / .markdown / .txt 文本文件。";
    return;
  }
  if (raw.size > MAX_IMPORT_BYTES) {
    importError.value = "浏览器直传上限为 2 MiB；更大的文件请使用接入 Worker。";
    return;
  }
  try {
    const content = await raw.text();
    if (content.trim().length === 0) {
      importError.value = "文件是空的，没有可导入的正文。";
      return;
    }
    form.content = content;
    if (form.title.trim().length === 0) {
      form.title = raw.name.replace(/\.[^.]+$/u, "");
    }
    ElMessage.success(`已导入 ${raw.name}`);
  } catch {
    importError.value = "文件读取失败，请确认它是 UTF-8 文本。";
  }
}

function resetWizard(): void {
  receipt.value = undefined;
  built.value = undefined;
  previewError.value = undefined;
  formError.value = undefined;
  importError.value = undefined;
  step.value = 0;
  form.assetType = "procedure";
  form.content = "";
  form.labels = "agent";
  form.rationale = DEFAULT_RATIONALE;
  form.spaceId = requestedSpace ?? DEFAULT_SPACE;
  form.summary = "";
  form.title = "";
  primarySourcesInput.value = "";
  evidenceInput.value = "";
}

const actionError = ref<string>();
const busyId = ref<string>();

const amendOpen = ref(false);
const amendTarget = ref<ContributionListItem>();
const amendEvidence = ref("");
const amendRationale = ref("补充审核所需的来源和验证材料。");
const amendBusy = ref(false);
const amendError = ref<string>();

function kindLabel(kind: ContributionListItem["receipt"]["kind"]): string {
  if (kind === "create") return "创建";
  if (kind === "revise") return "修订";
  if (kind === "deprecate") return "废弃";
  if (kind === "revoke") return "撤销";
  return "擦除";
}

function contributionTitle(item: ContributionListItem): string {
  const manifest = item.request.manifest;
  const title = manifest === undefined ? undefined : manifest["title"];
  return typeof title === "string" && title.trim().length > 0 ? title : kindLabel(item.receipt.kind);
}

function amendmentCount(item: ContributionListItem): number {
  return item.amendments.filter((entry) => Array.isArray(entry["evidenceRefs"])).length;
}

function canAmend(item: ContributionListItem): boolean {
  return item.receipt.status === "needs_evidence";
}

function canWithdraw(item: ContributionListItem): boolean {
  return !TERMINAL_STATUSES.has(item.receipt.status);
}

function openAmend(item: ContributionListItem): void {
  actionError.value = undefined;
  amendTarget.value = item;
  amendEvidence.value = "";
  amendRationale.value = "补充审核所需的来源和验证材料。";
  amendError.value = undefined;
  amendOpen.value = true;
}

async function submitAmend(): Promise<void> {
  const target = amendTarget.value;
  if (target === undefined) return;
  const refs = parseReferences(amendEvidence.value);
  if (refs.length === 0) {
    amendError.value = "至少填写一个有效的证据 URL。";
    return;
  }
  amendBusy.value = true;
  amendError.value = undefined;
  try {
    await amendContribution({
      contributionId: target.receipt.contributionId,
      etag: target.etag,
      evidenceRefs: refs,
      rationale: amendRationale.value.trim(),
    });
    amendOpen.value = false;
    ElMessage.success("补证已提交，等待审核者复核。");
    await refreshContributions();
  } catch (caught) {
    amendError.value = messageOf(caught, "补证失败，请稍后重试。");
  } finally {
    amendBusy.value = false;
  }
}

async function withdraw(item: ContributionListItem): Promise<void> {
  actionError.value = undefined;
  try {
    await ElMessageBox.confirm(
      "撤回后这条候选进入终态，不能恢复；如需继续，请重新提交一条新的候选。",
      "撤回这条候选？",
      { confirmButtonText: "确认撤回", cancelButtonText: "保留", type: "warning" },
    );
  } catch {
    return;
  }
  busyId.value = item.receipt.contributionId;
  try {
    await withdrawContribution({
      contributionId: item.receipt.contributionId,
      etag: item.etag,
      reason: "贡献者主动撤回，等待修正后重新提交。",
    });
    ElMessage.success("候选已撤回。");
    await refreshContributions();
  } catch (caught) {
    actionError.value = messageOf(caught, "撤回失败，请稍后重试。");
  } finally {
    busyId.value = undefined;
  }
}
</script>

<template>
  <PageHeader
    eyebrow="§ KNOWLEDGE CONTRIBUTION · 知识贡献"
    :title="receipt ? '候选已安全提交' : '贡献一条可治理的知识'"
    :subtitle="
      receipt
        ? '内容尚未进入 Published Channel；独立 Curator 必须先核验来源、边界与策略。'
        : '支持粘贴或导入本地文本文件；来源、证据与策略边界会一起进入候选，不会直接发布。'
    "
  >
    <template #actions>
      <RouterLink class="btn" to="/review"><ShieldCheck :size="15" /> 审核中心</RouterLink>
    </template>
  </PageHeader>

  <div class="split split-main-side">
    <div class="wizard-column">
      <section v-if="receipt" ref="wizardEl" class="panel receipt-panel">
        <div class="receipt-head">
          <span class="receipt-mark"><CheckCircle2 :size="22" aria-hidden="true" /></span>
          <div class="receipt-copy">
            <p class="eyebrow">Contribution Receipt</p>
            <h1>知识候选已安全提交</h1>
            <p>
              内容尚未进入 Published Channel。独立 Curator 必须先核验来源、边界和策略，之后才可能进入发布决策。
            </p>
          </div>
          <StatusBadge :status="receipt.status" />
        </div>

        <dl class="receipt-grid">
          <div>
            <dt>Contribution</dt>
            <dd :title="receipt.contributionId">{{ shortId(receipt.contributionId, 30) }}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd :title="receipt.subjectRevisionId">
              {{ shortId(receipt.subjectRevisionId, 30) }}
            </dd>
          </div>
          <div>
            <dt>Policy Epoch</dt>
            <dd>{{ receipt.policyEpoch }}</dd>
          </div>
          <div>
            <dt>Space</dt>
            <dd>{{ receipt.spaceId.split("/").at(-1) ?? receipt.spaceId }}</dd>
          </div>
          <div>
            <dt>动作</dt>
            <dd>{{ kindLabel(receipt.kind) }}</dd>
          </div>
          <div>
            <dt>提交时间</dt>
            <dd>{{ formatDate(receipt.createdAt) }}</dd>
          </div>
        </dl>

        <div class="receipt-url">
          <span>STATUS URL</span>
          <a :href="receipt.statusUrl" target="_blank" rel="noreferrer">{{ receipt.statusUrl }}</a>
        </div>

        <p class="receipt-foot">
          候选编号用于在「我的贡献」里跟踪补证与撤回；发布是 Publisher 的独立步骤，不会由提交触发。
        </p>

        <div class="receipt-actions">
          <RouterLink class="btn btn-primary" to="/review">
            前往审核中心 <ArrowRight :size="15" />
          </RouterLink>
          <button type="button" class="btn btn-ghost" @click="resetWizard">
            <Plus :size="15" /> 继续贡献
          </button>
        </div>
      </section>

      <section v-else ref="wizardEl" class="panel wizard-panel">
        <nav class="wizard-steps" aria-label="贡献步骤">
          <button
            v-for="(label, index) in STEPS"
            :key="label"
            type="button"
            class="wizard-step"
            :class="{ 'is-active': index === step, 'is-done': index < step }"
            :disabled="index > step"
            :aria-current="index === step ? 'step' : undefined"
            @click="goToStep(index)"
          >
            <span class="wizard-step-no">
              <Check v-if="index < step" :size="12" aria-hidden="true" />
              <template v-else>§0{{ index + 1 }}</template>
            </span>
            <span class="wizard-step-copy">
              <b>{{ label }}</b>
              <small>{{ index < step ? "已完成" : index === step ? "进行中" : "待填写" }}</small>
            </span>
          </button>
        </nav>
        <div class="wizard-progress" aria-hidden="true"><i :style="{ width: stepProgress }" /></div>

        <div class="wizard-body">
          <template v-if="step === 0">
            <div class="step-lead">
              <span class="step-no">§01</span>
              <div>
                <h2>先写清楚这条知识本身</h2>
                <p>标题说清 Agent 能完成什么；正文写给执行者，而不是写给评审。</p>
              </div>
            </div>

            <div class="field-grid cols-2">
              <div class="field">
                <label for="contribution-type">知识类型</label>
                <el-select id="contribution-type" v-model="form.assetType" class="control">
                  <el-option label="Procedure · 操作流程" value="procedure" />
                  <el-option label="Source Document · 来源文档" value="source_document" />
                </el-select>
                <small>类型决定采用的互操作 Profile。</small>
              </div>
              <div class="field">
                <label for="contribution-labels">标签</label>
                <el-input id="contribution-labels" v-model="form.labels" placeholder="agent, support" />
                <small>使用英文逗号分隔；标签会随 Manifest 一起签入。</small>
              </div>
            </div>

            <div class="field">
              <label for="contribution-title">标题</label>
              <el-input
                id="contribution-title"
                v-model="form.title"
                :maxlength="180"
                placeholder="清晰描述 Agent 可以完成的任务"
              />
              <small>一句话说明任务与适用对象，最多 180 字。</small>
            </div>

            <div class="field">
              <div class="field-head">
                <label for="contribution-summary">摘要</label>
                <span class="counter mono">{{ form.summary.length }}/600</span>
              </div>
              <el-input
                id="contribution-summary"
                v-model="form.summary"
                type="textarea"
                :rows="3"
                :maxlength="600"
                placeholder="说明这条知识解决什么问题、适用于谁"
              />
              <small>摘要会进入检索结果，读者先看到它。</small>
            </div>

            <div class="field">
              <div class="field-head">
                <label for="contribution-content">Markdown 正文</label>
                <span class="counter mono">{{ contentStats }}</span>
              </div>
              <el-input
                id="contribution-content"
                v-model="form.content"
                type="textarea"
                :rows="12"
                class="editor"
                :placeholder="CONTENT_PLACEHOLDER"
              />
              <small>正文作为 primary payload 上传；提交前浏览器会计算它的 SHA-256。</small>
            </div>

            <div class="import-row">
              <div class="import-copy">
                <FileText :size="16" aria-hidden="true" />
                <div>
                  <b>从本地文件导入</b>
                  <small>支持 UTF-8 Markdown 与纯文本（≤ 2 MiB）；文件只在浏览器读取，不会先上传。</small>
                </div>
              </div>
              <el-upload
                class="import-trigger"
                :auto-upload="false"
                :show-file-list="false"
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                :on-change="handleFileChange"
              >
                <button type="button" class="btn btn-sm"><Upload :size="13" /> 选择文件</button>
              </el-upload>
            </div>
            <div v-if="importError" class="form-error" role="alert">
              <TriangleAlert :size="14" aria-hidden="true" /> {{ importError }}
            </div>
          </template>

          <template v-else-if="step === 1">
            <div class="step-lead">
              <span class="step-no">§02</span>
              <div>
                <h2>边界与依据</h2>
                <p>来源、适用范围和负责人会随 Manifest 一起签入 Revision，之后修改就会产生新的修订。</p>
              </div>
            </div>

            <div class="note-block">
              <Info :size="15" aria-hidden="true" />
              <span>
                <b>边界会随 Manifest 一起签入 Revision。</b>
                更改标题、策略、内容或有效范围都会产生新的 Revision ID。
              </span>
            </div>

            <div class="field">
              <label for="contribution-space">知识空间</label>
              <el-input id="contribution-space" v-model="form.spaceId" class="control mono-input" />
              <small>Space 是权限、用途与治理策略的共同边界，必须是绝对 URI。</small>
            </div>

            <div class="field">
              <div class="field-head">
                <label for="contribution-rationale">贡献理由</label>
                <span class="counter mono">{{ form.rationale.trim().length }} 字</span>
              </div>
              <el-input
                id="contribution-rationale"
                v-model="form.rationale"
                type="textarea"
                :rows="4"
              />
              <small>审核者会基于此说明判断知识是否适合进入 Published Channel。</small>
            </div>

            <div class="field-grid cols-2">
              <div class="field">
                <label for="contribution-sources">原始来源 URL</label>
                <el-input
                  id="contribution-sources"
                  v-model="primarySourcesInput"
                  type="textarea"
                  :rows="4"
                  :placeholder="SOURCE_PLACEHOLDER"
                  class="mono-input"
                />
                <small>每行一个绝对 URL；会写入 provenance.primarySources 和 derived_from 关系。</small>
              </div>
              <div class="field">
                <label for="contribution-evidence">补充证据 URL</label>
                <el-input
                  id="contribution-evidence"
                  v-model="evidenceInput"
                  type="textarea"
                  :rows="4"
                  :placeholder="EVIDENCE_PLACEHOLDER"
                  class="mono-input"
                />
                <small>审核者会在证据区逐条核验，可以留空。</small>
              </div>
            </div>

            <section class="boundary" aria-label="默认边界与策略">
              <header class="boundary-head">
                <ShieldCheck :size="15" aria-hidden="true" />
                <b>默认边界与策略</b>
                <span>SIGNED INTO MANIFEST</span>
              </header>
              <dl class="boundary-grid">
                <div>
                  <dt>适用范围</dt>
                  <dd>zh-CN · CN · 当前知识空间</dd>
                </div>
                <div>
                  <dt>前提条件</dt>
                  <dd>由本地演示工作流创建，发布前必须独立审核</dd>
                </div>
                <div>
                  <dt>失效时间</dt>
                  <dd>提交后 90 天，需重新审核</dd>
                </div>
                <div>
                  <dt>负责人</dt>
                  <dd class="mono">urn:nian:development:contributor</dd>
                </div>
                <div>
                  <dt>用途</dt>
                  <dd class="mono">customer-support</dd>
                </div>
                <div>
                  <dt>分类</dt>
                  <dd>internal · 不导出</dd>
                </div>
                <div>
                  <dt>义务</dt>
                  <dd class="mono">cite · no-train</dd>
                </div>
                <div>
                  <dt>来源关系</dt>
                  <dd>derived_from · 每条来源一个</dd>
                </div>
              </dl>
              <p class="boundary-note">
                上述值由 Profile 默认 scope 与 policy 固定，页面只读展示；它们和正文一起构成候选的边界。
              </p>
            </section>
          </template>

          <template v-else>
            <div class="step-lead">
              <span class="step-no">§03</span>
              <div>
                <h2>确认提交</h2>
                <p>提交只创建 Candidate；审核与发布由独立角色完成。</p>
              </div>
            </div>

            <section class="review-summary">
              <div class="review-icon"><FileText :size="20" aria-hidden="true" /></div>
              <div class="review-title">
                <p class="eyebrow">准备生成候选</p>
                <h2>{{ form.title || "未命名知识" }}</h2>
                <p>{{ form.summary || "尚未填写摘要。" }}</p>
              </div>
            </section>

            <dl class="review-list">
              <div>
                <dt>动作</dt>
                <dd>创建（Create）</dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>{{ profileLabel }}</dd>
              </div>
              <div>
                <dt>Space</dt>
                <dd class="mono">{{ form.spaceId }}</dd>
              </div>
              <div>
                <dt>标签</dt>
                <dd>{{ form.labels.trim() || "—" }}</dd>
              </div>
              <div>
                <dt>来源 / 证据</dt>
                <dd>{{ sourceRefs.length }} / {{ evidenceRefs.length }}</dd>
              </div>
              <div>
                <dt>用途</dt>
                <dd class="mono">{{ DEFAULT_PURPOSES.join(" · ") }}</dd>
              </div>
              <div>
                <dt>分类 / 义务</dt>
                <dd>internal · cite · no-train</dd>
              </div>
              <div>
                <dt>失效时间</dt>
                <dd>提交后 90 天</dd>
              </div>
            </dl>

            <div class="revision-box">
              <div class="revision-head">
                <span>REVISION ID · 浏览器内计算</span>
                <span>{{ payloadSize }} bytes payload</span>
              </div>
              <template v-if="previewLoading">
                <p class="field-hint">正在计算摘要与 Revision ID…</p>
              </template>
              <template v-else-if="built">
                <code class="digest">{{ built.revisionId }}</code>
                <p class="field-hint">
                  由规范化 Manifest 的 SHA-256 得到；服务端会重新校验，不一致将被拒绝。
                </p>
              </template>
              <p v-else class="field-hint">尚未计算，进入这一步时会在浏览器内生成。</p>
            </div>

            <div v-if="previewError" class="form-error" role="alert">
              <TriangleAlert :size="14" aria-hidden="true" /> {{ previewError }}
            </div>

            <div class="note-block">
              <Fingerprint :size="15" aria-hidden="true" />
              <span>
                <b>浏览器将本地计算 SHA-256。</b>
                Payload 与规范化 Manifest 的摘要会在上传前生成，服务端将重新校验。
              </span>
            </div>
          </template>

          <div v-if="formError" class="form-error" role="alert">
            <TriangleAlert :size="14" aria-hidden="true" /> {{ formError }}
          </div>
        </div>

        <div class="wizard-actions">
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="step === 0 || submitting"
            @click="goBack"
          >
            <ArrowLeft :size="15" /> 上一步
          </button>
          <div class="wizard-actions-right">
            <span class="wizard-hint">{{ stepHint }}</span>
            <button
              v-if="step < STEPS.length - 1"
              type="button"
              class="btn"
              :disabled="submitting"
              @click="goNext()"
            >
              下一步 <ArrowRight :size="15" />
            </button>
            <button
              v-else
              type="button"
              class="btn btn-primary"
              :disabled="submitting || previewLoading"
              @click="goNext()"
            >
              <Sparkles :size="15" />
              {{ submitting ? "计算并提交中…" : "生成并提交候选" }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <aside class="wizard-aside">
      <section class="panel">
        <header class="panel-head">
          <div>
            <h2>发布前会发生什么？</h2>
            <p>候选之后的三道关口，任何一步都可能退回。</p>
          </div>
        </header>
        <ol class="guardrails">
          <li v-for="(gate, index) in GUARDRAILS" :key="gate.title">
            <span class="guardrail-no">{{ String(index + 1).padStart(2, "0") }}</span>
            <div>
              <b>{{ gate.title }}</b>
              <p>{{ gate.text }}</p>
            </div>
          </li>
        </ol>
        <div class="rail-note">
          <div class="note-block is-warn">
            <TriangleAlert :size="15" aria-hidden="true" />
            <span>
              提交只会创建 <b>Candidate</b>。发布由 Publisher 绑定当前 Policy Epoch 单独决策，不会随提交自动发生。
            </span>
          </div>
        </div>
      </section>

      <section class="panel tip-card">
        <div class="panel-body">
          <Sparkles :size="16" aria-hidden="true" />
          <div>
            <b>写给 Agent 的知识</b>
            <p>把前置条件、失败分支和禁止事项写清楚，比单纯增加篇幅更有价值。</p>
          </div>
        </div>
      </section>
    </aside>
  </div>

  <section class="panel contributions-panel">
    <header class="panel-head">
      <div>
        <p class="eyebrow">Contributor workspace</p>
        <h2>我的贡献</h2>
        <p>跟踪状态、审核意见和补证记录；终态历史不会被覆盖。</p>
      </div>
      <button type="button" class="btn btn-sm" :disabled="listLoading" @click="refreshContributions">
        <RefreshCw :size="13" /> 刷新
      </button>
    </header>

    <LoadingState v-if="listLoading" label="读取我的贡献" />
    <ErrorState v-else-if="listError" :error="listError" @retry="refreshContributions" />
    <EmptyState
      v-else-if="items.length === 0"
      title="还没有贡献记录"
      description="提交第一条候选后，它会出现在这里；补证与撤回都会留下记录，终态不会被覆盖。"
    />
    <template v-else>
      <div class="table-head">
        <span>知识 / 动作</span>
        <span>状态</span>
        <span>更新时间</span>
        <span class="is-right">操作</span>
      </div>
      <div class="row-list">
        <div v-for="item in items.slice(0, 8)" :key="item.receipt.contributionId" class="row">
          <div class="contrib-title">
            <span class="row-title truncate">{{ contributionTitle(item) }}</span>
            <span class="row-meta">
              {{ kindLabel(item.receipt.kind) }} ·
              {{ shortRevision(item.receipt.subjectRevisionId) }}
            </span>
          </div>
          <div class="contrib-state">
            <History :size="13" class="contrib-state-icon" aria-hidden="true" />
            <StatusBadge :status="item.receipt.status" />
            <small>{{ amendmentCount(item) }} 次补充</small>
          </div>
          <span class="row-time" :title="formatDate(item.updatedAt)">
            {{ formatRelativeTime(item.updatedAt) }}
          </span>
          <div class="contrib-actions">
            <button
              v-if="canAmend(item)"
              type="button"
              class="btn btn-sm"
              :disabled="busyId !== undefined"
              @click="openAmend(item)"
            >
              <Link2 :size="13" /> 补证
            </button>
            <button
              v-if="canWithdraw(item)"
              type="button"
              class="btn btn-sm btn-ghost"
              :disabled="busyId !== undefined"
              @click="withdraw(item)"
            >
              <XCircle :size="13" /> 撤回
            </button>
            <span v-if="!canAmend(item) && !canWithdraw(item)" class="faint">已进入终态</span>
          </div>
        </div>
      </div>
      <p v-if="items.length > 8" class="list-more">
        共 {{ items.length }} 条贡献，这里只显示最近 8 条。
      </p>
    </template>

    <div v-if="actionError" class="form-error contribution-error" role="alert">
      <TriangleAlert :size="14" aria-hidden="true" /> {{ actionError }}
    </div>
  </section>

  <el-dialog v-model="amendOpen" title="补充证据" width="520px" append-to-body>
    <div class="amend-form">
      <div class="amend-target">
        <p class="eyebrow">Amendment</p>
        <b>{{ amendTarget ? contributionTitle(amendTarget) : "" }}</b>
        <p>补证会形成 Amendment，不会修改原始候选请求。</p>
      </div>

      <div class="field">
        <label for="amend-evidence">证据 URL</label>
        <el-input
          id="amend-evidence"
          v-model="amendEvidence"
          type="textarea"
          :rows="3"
          placeholder="每行一个绝对 URL"
          class="mono-input"
        />
        <small>至少一个绝对 URL；审核者会逐条核验。</small>
      </div>

      <div class="field">
        <label for="amend-rationale">说明</label>
        <el-input id="amend-rationale" v-model="amendRationale" />
        <small>说明补了什么证据、为什么能回应审核意见。</small>
      </div>

      <div v-if="amendError" class="form-error" role="alert">
        <TriangleAlert :size="14" aria-hidden="true" /> {{ amendError }}
      </div>
    </div>

    <template #footer>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="amendOpen = false">取消</button>
        <button type="button" class="btn btn-primary" :disabled="amendBusy" @click="submitAmend">
          {{ amendBusy ? "提交中…" : "提交补证" }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ---------- 向导骨架 ---------- */
.wizard-column {
  min-width: 0;
}

.wizard-panel {
  overflow: hidden;
}

.wizard-panel,
.receipt-panel {
  scroll-margin-top: calc(var(--topbar-height) + 16px);
}

.wizard-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid var(--line);
}

.wizard-step {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: 13px 16px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  text-align: left;
  transition: color 0.15s var(--ease), background 0.15s var(--ease);
}

.wizard-step:last-child {
  border-right: 0;
}

.wizard-step:disabled {
  cursor: default;
}

.wizard-step:not(:disabled):hover {
  background: var(--paper);
}

.wizard-step.is-done {
  color: var(--ink-2);
}

.wizard-step.is-active {
  background: var(--card-warm);
  color: var(--ink);
}

.wizard-step-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  color: var(--faint);
  font: 600 10.5px/1 var(--mono);
  letter-spacing: 0.08em;
}

.wizard-step.is-active .wizard-step-no {
  color: var(--accent);
}

.wizard-step.is-done .wizard-step-no {
  color: var(--jade);
}

.wizard-step-copy b {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.wizard-step-copy small {
  display: block;
  margin-top: 3px;
  color: var(--faint);
  font: 500 10px/1 var(--mono);
  letter-spacing: 0.06em;
}

.wizard-progress {
  height: 2px;
  background: var(--line-soft);
}

.wizard-progress i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.25s var(--ease);
}

.wizard-body {
  display: grid;
  gap: var(--gap);
  padding: 20px 20px 18px;
}

.step-lead {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.step-no {
  padding-top: 2px;
  color: var(--accent);
  font: 600 10.5px/1.6 var(--mono);
  letter-spacing: 0.1em;
}

.step-lead h2 {
  font-size: 16px;
  letter-spacing: -0.2px;
}

.step-lead p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}

/* ---------- 字段 ---------- */
.field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-sm);
}

.field-head label {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
}

.counter {
  color: var(--faint);
  font-size: 10.5px;
  letter-spacing: 0.02em;
}

.control,
.mono-input {
  width: 100%;
}

.mono-input :deep(.el-input__inner),
.mono-input :deep(.el-textarea__inner) {
  font-family: var(--mono);
  font-size: 12px;
}

.editor :deep(.el-textarea__inner) {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.75;
}

/* ---------- 本地文件导入 ---------- */
.import-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  padding: 12px 14px;
  border: 1px dashed var(--line-2);
  border-radius: var(--radius);
  background: var(--paper);
}

.import-copy {
  display: flex;
  align-items: flex-start;
  gap: var(--gap-sm);
  min-width: 0;
  color: var(--muted);
}

.import-copy > svg {
  margin-top: 2px;
  color: var(--faint);
}

.import-copy b {
  display: block;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
}

.import-copy small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.6;
}

.import-trigger :deep(.el-upload) {
  display: block;
}

/* ---------- 边界预览 ---------- */
.boundary {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card-warm);
  overflow: hidden;
}

.boundary-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--ink-2);
}

.boundary-head > svg {
  color: var(--jade);
}

.boundary-head b {
  font-size: 12.5px;
  font-weight: 600;
}

.boundary-head span {
  margin-left: auto;
  color: var(--faint);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.1em;
}

.boundary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--line-soft);
}

.boundary-grid > div {
  padding: 9px 14px;
  background: var(--card-warm);
}

.boundary-grid dt {
  color: var(--faint);
  font: 500 10.5px/1.4 var(--mono);
  letter-spacing: 0.05em;
}

.boundary-grid dd {
  margin-top: 3px;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.boundary-note {
  padding: 10px 14px;
  border-top: 1px solid var(--line-soft);
  color: var(--faint);
  font-size: 11.5px;
  line-height: 1.6;
}

/* ---------- 确认页 ---------- */
.review-summary {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.review-icon {
  display: grid;
  flex: 0 0 36px;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--muted);
}

.review-title {
  min-width: 0;
}

.review-title .eyebrow {
  margin-bottom: 6px;
}

.review-title h2 {
  font-size: 18px;
  letter-spacing: -0.2px;
  overflow-wrap: anywhere;
}

.review-title p:last-child {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.review-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--line-soft);
  overflow: hidden;
}

.review-list > div {
  padding: 9px 14px;
  background: var(--card);
}

.review-list dt {
  color: var(--faint);
  font: 500 10.5px/1.4 var(--mono);
  letter-spacing: 0.05em;
}

.review-list dd {
  margin-top: 3px;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.revision-box {
  padding: 12px 14px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background: var(--paper);
}

.revision-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-sm);
  color: var(--faint);
  font: 600 10px/1 var(--mono);
  letter-spacing: 0.1em;
}

.digest {
  display: block;
  margin: 8px 0 6px;
  color: var(--ink);
  font: 500 11.5px/1.65 var(--mono);
  overflow-wrap: anywhere;
}

/* ---------- 向导底部 ---------- */
.wizard-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  padding: 14px 20px;
  border-top: 1px solid var(--line);
  background: var(--card-warm);
}

.wizard-actions-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.wizard-hint {
  max-width: 320px;
  color: var(--faint);
  font-size: 11px;
  line-height: 1.5;
  text-align: right;
}

/* ---------- 右栏 ---------- */
.wizard-aside {
  display: grid;
  gap: var(--gap);
}

.guardrails li {
  display: flex;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.guardrails li:last-child {
  border-bottom: 0;
}

.guardrail-no {
  color: var(--faint);
  font: 600 10.5px/1.7 var(--mono);
  letter-spacing: 0.08em;
}

.guardrails b {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.guardrails p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.65;
}

.rail-note {
  padding: 0 18px 16px;
}

.rail-note .note-block {
  font-size: 11.5px;
  line-height: 1.65;
}

.rail-note .note-block > svg {
  color: var(--gold);
}

.tip-card .panel-body {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--muted);
}

.tip-card .panel-body > svg {
  margin-top: 1px;
  color: var(--accent);
}

.tip-card b {
  display: block;
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
}

.tip-card p {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.7;
}

/* ---------- 回执 ---------- */
.receipt-panel {
  overflow: hidden;
}

.receipt-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px;
  border-bottom: 1px solid var(--line);
}

.receipt-mark {
  display: grid;
  flex: 0 0 40px;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--jade-line);
  border-radius: 50%;
  background: var(--jade-soft);
  color: var(--jade);
}

.receipt-copy {
  flex: 1;
  min-width: 0;
}

.receipt-copy .eyebrow {
  margin-bottom: 8px;
}

.receipt-copy h1 {
  font-size: 22px;
  letter-spacing: -0.3px;
}

.receipt-copy p:last-child {
  max-width: 560px;
  margin-top: 7px;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.7;
}

.receipt-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--line-soft);
}

.receipt-grid > div {
  padding: 11px 20px;
  background: var(--card);
}

.receipt-grid dt {
  color: var(--faint);
  font: 500 10px/1.4 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.receipt-grid dd {
  margin-top: 4px;
  color: var(--ink);
  font: 500 12px/1.5 var(--mono);
  overflow-wrap: anywhere;
}

.receipt-url {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 11px 20px;
  border-top: 1px solid var(--line-soft);
}

.receipt-url span {
  flex: 0 0 auto;
  color: var(--faint);
  font: 600 10px/1 var(--mono);
  letter-spacing: 0.1em;
}

.receipt-url a {
  color: var(--accent);
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

.receipt-url a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.receipt-foot {
  padding: 0 20px 14px;
  color: var(--faint);
  font-size: 11.5px;
  line-height: 1.65;
}

.receipt-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
  background: var(--card-warm);
}

/* ---------- 我的贡献 ---------- */
.contributions-panel {
  margin-top: var(--gap);
}

.contributions-panel .panel-head .eyebrow {
  margin-bottom: 6px;
}

.contributions-panel .table-head,
.contributions-panel .row {
  grid-template-columns: minmax(0, 1fr) 172px 112px 152px;
}

.contributions-panel .table-head .is-right {
  text-align: right;
}

.contributions-panel .row {
  align-items: center;
}

.contrib-title {
  min-width: 0;
}

.contrib-state {
  display: flex;
  align-items: center;
  gap: 7px;
}

.contrib-state-icon {
  color: var(--faint);
}

.contrib-state small {
  color: var(--faint);
  font: 500 10.5px/1 var(--mono);
  white-space: nowrap;
}

.contrib-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.contribution-error {
  margin: 12px 18px;
}

/* ---------- 补证弹窗 ---------- */
.amend-form {
  display: grid;
  gap: 14px;
}

.amend-target {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line-soft);
}

.amend-target .eyebrow {
  margin-bottom: 6px;
}

.amend-target b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.amend-target p:last-child {
  margin-top: 4px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.65;
}

.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

/* ---------- 窄屏 ---------- */
@media (max-width: 1180px) {
  .wizard-hint {
    display: none;
  }
}

@media (max-width: 720px) {
  .wizard-step {
    padding: 11px 12px;
  }

  .wizard-step-copy small {
    display: none;
  }

  .wizard-body {
    padding: 16px 14px;
  }

  .wizard-actions {
    flex-direction: column;
    align-items: stretch;
    padding: 12px 14px;
  }

  .wizard-actions-right {
    justify-content: space-between;
  }

  .wizard-actions-right .btn {
    flex: 1;
  }

  .import-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .boundary-grid,
  .review-list,
  .receipt-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .receipt-head {
    flex-wrap: wrap;
  }

  .receipt-actions .btn {
    flex: 1;
  }

  .contributions-panel .table-head {
    display: none;
  }

  .contributions-panel .row {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .contrib-actions {
    justify-content: flex-start;
  }
}
</style>
