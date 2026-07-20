<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  AlertOctagon,
  BookOpenText,
  Check,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  FileQuestion,
  Link2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-vue-next";
import {
  ApiProblem,
  contributionEvidenceRefs,
  getContributions,
  getRevisionDetail,
  reviewContribution,
} from "@/api/client";
import type { ContributionListItem } from "@/api/types";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { daysSince, formatDateTime, formatRelativeTime, shortId } from "@/utils/format";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatusBadge from "@/components/StatusBadge.vue";

const CHECKS = [
  "已阅读候选正文和所有变更",
  "已核对适用用途、地区、有效期和义务",
  "已检查来源、证据及其独立性",
  "已确认失败分支、禁止事项和潜在伤害",
] as const;

type ReviewDecision = "verify" | "request_evidence" | "reject" | "quarantine";

const KIND_LABELS: Readonly<Record<string, string>> = {
  create: "新建",
  revise: "修订",
  deprecate: "废弃",
  revoke: "撤销",
  erase: "擦除",
};

const DECISION_TOASTS: Readonly<Record<ReviewDecision, string>> = {
  verify: "已核验通过，等待发布决策",
  request_evidence: "已退回，等待贡献者补充证据",
  reject: "已拒绝该候选",
  quarantine: "已隔离该候选",
};

type ContentScanSeverity = "high" | "medium" | "low" | "unknown";
type ContentScanVerdict = "clean" | "review" | "quarantined" | "unknown";

interface ContentScanFindingView {
  readonly code: string;
  readonly end?: number;
  readonly message: string;
  readonly payloadName: string;
  readonly severity: ContentScanSeverity;
  readonly start?: number;
}

interface ContentScanView {
  readonly findingCount: number;
  readonly findings: readonly ContentScanFindingView[];
  readonly findingsTruncated: boolean;
  readonly offsetUnit: string;
  readonly scannerVersion: string;
  readonly verdict: ContentScanVerdict;
}

interface LineDiffAnalysis {
  readonly afterLines: readonly string[];
  readonly beforeLines: readonly string[];
  readonly commonPrefixLines: number;
  readonly commonSuffixLines: number;
}

interface DiffLine {
  readonly kind: "add" | "remove" | "same";
  readonly text: string;
}

type MachineTone = "pass" | "warn" | "block" | "muted";

interface MachineCheck {
  readonly label: string;
  readonly value: string;
  readonly tone: MachineTone;
}

const LARGE_DIFF_CHARACTER_THRESHOLD = 200_000;
const LARGE_DIFF_LINE_THRESHOLD = 4_000;

const { data, error, loading, refresh } = useAsyncResource<readonly ContributionListItem[]>(
  () => getContributions("curator"),
);

const selectedId = ref<string | undefined>(undefined);
const rationale = ref("已核验正文、来源、适用边界、失败分支和策略义务。");
const checks = ref<boolean[]>(CHECKS.map(() => false));
const scanAcknowledged = ref(false);
const acting = ref<ReviewDecision | undefined>(undefined);
const actionError = ref<string | undefined>(undefined);
const stale = ref(false);
const targetContent = ref<string | undefined>(undefined);
const parentContent = ref<string | undefined>(undefined);
const contentContributionId = ref<string | undefined>(undefined);
const contentLoading = ref(false);
const openPanels = ref<string[]>([]);
let contentRequest = 0;

const queue = computed<readonly ContributionListItem[]>(() =>
  (data.value ?? []).filter((item) =>
    ["candidate", "needs_evidence", "quarantined"].includes(item.receipt.status),
  ),
);

const selected = computed<ContributionListItem | undefined>(
  () =>
    queue.value.find((item) => item.receipt.contributionId === selectedId.value) ?? queue.value[0],
);

const evidenceRefs = computed<readonly string[]>(() =>
  selected.value === undefined ? [] : contributionEvidenceRefs(selected.value),
);

const contentScan = computed<ContentScanView | undefined>(() => readContentScan(selected.value));
const scanTone = computed<ContentScanVerdict>(() => contentScan.value?.verdict ?? "unknown");
const scanFindings = computed<readonly ContentScanFindingView[]>(
  () => contentScan.value?.findings ?? [],
);

const scanDescription = computed(() => {
  const scan = contentScan.value;
  if (scan === undefined) return "此贡献没有可展示的同步扫描记录。";
  if (scan.verdict === "clean") return "同步静态扫描未发现命中项。";
  if (scan.verdict === "review") return "发现项需要人工逐条复核；候选正文始终是不可信数据。";
  if (scan.verdict === "quarantined") return "扫描命中高风险内容，原文已隔离且不可通过。";
  return "扫描记录格式无法识别，安全门禁将其按阻断处理。";
});

const offsetLabel = computed(() => {
  const unit = contentScan.value?.offsetUnit;
  if (unit === undefined) return "";
  return unit === "utf8-byte" ? "UTF-8 字节" : unit;
});

const scanTruncated = computed(() => {
  const scan = contentScan.value;
  if (scan === undefined) return false;
  return scan.findingsTruncated || scan.findingCount > scan.findings.length;
});

const contentRequiresScan = computed(
  () =>
    selected.value?.receipt.kind === "create" || selected.value?.receipt.kind === "revise",
);

const isQuarantined = computed(
  () =>
    selected.value?.receipt.status === "quarantined" ||
    contentScan.value?.verdict === "quarantined",
);

const scanRecordInvalid = computed(
  () =>
    contentScan.value?.verdict === "unknown" ||
    (contentRequiresScan.value && contentScan.value === undefined),
);

const scanBlocksVerification = computed(
  () => isQuarantined.value || scanRecordInvalid.value,
);

const requiresScanAcknowledgement = computed(() => contentScan.value?.verdict === "review");

const detailId = computed(() => selected.value?.receipt.contributionId);
const detailStatus = computed(() => selected.value?.receipt.status ?? "");
const detailKindLabel = computed(() =>
  selected.value === undefined ? "" : kindLabelOf(selected.value.receipt.kind),
);
const detailTitle = computed(() =>
  selected.value === undefined ? "" : titleOf(selected.value),
);
const detailSummary = computed(() =>
  selected.value === undefined ? "" : summaryOf(selected.value),
);
const detailSpace = computed(() =>
  selected.value === undefined ? "—" : spaceTailOf(selected.value),
);
const detailRevision = computed(() => selected.value?.receipt.subjectRevisionId);
const detailUpdatedAt = computed(() => selected.value?.updatedAt);
const detailRationale = computed(() => selected.value?.request.rationale ?? "—");
const detailAge = computed(() =>
  selected.value === undefined ? "—" : ageLabel(selected.value.updatedAt),
);
const detailEtag = computed(() => selected.value?.etag ?? "");

const manifestJson = computed(() => {
  const manifest = selected.value?.request.manifest;
  return manifest === undefined ? undefined : JSON.stringify(manifest, null, 2);
});

const machineChecks = computed<readonly MachineCheck[]>(() => {
  const item = selected.value;
  if (item === undefined) return [];
  const scan = contentScan.value;
  const rows: MachineCheck[] = [
    { label: "Manifest / Profile", value: "服务端已接受", tone: "pass" },
    {
      label: "Payload Digest",
      value:
        item.payloads.length > 0
          ? "已核验"
          : isQuarantined.value
            ? "高风险原文未持久化"
            : "生命周期动作不含新 Payload",
      tone: item.payloads.length > 0 ? "pass" : isQuarantined.value ? "warn" : "muted",
    },
    {
      label: "静态内容扫描",
      value: scan === undefined ? "不适用" : `${scan.verdict} · ${scan.findingCount} 个发现`,
      tone: scan === undefined ? "muted" : machineToneOfScan(scan.verdict),
    },
    {
      label: "外部恶意文件扫描",
      value: "同步文本路径未替代，非文本已拒绝进入",
      tone: "muted",
    },
    { label: "Revision", value: shortId(item.receipt.subjectRevisionId, 30), tone: "muted" },
  ];
  return rows;
});

const allChecked = computed(
  () =>
    checks.value.every(Boolean) &&
    (!requiresScanAcknowledgement.value || scanAcknowledged.value) &&
    !scanBlocksVerification.value,
);

const contentIsCurrent = computed(
  () =>
    selected.value !== undefined &&
    contentContributionId.value === selected.value.receipt.contributionId,
);

const checkedCount = computed(() => checks.value.filter(Boolean).length);

const contentStats = computed(() => {
  const text = targetContent.value;
  if (text === undefined) return undefined;
  return {
    chars: text.length.toLocaleString("zh-CN"),
    lines: text.split("\n").length.toLocaleString("zh-CN"),
  };
});

const diffAnalysis = computed<LineDiffAnalysis | undefined>(() => {
  const before = parentContent.value;
  const after = targetContent.value;
  if (before === undefined || after === undefined) return undefined;
  return analyzeLineDiff(before, after);
});

const largeDiff = computed(() => {
  const analysis = diffAnalysis.value;
  const before = parentContent.value;
  const after = targetContent.value;
  if (analysis === undefined || before === undefined || after === undefined) return false;
  return (
    before.length + after.length > LARGE_DIFF_CHARACTER_THRESHOLD ||
    analysis.beforeLines.length + analysis.afterLines.length > LARGE_DIFF_LINE_THRESHOLD
  );
});

const largeDiffStats = computed(() => {
  const analysis = diffAnalysis.value;
  if (analysis === undefined || !largeDiff.value) return undefined;
  return {
    afterChars: (targetContent.value ?? "").length.toLocaleString("zh-CN"),
    afterChanged:
      analysis.afterLines.length - analysis.commonPrefixLines - analysis.commonSuffixLines,
    afterLines: analysis.afterLines.length.toLocaleString("zh-CN"),
    beforeChars: (parentContent.value ?? "").length.toLocaleString("zh-CN"),
    beforeChanged:
      analysis.beforeLines.length - analysis.commonPrefixLines - analysis.commonSuffixLines,
    beforeLines: analysis.beforeLines.length.toLocaleString("zh-CN"),
  };
});

const diffRows = computed<readonly DiffLine[]>(() => {
  const analysis = diffAnalysis.value;
  if (analysis === undefined || largeDiff.value) return [];
  return diffLinesFromAnalysis(analysis);
});

const canDecide = computed(
  () =>
    !scanBlocksVerification.value &&
    acting.value === undefined &&
    rationale.value.trim().length >= 8,
);

const canVerify = computed(
  () =>
    canDecide.value &&
    allChecked.value &&
    contentIsCurrent.value &&
    targetContent.value !== undefined,
);

const decisionHint = computed(() => {
  if (scanBlocksVerification.value) return "";
  if (contentLoading.value || !contentIsCurrent.value) return "正在读取版本正文，完成后才能核验通过。";
  if (targetContent.value === undefined) return "目标正文不可用，不能核验通过。";
  if (rationale.value.trim().length < 8) return "请填写至少 8 个字的审核理由。";
  const remaining = CHECKS.length - checkedCount.value;
  if (remaining > 0) return `还需完成 ${remaining} 项人工核验。`;
  if (requiresScanAcknowledgement.value && !scanAcknowledged.value) {
    return "还需确认内容安全发现后才能核验通过。";
  }
  return "核验项已齐备，可以生成不可变审核证明。";
});

watch(
  () => selected.value?.receipt.contributionId,
  () => {
    void syncContent();
  },
  { immediate: true },
);

async function syncContent(): Promise<void> {
  const requestId = ++contentRequest;
  checks.value = CHECKS.map(() => false);
  scanAcknowledged.value = false;
  actionError.value = undefined;
  stale.value = false;
  targetContent.value = undefined;
  parentContent.value = undefined;
  contentLoading.value = false;
  openPanels.value = [];
  const item = selected.value;
  contentContributionId.value = item?.receipt.contributionId;
  if (item === undefined) return;
  if (scanBlocksVerification.value) return;

  const inline = payloadText(item);
  if (inline.length > 0) targetContent.value = inline;
  const parents = parentRevisions(item);
  const needsTargetRead = inline.length === 0;
  if (!needsTargetRead && parents.length === 0) return;

  contentLoading.value = true;
  try {
    const [target, parent] = await Promise.all([
      needsTargetRead
        ? getRevisionDetail(item.receipt.spaceId, item.receipt.subjectRevisionId)
        : Promise.resolve(undefined),
      parents[0] === undefined
        ? Promise.resolve(undefined)
        : getRevisionDetail(item.receipt.spaceId, parents[0]),
    ]);
    if (requestId !== contentRequest) return;
    if (target !== undefined) targetContent.value = target.content;
    if (parent !== undefined) parentContent.value = parent.content;
  } catch (caught) {
    if (requestId !== contentRequest) return;
    actionError.value = caught instanceof Error ? caught.message : "无法读取版本正文";
  } finally {
    if (requestId === contentRequest) contentLoading.value = false;
  }
}

async function decide(decision: ReviewDecision): Promise<void> {
  const item = selected.value;
  if (item === undefined) return;
  if (scanBlocksVerification.value) {
    actionError.value = "该贡献已被内容安全门禁隔离，不能再执行审核决策。";
    stale.value = false;
    return;
  }
  const trimmed = rationale.value.trim();
  if (trimmed.length < 8) {
    actionError.value = "所有审核决策都需要具体理由（至少 8 个字）。";
    stale.value = false;
    return;
  }
  if (decision === "verify" && !allChecked.value) {
    actionError.value =
      requiresScanAcknowledgement.value && !scanAcknowledged.value
        ? "请逐项阅读内容安全发现，并确认正文始终作为不可信内容处理。"
        : "完成全部核验项并填写具体审核理由后，才能核验通过。";
    stale.value = false;
    return;
  }

  acting.value = decision;
  actionError.value = undefined;
  stale.value = false;
  try {
    await reviewContribution({
      // 证明由节点依据真实执行的检查与本次已签名的 Curator 决策派生。
      attestationRefs: [],
      contributionId: item.receipt.contributionId,
      decision,
      etag: item.etag,
      rationale: trimmed,
    });
    ElMessage.success(DECISION_TOASTS[decision]);
    selectedId.value = undefined;
    await refresh();
  } catch (caught) {
    if (caught instanceof ApiProblem && caught.status === 412) {
      stale.value = true;
      actionError.value = `该贡献的 ETag 已变化（412 ${caught.code}），本次决策未生效。刷新队列后请重新阅读最新版本。`;
    } else {
      actionError.value = caught instanceof Error ? caught.message : "审核决策失败";
    }
    ElMessage.error("审核决策未提交，请查看页面提示。");
  } finally {
    acting.value = undefined;
  }
}

async function reload(): Promise<void> {
  actionError.value = undefined;
  stale.value = false;
  await refresh();
}

function setCheck(index: number, value: unknown): void {
  checks.value[index] = value === true;
}

function isSelected(item: ContributionListItem): boolean {
  return selected.value?.receipt.contributionId === item.receipt.contributionId;
}

function checkIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function kindLabelOf(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function machineToneOfScan(verdict: ContentScanVerdict): MachineTone {
  if (verdict === "clean") return "pass";
  if (verdict === "review") return "warn";
  if (verdict === "quarantined" || verdict === "unknown") return "block";
  return "muted";
}

function spaceTailOf(item: ContributionListItem): string {
  const tail = item.receipt.spaceId.split("/").at(-1);
  return tail === undefined || tail.length === 0 ? item.receipt.spaceId : tail;
}

function ageLabel(value: string): string {
  const days = daysSince(value);
  if (days === undefined) return "—";
  if (days === 0) return "今天";
  return `${days} 天`;
}

function diffMarker(kind: DiffLine["kind"]): string {
  return kind === "same" ? " " : kind === "add" ? "+" : "−";
}

function titleOf(item: ContributionListItem): string {
  const title = item.request.manifest?.["title"];
  if (typeof title === "string" && title.trim().length > 0) return title;
  return `${kindLabelOf(item.receipt.kind)} · ${shortId(item.receipt.subjectRevisionId)}`;
}

function summaryOf(item: ContributionListItem): string {
  const summary = item.request.manifest?.["summary"];
  if (typeof summary === "string" && summary.trim().length > 0) return summary;
  return `对目标 Revision 执行 ${kindLabelOf(item.receipt.kind)}治理动作。`;
}

function readContentScan(item: ContributionListItem | undefined): ContentScanView | undefined {
  const record = item?.amendments.find((amendment) => amendment["kind"] === "content-scan");
  if (record === undefined) return undefined;
  const rawFindings = Array.isArray(record["findings"]) ? record["findings"] : [];
  const findings = rawFindings.map((value, index): ContentScanFindingView => {
    const finding = isRecord(value) ? value : {};
    return {
      code: typeof finding["code"] === "string" ? finding["code"] : `unknown.${index + 1}`,
      ...(typeof finding["end"] === "number" && Number.isFinite(finding["end"])
        ? { end: finding["end"] }
        : {}),
      message:
        typeof finding["message"] === "string"
          ? finding["message"]
          : "扫描器未提供可读说明。",
      payloadName:
        typeof finding["payloadName"] === "string" ? finding["payloadName"] : "未标识",
      severity: scanSeverity(finding["severity"]),
      ...(typeof finding["start"] === "number" && Number.isFinite(finding["start"])
        ? { start: finding["start"] }
        : {}),
    };
  });
  const rawCount = record["findingCount"];
  const reportedCount =
    typeof rawCount === "number" && Number.isSafeInteger(rawCount) && rawCount >= 0
      ? rawCount
      : findings.length;
  return {
    findingCount: Math.max(reportedCount, findings.length),
    findings,
    findingsTruncated: record["findingsTruncated"] === true,
    offsetUnit: typeof record["offsetUnit"] === "string" ? record["offsetUnit"] : "unknown",
    scannerVersion:
      typeof record["scannerVersion"] === "string"
        ? record["scannerVersion"]
        : "未标识扫描器",
    verdict: scanVerdict(record["verdict"]),
  };
}

function scanSeverity(value: unknown): ContentScanSeverity {
  return value === "high" || value === "medium" || value === "low" ? value : "unknown";
}

function scanVerdict(value: unknown): ContentScanVerdict {
  return value === "clean" || value === "review" || value === "quarantined" ? value : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadText(item: ContributionListItem): string {
  const payload = item.payloads.find(
    (candidate) => candidate.name === "primary" && candidate.mediaType.startsWith("text/"),
  );
  if (payload === undefined) return "";
  try {
    const bytes = Uint8Array.from(atob(payload.data), (value) => value.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function parentRevisions(item: ContributionListItem): readonly string[] {
  const parents = item.request.manifest?.["parents"];
  return Array.isArray(parents)
    ? parents.filter((value): value is string => typeof value === "string")
    : [];
}

function analyzeLineDiff(before: string, after: string): LineDiffAnalysis {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const sharedLength = Math.min(beforeLines.length, afterLines.length);
  let commonPrefixLines = 0;
  while (
    commonPrefixLines < sharedLength &&
    beforeLines[commonPrefixLines] === afterLines[commonPrefixLines]
  ) {
    commonPrefixLines += 1;
  }
  let commonSuffixLines = 0;
  while (
    commonSuffixLines < sharedLength - commonPrefixLines &&
    beforeLines[beforeLines.length - commonSuffixLines - 1] ===
      afterLines[afterLines.length - commonSuffixLines - 1]
  ) {
    commonSuffixLines += 1;
  }
  return { afterLines, beforeLines, commonPrefixLines, commonSuffixLines };
}

function diffLinesFromAnalysis(analysis: LineDiffAnalysis): readonly DiffLine[] {
  const { afterLines, beforeLines, commonPrefixLines, commonSuffixLines } = analysis;
  const result: DiffLine[] = [];
  for (let index = 0; index < commonPrefixLines; index += 1) {
    result.push({ kind: "same", text: beforeLines[index] ?? "" });
  }
  const beforeMiddleEnd = beforeLines.length - commonSuffixLines;
  for (let index = commonPrefixLines; index < beforeMiddleEnd; index += 1) {
    result.push({ kind: "remove", text: beforeLines[index] ?? "" });
  }
  const afterMiddleEnd = afterLines.length - commonSuffixLines;
  for (let index = commonPrefixLines; index < afterMiddleEnd; index += 1) {
    result.push({ kind: "add", text: afterLines[index] ?? "" });
  }
  for (let index = beforeMiddleEnd; index < beforeLines.length; index += 1) {
    result.push({ kind: "same", text: beforeLines[index] ?? "" });
  }
  return result;
}
</script>

<template>
  <LoadingState v-if="loading && data === undefined" label="正在读取待审核贡献" />
  <ErrorState v-else-if="error && data === undefined" :error="error" @retry="reload" />
  <template v-else>
    <PageHeader
      eyebrow="Independent Review"
      title="审核中心"
      subtitle="先阅读正文、扫描发现、证据和版本差异；服务端只为实际完成的检查生成不可变证明。"
    >
      <template #actions>
        <button class="btn" :disabled="loading" @click="reload">
          <RefreshCw :size="15" :class="{ 'is-spinning': loading }" aria-hidden="true" /> 刷新队列
        </button>
      </template>
    </PageHeader>

    <ErrorState v-if="error" class="workspace-error" :error="error" @retry="reload" />

    <div class="split review-workspace">
      <section class="panel review-queue" aria-label="待审核队列">
        <header class="queue-head">
          <div class="queue-total">
            <strong>{{ queue.length }}</strong>
            <span>个待审核或已隔离候选</span>
          </div>
          <span class="role-tag is-curator queue-role">
            <ShieldCheck :size="13" aria-hidden="true" /> Curator
          </span>
        </header>

        <div v-if="queue.length > 0" class="queue-list" role="listbox" aria-label="待审核候选">
          <button
            v-for="item in queue"
            :key="item.receipt.contributionId"
            type="button"
            role="option"
            class="queue-row"
            :class="{ 'is-active': isSelected(item) }"
            :aria-selected="isSelected(item)"
            @click="selectedId = item.receipt.contributionId"
          >
            <span class="queue-mark"><BookOpenText :size="16" aria-hidden="true" /></span>
            <span class="queue-copy">
              <strong class="truncate">{{ titleOf(item) }}</strong>
              <small class="truncate">
                {{ kindLabelOf(item.receipt.kind) }} · {{ spaceTailOf(item) }} ·
                {{ formatRelativeTime(item.updatedAt) }}
              </small>
            </span>
            <StatusBadge :status="item.receipt.status" />
            <ChevronRight class="queue-chevron" :size="15" aria-hidden="true" />
          </button>
        </div>

        <EmptyState
          v-else
          title="审核队列已清空"
          description="新的知识候选出现后会在这里等待独立决策。"
        >
          <template #icon><Check :size="19" aria-hidden="true" /></template>
        </EmptyState>

        <footer class="queue-foot">
          <ShieldCheck :size="13" aria-hidden="true" />
          <span>平台不会自动发布未经审核的知识。</span>
        </footer>
      </section>

      <section class="panel review-detail">
        <template v-if="selected">
          <header class="detail-head">
            <div class="detail-top">
              <div class="chip-row">
                <span class="kind-chip">{{ detailKindLabel }}</span>
                <StatusBadge :status="detailStatus" />
                <span class="space-chip">{{ detailSpace }}</span>
              </div>
              <el-tooltip :content="detailId ?? ''" placement="top">
                <span class="id-chip mono">{{ shortId(detailId, 24) }}</span>
              </el-tooltip>
            </div>

            <h2 class="detail-title">{{ detailTitle }}</h2>
            <p class="review-summary">{{ detailSummary }}</p>

            <dl class="detail-byline">
              <div>
                <dt>提交者</dt>
                <dd>贡献者 <em>CONTRIBUTOR</em></dd>
              </div>
              <div>
                <dt>提交时间</dt>
                <dd>{{ formatDateTime(detailUpdatedAt) }}</dd>
              </div>
              <div>
                <dt>空间</dt>
                <dd class="mono">{{ detailSpace }}</dd>
              </div>
              <div>
                <dt>停留</dt>
                <dd>{{ detailAge }}</dd>
              </div>
            </dl>
          </header>

          <div class="detail-body">
            <div v-if="scanBlocksVerification" class="gate-alert" role="alert">
              <AlertOctagon :size="20" aria-hidden="true" />
              <div>
                <strong>
                  {{
                    isQuarantined
                      ? "内容已隔离，审核通过通道已关闭"
                      : "扫描记录缺失或无法识别，审核通道已关闭"
                  }}
                </strong>
                <p>
                  {{
                    isQuarantined
                      ? "高风险原文不会进入共享审核和知识索引。此页仅展示不包含原始敏感值的扫描元数据，不能核验、请求补证或重新决策。"
                      : "安全扫描不能被默认为已通过。请先修复完整、可验证的扫描记录；在此之前平台不读取正文，也不允许任何审核决策。"
                  }}
                </p>
              </div>
            </div>

            <section class="scan-panel" :class="`is-${scanTone}`" aria-labelledby="content-scan-heading">
              <header class="scan-head">
                <div>
                  <h3 id="content-scan-heading">内容安全扫描</h3>
                  <p>{{ scanDescription }}</p>
                </div>
                <span class="scan-verdict" :class="`is-${scanTone}`">
                  {{ contentScan?.verdict ?? "unknown" }}
                </span>
              </header>

              <div v-if="contentScan" class="scan-meta">
                <span>{{ contentScan.scannerVersion }}</span>
                <span>{{ contentScan.findingCount }} 个发现</span>
                <span>定位单位：{{ offsetLabel }}</span>
              </div>

              <ol v-if="scanFindings.length > 0" class="scan-findings">
                <li
                  v-for="(finding, index) in scanFindings"
                  :key="`${finding.payloadName}-${finding.code}-${finding.start ?? 'unknown'}-${index}`"
                  class="scan-finding"
                >
                  <div class="finding-top">
                    <code>{{ finding.code }}</code>
                    <span class="severity" :class="`is-${finding.severity}`">
                      {{ finding.severity }}
                    </span>
                  </div>
                  <div class="finding-loc">
                    <span>Payload：<code>{{ finding.payloadName }}</code></span>
                    <span>
                      {{ offsetLabel }}：[{{ finding.start ?? "?" }}, {{ finding.end ?? "?" }})
                    </span>
                  </div>
                  <p>{{ finding.message }}</p>
                </li>
              </ol>

              <p v-if="scanTruncated" class="scan-truncated" role="note">
                发现数超过页面携带的明细；当前展示 {{ scanFindings.length }} /
                {{ contentScan?.findingCount ?? scanFindings.length }} 条，不得将未展示项视为已通过。
              </p>
            </section>

            <section class="detail-section">
              <div class="section-head">
                <div>
                  <h3>候选正文与变更</h3>
                  <p>正文按接收时已核验的 Payload 展示，修订则标出相对父版本的行级变化。</p>
                </div>
                <span v-if="contentStats" class="section-meta mono">
                  {{ contentStats.chars }} 字符 · {{ contentStats.lines }} 行
                </span>
              </div>

              <p v-if="scanBlocksVerification" class="muted-copy">
                原文已由隔离门禁阻断，本工作台不会尝试读取或渲染。
              </p>
              <LoadingState v-else-if="!contentIsCurrent || contentLoading" label="读取版本正文" />
              <p v-else-if="targetContent === undefined" class="muted-copy">
                目标正文不可用，不能核验通过。
              </p>
              <pre v-else-if="parentContent === undefined" class="content-preview">{{ targetContent }}</pre>
              <template v-else>
                <div v-if="largeDiff && largeDiffStats" class="large-diff">
                  <div class="large-diff-notice" role="note">
                    <strong>超大正文已切换为完整双版本视图</strong>
                    <span>
                      为保持审核页流畅，使用线性前后缀定位变化，不执行二次方行匹配；父版本
                      {{ largeDiffStats.beforeLines }} 行、候选版本 {{ largeDiffStats.afterLines }} 行，
                      中间变化分别为 {{ largeDiffStats.beforeChanged }} /
                      {{ largeDiffStats.afterChanged }} 行。下方正文完整显示、没有截断。
                    </span>
                  </div>
                  <div class="large-diff-versions">
                    <section>
                      <header>
                        <strong>父版本 · 完整正文</strong>
                        <span>{{ largeDiffStats.beforeChars }} 字符</span>
                      </header>
                      <pre class="content-preview">{{ parentContent }}</pre>
                    </section>
                    <section>
                      <header>
                        <strong>候选版本 · 完整正文</strong>
                        <span>{{ largeDiffStats.afterChars }} 字符</span>
                      </header>
                      <pre class="content-preview">{{ targetContent }}</pre>
                    </section>
                  </div>
                </div>
                <pre v-else class="diff-block"><span
                  v-for="(line, index) in diffRows"
                  :key="`${index}-${line.kind}`"
                  class="diff-row"
                  :class="`is-${line.kind}`"
                ><i>{{ diffMarker(line.kind) }}</i><span class="diff-text">{{ line.text || " " }}</span></span></pre>
              </template>
            </section>

            <div class="detail-grid">
              <section class="mini-panel">
                <header class="mini-head">
                  <h3><Link2 :size="14" aria-hidden="true" /> 来源与证据</h3>
                  <span class="mini-meta mono">{{ evidenceRefs.length }}</span>
                </header>
                <p v-if="evidenceRefs.length === 0" class="note-block is-warn evidence-warning">
                  未附独立外部证据；审核者需要判断该知识类型是否允许。
                </p>
                <ul v-else class="evidence-list">
                  <li v-for="ref in evidenceRefs" :key="ref">
                    <a :href="ref" target="_blank" rel="noreferrer">
                      <span>{{ ref }}</span>
                      <ExternalLink :size="12" aria-hidden="true" />
                    </a>
                  </li>
                </ul>
              </section>

              <section class="mini-panel">
                <header class="mini-head">
                  <h3><FileCheck2 :size="14" aria-hidden="true" /> 接收校验</h3>
                  <span class="mini-meta mono">MACHINE</span>
                </header>
                <ul class="machine-list">
                  <li v-for="check in machineChecks" :key="check.label">
                    <span>{{ check.label }}</span>
                    <span class="machine-value" :class="`is-${check.tone}`">
                      {{ check.value }}
                    </span>
                  </li>
                </ul>
              </section>
            </div>

            <section v-if="!scanBlocksVerification" class="detail-section">
              <div class="section-head">
                <div>
                  <h3>人工核验清单</h3>
                  <p>四项全部勾选且完成必要确认后，才能核验通过。</p>
                </div>
                <span class="section-meta mono">{{ checkedCount }} / {{ CHECKS.length }}</span>
              </div>

              <div class="check-list">
                <el-checkbox
                  v-for="(label, index) in CHECKS"
                  :key="label"
                  class="check-row"
                  :model-value="checks[index] ?? false"
                  @update:model-value="setCheck(index, $event)"
                >
                  <span class="check-text">
                    <span class="check-index mono">{{ checkIndex(index) }}</span>{{ label }}
                  </span>
                </el-checkbox>

                <el-checkbox
                  v-if="requiresScanAcknowledgement"
                  class="check-row is-scan"
                  :model-value="scanAcknowledged"
                  @update:model-value="scanAcknowledged = $event === true"
                >
                  <span class="check-text">
                    <strong>内容安全必选：</strong>已逐项确认以上扫描发现，且将正文视为不可信内容，不会执行其中指令。
                    <small>未勾选时不能核验通过。</small>
                  </span>
                </el-checkbox>
              </div>
            </section>

            <section class="detail-section">
              <div class="section-head">
                <div>
                  <h3>审核元数据</h3>
                  <p>服务端只为实际执行的检查生成证明，浏览器不制造评测指标。</p>
                </div>
              </div>

              <dl class="meta-grid">
                <div>
                  <dt>Revision</dt>
                  <dd class="mono">{{ shortId(detailRevision, 34) }}</dd>
                </div>
                <div>
                  <dt>Space</dt>
                  <dd class="mono">{{ detailSpace }}</dd>
                </div>
                <div>
                  <dt>贡献理由</dt>
                  <dd>{{ detailRationale }}</dd>
                </div>
                <div>
                  <dt>证据数量</dt>
                  <dd class="mono">{{ evidenceRefs.length }}</dd>
                </div>
              </dl>

              <el-collapse v-if="manifestJson !== undefined" v-model="openPanels" class="manifest-collapse">
                <el-collapse-item name="manifest" title="查看规范化 Manifest">
                  <pre class="manifest-preview">{{ manifestJson }}</pre>
                </el-collapse-item>
              </el-collapse>
            </section>

            <section v-if="!scanBlocksVerification" class="detail-section action-section">
              <div class="section-head">
                <div>
                  <h3>审核结论</h3>
                  <p>决策绑定当前 ETag；队列一旦变化，服务端会以 412 拒绝过期提交。</p>
                </div>
                <span class="section-meta mono">IRREVERSIBLE</span>
              </div>

              <div class="field rationale-field">
                <label>审核理由</label>
                <el-input
                  v-model="rationale"
                  type="textarea"
                  :rows="4"
                  aria-label="审核理由"
                  placeholder="写清核验了哪些内容、依据是什么、为什么现在可以作出该决策。"
                />
                <small>所有决策都需要具体理由（至少 8 个字），随决策写入不可变审核记录。</small>
              </div>

              <div v-if="stale" class="stale-banner" role="alert">
                <RefreshCw :size="15" aria-hidden="true" />
                <div>
                  <strong>队列已过期（412 Precondition Failed）</strong>
                  <p>{{ actionError }}</p>
                </div>
                <button class="btn btn-sm" @click="reload">刷新队列</button>
              </div>
              <div v-else-if="actionError" class="form-error" role="alert">
                <AlertOctagon :size="14" aria-hidden="true" />
                <span>{{ actionError }}</span>
              </div>

              <div class="decision-bar">
                <button
                  class="btn btn-primary"
                  :disabled="!canVerify"
                  @click="decide('verify')"
                >
                  <Check :size="16" aria-hidden="true" />
                  {{ acting === "verify" ? "生成证明并核验…" : "生成评测证明并通过" }}
                </button>
                <button class="btn" :disabled="!canDecide" @click="decide('request_evidence')">
                  <FileQuestion :size="16" aria-hidden="true" />
                  {{ acting === "request_evidence" ? "提交中…" : "请求补证" }}
                </button>
                <button class="btn btn-danger" :disabled="!canDecide" @click="decide('reject')">
                  <X :size="16" aria-hidden="true" />
                  {{ acting === "reject" ? "提交中…" : "拒绝" }}
                </button>

                <span class="decision-spacer" />

                <el-tooltip
                  content="提交决策时以 If-Match 发送；若该候选已被其他决策更新，服务端返回 412。"
                  placement="top"
                >
                  <span class="etag-chip mono">ETag {{ shortId(detailEtag, 22) }}</span>
                </el-tooltip>
                <button class="btn btn-ghost" :disabled="!canDecide" @click="decide('quarantine')">
                  <AlertOctagon :size="15" aria-hidden="true" />
                  {{ acting === "quarantine" ? "提交中…" : "隔离" }}
                </button>
              </div>

              <p class="decision-hint" :class="{ 'is-ready': canVerify }">{{ decisionHint }}</p>
            </section>

            <div v-else class="note-block is-warn terminal-note" role="status">
              <AlertOctagon :size="15" aria-hidden="true" />
              <span>
                {{
                  isQuarantined
                    ? "隔离是终态：审核操作已全部阻断。"
                    : "扫描记录未通过：审核操作已全部阻断。"
                }}
              </span>
            </div>
          </div>
        </template>

        <EmptyState
          v-else
          title="没有待审核内容"
          description="平台不会自动发布未经审核的知识。"
        >
          <template #icon><FileQuestion :size="19" aria-hidden="true" /></template>
        </EmptyState>
      </section>
    </div>
  </template>
</template>

<style scoped>
/* ---------- 工作台骨架 ---------- */
.review-workspace {
  grid-template-columns: minmax(296px, 344px) minmax(0, 1fr);
}

.workspace-error {
  margin-bottom: var(--gap);
}

.is-spinning {
  animation: review-spin 0.9s linear infinite;
}

@keyframes review-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 左侧队列 ---------- */
.review-queue {
  position: sticky;
  top: calc(var(--topbar-height) + 16px);
  overflow: hidden;
}

.queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--line);
}

.queue-total {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.queue-total strong {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.queue-total span {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.queue-role {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: auto;
  padding: 5px 7px;
  flex: 0 0 auto;
}

.queue-role svg {
  color: var(--gold);
}

.queue-list {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 300px);
  overflow-y: auto;
}

.queue-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto 14px;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 14px 11px 12px;
  border-left: 2px solid transparent;
  border-bottom: 1px solid var(--line-soft);
  text-align: left;
  transition: background 0.15s var(--ease), border-color 0.15s var(--ease);
}

.queue-row:last-child {
  border-bottom: 0;
}

.queue-row:hover {
  background: var(--paper);
}

.queue-row.is-active {
  background: var(--paper);
  border-left-color: var(--accent);
}

.queue-mark {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card-warm);
  color: var(--muted);
}

.queue-row.is-active .queue-mark {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.queue-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.queue-copy strong {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}

.queue-copy small {
  color: var(--faint);
  font: 500 10.5px/1.45 var(--mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}

.queue-chevron {
  color: var(--faint);
}

.queue-row.is-active .queue-chevron {
  color: var(--accent);
}

.queue-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}

.queue-foot svg {
  color: var(--jade);
}

/* ---------- 右侧详情 ---------- */
.review-detail {
  overflow: hidden;
}

.detail-head {
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--line);
}

.detail-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.chip-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.kind-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 6px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--card-warm);
  color: var(--ink-2);
  font: 600 10px/1 var(--mono);
  letter-spacing: 0.06em;
}

.space-chip {
  color: var(--faint);
  font: 500 10.5px/1.4 var(--mono);
}

.id-chip {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  cursor: help;
}

.detail-title {
  margin-top: 10px;
  font-size: 21px;
  line-height: 1.35;
  letter-spacing: -0.35px;
}

.review-summary {
  margin-top: 7px;
  max-width: 74ch;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.7;
}

.detail-byline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid var(--line-soft);
}

.detail-byline > div {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.detail-byline dt {
  color: var(--faint);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.detail-byline dd {
  color: var(--ink-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.detail-byline dd em {
  margin-left: 2px;
  color: var(--faint);
  font: 500 9.5px/1 var(--mono);
  font-style: normal;
  letter-spacing: 0.08em;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 20px 20px;
}

.detail-section {
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.detail-section:first-child {
  border-top: 0;
  padding-top: 0;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-head h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.section-head p {
  margin-top: 3px;
  max-width: 72ch;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.65;
}

.section-meta {
  flex: 0 0 auto;
  padding-top: 2px;
  color: var(--faint);
  font-size: 10px;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.muted-copy {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

/* ---------- 隔离门禁 ---------- */
.gate-alert {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent);
}

.gate-alert > div {
  display: grid;
  gap: 4px;
}

.gate-alert strong {
  font-size: 12.5px;
  line-height: 1.5;
}

.gate-alert p {
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.7;
}

.gate-alert svg {
  margin-top: 1px;
}

/* ---------- 内容安全扫描 ---------- */
.scan-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  overflow: hidden;
}

.scan-panel.is-clean {
  border-color: var(--jade-line);
}

.scan-panel.is-review {
  border-color: var(--gold-line);
}

.scan-panel.is-quarantined,
.scan-panel.is-unknown {
  border-color: var(--accent-line);
}

.scan-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
}

.scan-head h3 {
  font-size: 12.5px;
}

.scan-head p {
  margin-top: 4px;
  max-width: 74ch;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.65;
}

.scan-verdict {
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--card-warm);
  color: var(--slate);
  font: 600 10px/1 var(--mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.scan-verdict.is-clean {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.scan-verdict.is-review {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.scan-verdict.is-quarantined,
.scan-verdict.is-unknown {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.scan-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 8px 16px;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font: 500 10px/1.5 var(--mono);
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}

.scan-findings {
  border-top: 1px solid var(--line);
}

.scan-finding {
  padding: 11px 16px;
}

.scan-finding + .scan-finding {
  border-top: 1px solid var(--line-soft);
}

.finding-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.finding-top code {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--ink);
}

.severity {
  margin-left: auto;
  padding: 2px 5px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: var(--slate-soft);
  color: var(--slate);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.severity.is-high {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.severity.is-medium {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.severity.is-low,
.severity.is-unknown {
  border-color: var(--line-2);
  background: var(--slate-soft);
  color: var(--slate);
}

.finding-loc {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 5px;
  color: var(--faint);
  font: 500 10.5px/1.5 var(--mono);
  font-variant-numeric: tabular-nums;
}

.finding-loc code {
  color: var(--muted);
}

.scan-finding p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.7;
}

.scan-truncated {
  padding: 10px 16px;
  border-top: 1px solid var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 11.5px;
  line-height: 1.65;
}

/* ---------- 正文与差异 ---------- */
.content-preview,
.diff-block {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink-2);
  font: 400 11.5px/1.75 var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

.content-preview {
  max-height: 520px;
  padding: 13px 15px;
}

.diff-block {
  max-height: 520px;
  padding: 10px 0;
}

.diff-row {
  display: flex;
  gap: 8px;
  padding: 0 14px 0 10px;
  border-left: 2px solid transparent;
}

.diff-row i {
  flex: 0 0 8px;
  color: var(--faint);
  font-style: normal;
  text-align: center;
  user-select: none;
}

.diff-row.is-add {
  border-left-color: var(--jade);
  background: var(--jade-soft);
}

.diff-row.is-add i {
  color: var(--jade);
}

.diff-row.is-remove {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}

.diff-row.is-remove i {
  color: var(--accent);
}

.diff-text {
  min-width: 0;
}

.large-diff {
  display: grid;
  gap: 12px;
}

.large-diff-notice {
  display: grid;
  gap: 4px;
  padding: 11px 13px;
  border: 1px solid var(--gold-line);
  border-radius: var(--radius);
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 12px;
  line-height: 1.7;
}

.large-diff-notice strong {
  font-size: 12.5px;
}

.large-diff-notice span {
  color: var(--ink-2);
}

.large-diff-versions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.large-diff-versions section {
  min-width: 0;
}

.large-diff-versions header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.large-diff-versions header strong {
  font-size: 12px;
}

.large-diff-versions header span {
  color: var(--faint);
  font: 500 10px/1 var(--mono);
  font-variant-numeric: tabular-nums;
}

.large-diff-versions .content-preview {
  max-height: 420px;
}

/* ---------- 证据 / 机器校验 ---------- */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.mini-panel {
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card-warm);
}

.mini-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.mini-head h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.mini-head svg {
  color: var(--muted);
}

.mini-meta {
  color: var(--faint);
  font-size: 10px;
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
}

.evidence-list {
  display: grid;
  gap: 6px;
}

.evidence-list a {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--card);
  color: var(--ink-2);
  font: 500 10.5px/1.55 var(--mono);
  word-break: break-all;
  overflow-wrap: anywhere;
  transition: border-color 0.15s var(--ease), color 0.15s var(--ease);
}

.evidence-list a:hover {
  border-color: var(--line-2);
  color: var(--accent);
}

.evidence-list svg {
  margin-top: 2px;
  color: var(--faint);
}

.evidence-warning {
  display: block;
  font-size: 11.5px;
}

.machine-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line-soft);
  font-size: 11.5px;
}

.machine-list li:last-child {
  border-bottom: 0;
}

.machine-list li > span:first-child {
  color: var(--muted);
}

.machine-value {
  color: var(--ink-2);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.machine-value.is-pass {
  color: var(--jade);
}

.machine-value.is-warn {
  color: var(--gold);
}

.machine-value.is-block {
  color: var(--accent);
}

.machine-value.is-muted {
  color: var(--faint);
  font-family: var(--mono);
  font-size: 10.5px;
}

/* ---------- 人工核验清单 ---------- */
.check-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  height: auto;
  margin: 0;
  padding: 9px 12px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: var(--card);
}

.check-row:hover {
  border-color: var(--line-2);
  background: var(--card-warm);
}

.check-row :deep(.el-checkbox__input) {
  margin-top: 1px;
}

.check-row :deep(.el-checkbox__label) {
  white-space: normal;
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.65;
}

.check-row.is-checked {
  border-color: var(--line-2);
  background: var(--paper);
}

.check-row.is-scan {
  border-color: var(--gold-line);
  background: var(--gold-soft);
}

.check-text {
  display: block;
}

.check-text strong {
  color: var(--gold);
}

.check-text small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}

.check-index {
  margin-right: 8px;
  color: var(--faint);
  font-size: 10px;
  letter-spacing: 0.04em;
}

/* ---------- 元数据 / Manifest ---------- */
.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
}

.meta-grid > div {
  display: grid;
  gap: 3px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line-soft);
}

.meta-grid dt {
  color: var(--faint);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.meta-grid dd {
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.65;
}

.meta-grid dd.mono {
  color: var(--muted);
  font-size: 10.5px;
  word-break: break-all;
}

.manifest-collapse {
  margin-top: 12px;
  border-top: 1px solid var(--line-soft);
}

.manifest-collapse :deep(.el-collapse-item__header) {
  height: 38px;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 500;
}

.manifest-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
}

.manifest-preview {
  margin: 0;
  max-height: 320px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink-2);
  font: 400 10.5px/1.7 var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

/* ---------- 审核结论 ---------- */
.rationale-field {
  margin-bottom: 12px;
}

.rationale-field > small {
  color: var(--faint);
  font-size: 11px;
  line-height: 1.6;
}

.rationale-field :deep(.el-textarea__inner) {
  min-height: 88px;
  font-size: 12.5px;
}

.stale-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
  padding: 11px 13px;
  border: 1px solid var(--gold-line);
  border-radius: var(--radius);
  background: var(--gold-soft);
  color: var(--gold);
}

.stale-banner > div {
  flex: 1;
  min-width: 0;
}

.stale-banner strong {
  font-size: 12.5px;
}

.stale-banner p {
  margin-top: 2px;
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.65;
}

.stale-banner svg {
  margin-top: 2px;
}

.action-section .form-error {
  margin-bottom: 12px;
}

.decision-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line-soft);
}

.decision-spacer {
  flex: 1 1 auto;
}

.etag-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 7px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: help;
}

.decision-hint {
  margin-top: 9px;
  color: var(--faint);
  font-size: 11.5px;
  line-height: 1.6;
}

.decision-hint.is-ready {
  color: var(--jade);
}

.terminal-note {
  align-items: center;
}

/* ---------- 响应式 ---------- */
@media (max-width: 1080px) {
  .review-workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .review-queue {
    position: static;
  }

  .queue-list {
    max-height: 420px;
  }
}

@media (max-width: 900px) {
  .detail-grid,
  .large-diff-versions {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .detail-head,
  .detail-body {
    padding-left: 16px;
    padding-right: 16px;
  }

  .detail-title {
    font-size: 19px;
  }

  .meta-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .queue-row {
    grid-template-columns: 26px minmax(0, 1fr) auto;
  }

  .queue-chevron {
    display: none;
  }
}
</style>
