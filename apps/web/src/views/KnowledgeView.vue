<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ElCollapse,
  ElCollapseItem,
  ElDialog,
  ElInput,
  ElMessage,
  ElOption,
  ElSelect,
  ElTooltip,
} from "element-plus";
import {
  AlertTriangle,
  BookOpenText,
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  FilePlus2,
  GitBranch,
  LoaderCircle,
  PenLine,
  Quote,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-vue-next";
import {
  getAssets,
  getRevisionDetail,
  recordKnowledgeOutcome,
  searchKnowledge,
} from "@/api/client";
import type { ConsoleAsset, QueryResultItem, RevisionDetail } from "@/api/types";
import { BRAND } from "@/brand";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { formatDate, formatDateTime, formatRelativeTime, shortId, shortRevision } from "@/utils/format";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatusBadge from "@/components/StatusBadge.vue";

interface DisplayedResult {
  readonly indexedThrough: string;
  readonly item: QueryResultItem;
  readonly policyEpoch: string;
  readonly projectionGeneration: string;
  readonly queryReceiptId: string;
  readonly snapshot: string;
}

interface KnowledgeSearchCriteria {
  readonly assetTypes: readonly string[];
  readonly labels: readonly string[];
  readonly query: string;
  readonly spaceId?: string;
}

interface SearchSession {
  readonly criteria: KnowledgeSearchCriteria;
  readonly indexedThrough: string;
  readonly key: string;
  readonly nextCursor?: string;
  readonly policyEpoch: string;
  readonly projectionGeneration: string;
  readonly queryReceiptId: string;
  readonly snapshot: string;
}

/** 与 client.ts 中 searchKnowledge 的默认 limit 保持一致，用于展示本次请求预算。 */
const REQUEST_BUDGET = 30;

const route = useRoute();
const router = useRouter();

const rawInitialQuery = route.query.q;
const initialQuery = typeof rawInitialQuery === "string" ? rawInitialQuery : "";
const rawInitialSpace = route.query.space;
const initialSpace =
  typeof rawInitialSpace === "string" && rawInitialSpace.length > 0 ? rawInitialSpace : undefined;

const query = ref(initialQuery);
const results = ref<DisplayedResult[]>();
const searchSession = ref<SearchSession>();
const searching = ref(false);
const searchError = ref<Error>();
const assetType = ref("");
const label = ref("");
const sort = ref<"relevance" | "title">("relevance");
/** Element Plus 把空字符串视为“未选择”，因此用一个显式哨兵值承载“全部类型”。 */
const assetTypeSelection = computed<string>({
  get: () => (assetType.value === "" ? "all" : assetType.value),
  set: (value) => {
    assetType.value = value === "all" ? "" : value;
  },
});

const selected = ref<ConsoleAsset>();
const selectedEvidence = ref<DisplayedResult>();
const revision = ref<RevisionDetail>();
const detailError = ref<Error>();
const detailLoading = ref(false);
const outcomeState = ref<"harmed" | "helped" | "neutral" | "saving" | "saved">();
const outcomeReceipt = ref<string>();
const copied = ref(false);
const evidenceOpen = ref(false);
const openSections = ref<string[]>(["boundary"]);

const searchInput = ref<{ focus: () => void }>();
const detailPanel = ref<HTMLElement>();

let searchRequestId = 0;
let detailRequestId = 0;
let copiedTimer: number | undefined;

const spaceId = computed<string | undefined>(() => {
  const raw = route.query.space;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
});

const draftCriteria = computed<KnowledgeSearchCriteria>(() =>
  buildSearchCriteria(query.value, assetType.value, label.value, spaceId.value),
);
const draftCriteriaKey = computed(() => searchCriteriaKey(draftCriteria.value));
const sessionMatchesDraft = computed(() => searchSession.value?.key === draftCriteriaKey.value);

const { data: assetsData, error: assetsError, loading: assetsLoading, refresh: refreshAssets } =
  useAsyncResource<readonly ConsoleAsset[]>(getAssets);

const visibleAssets = computed<ConsoleAsset[]>(() =>
  (assetsData.value ?? []).filter(
    (asset) =>
      (asset.status === "published" || asset.status === "deprecated") &&
      (spaceId.value === undefined || asset.spaceId === spaceId.value) &&
      (assetType.value === "" || asset.assetType === assetType.value) &&
      (label.value.trim() === "" || asset.labels.includes(label.value.trim())),
  ),
);

const displayedResults = computed<DisplayedResult[] | undefined>(() => {
  const value = results.value;
  if (value === undefined || sort.value === "relevance") return value;
  return [...value].sort((left, right) =>
    left.item.title.localeCompare(right.item.title, "zh-CN"),
  );
});

const resultCount = computed(() =>
  results.value === undefined ? visibleAssets.value.length : (displayedResults.value?.length ?? 0),
);
const hasNarrowingFilters = computed(
  () => assetType.value !== "" || label.value.trim() !== "" || spaceId.value !== undefined,
);
const currentQueryLabel = computed(
  () =>
    searchSession.value?.criteria.query ??
    (typeof route.query.q === "string" ? route.query.q : ""),
);

const initialLoading = computed(
  () => assetsLoading.value && initialQuery.trim().length === 0 && results.value === undefined,
);
const initialError = computed<Error | undefined>(() =>
  assetsError.value !== undefined && initialQuery.trim().length === 0 && results.value === undefined
    ? assetsError.value
    : undefined,
);

const detailManifest = computed(() => revision.value?.resource.manifest);
const detailProvenance = computed(
  () => detailManifest.value?.provenance ?? selectedEvidence.value?.item.provenance,
);
const boundaryVisible = computed(
  () => revision.value !== undefined || detailProvenance.value !== undefined,
);
const provenanceSources = computed(() => detailProvenance.value?.primarySources ?? []);
const generatedByActor = computed(() => detailProvenance.value?.generatedBy?.actor);
const detailScope = computed(() => detailManifest.value?.scope);
const detailPolicy = computed(() => detailManifest.value?.policy);
const assumptions = computed(() => detailScope.value?.assumptions ?? []);

const scopeLocale = computed(
  () =>
    [detailScope.value?.locale, detailScope.value?.jurisdiction].filter(Boolean).join(" · ") ||
    "未限定",
);
const scopeReviewAfter = computed(() =>
  detailScope.value?.reviewAfter === undefined
    ? "未设置"
    : formatDate(detailScope.value.reviewAfter),
);
const scopeValidity = computed(() =>
  validityLabel(detailScope.value?.validFrom, detailScope.value?.validUntil),
);
const scopePurposes = computed(
  () => detailPolicy.value?.allowedPurposes?.join(" · ") || "由本地策略决定",
);
const scopeClassification = computed(
  () =>
    [detailPolicy.value?.classification, detailPolicy.value?.export].filter(Boolean).join(" · ") ||
    "未声明",
);

let appliedUrlSignature = urlSignature(initialQuery.trim(), initialSpace);

function urlSignature(value: string, space?: string): string {
  return JSON.stringify([value.trim(), space ?? null]);
}

function buildSearchCriteria(
  value: string,
  type: string,
  tag: string,
  space: string | undefined,
): KnowledgeSearchCriteria {
  const normalizedAssetType = type.trim();
  const normalizedLabel = tag.trim();
  return {
    assetTypes: normalizedAssetType.length === 0 ? [] : [normalizedAssetType],
    labels: normalizedLabel.length === 0 ? [] : [normalizedLabel],
    query: value.trim(),
    ...(space === undefined ? {} : { spaceId: space }),
  };
}

function searchCriteriaKey(criteria: KnowledgeSearchCriteria): string {
  return JSON.stringify([
    criteria.query,
    criteria.spaceId ?? null,
    [...criteria.assetTypes],
    [...criteria.labels],
  ]);
}

function spaceShort(value: string | undefined): string {
  if (value === undefined || value === "") return "Principal 允许范围";
  return value.split("/").at(-1) ?? value;
}

function padIndex(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function qualityDecisionLabel(value: string): string {
  return value === "suitable_with_warning" ? "质量通过（有警告）" : "质量通过";
}

function qualityTone(value: string): string {
  return value === "suitable_with_warning" ? "is-warning" : "is-quality";
}

function queryStatus(item: QueryResultItem): "deprecated" | "published" {
  return item.statuses?.includes("deprecated") === true ? "deprecated" : "published";
}

function scoreText(item: QueryResultItem): string {
  return (item.scores[0]?.value ?? 0).toFixed(2);
}

function sourceCount(item: QueryResultItem): number {
  return item.provenance?.primarySources?.length ?? 0;
}

function obligationText(obligations: readonly unknown[]): string {
  return obligations.map((item) => String(item)).join(" · ") || "无额外义务";
}

function locatorText(locator: Record<string, unknown>): string {
  return JSON.stringify(locator);
}

function isSelected(space: string, revisionId: string): boolean {
  const current = selected.value;
  return current !== undefined && current.spaceId === space && current.revisionId === revisionId;
}

function isUnreadable(status: string): boolean {
  return status === "revoked" || status === "erased";
}

function safeHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validityLabel(from: string | undefined, until: string | undefined): string {
  if (from === undefined && until === undefined) return "未限定";
  return `${from === undefined ? "未设置" : formatDate(from)} — ${
    until === undefined ? "未设置" : formatDate(until)
  }`;
}

function assetFromQueryResult(evidence: DisplayedResult): ConsoleAsset {
  const item = evidence.item;
  return {
    assetType: item.assetType,
    indexedAt: evidence.indexedThrough,
    labels: [],
    obligations: item.obligations,
    profile: item.profile ?? { digest: "", uri: "" },
    qualityAttestationRefs: item.qualityAttestationRefs,
    qualityDecision:
      item.qualityDecision === "suitable_with_warning" ? "suitable_with_warning" : "suitable",
    qualityReasons: item.qualityReasons,
    recordId: item.recordId,
    revisionId: item.revisionId,
    spaceId: item.spaceId,
    status: queryStatus(item),
    ...(item.summary === undefined ? {} : { summary: item.summary }),
    title: item.title,
  };
}

async function executeSearch(
  criteria: KnowledgeSearchCriteria,
  cursor?: string,
): Promise<void> {
  if (criteria.query.length === 0) {
    await clearSearch();
    return;
  }
  const append = cursor !== undefined;
  searchRequestId += 1;
  const requestId = searchRequestId;
  searching.value = true;
  searchError.value = undefined;
  if (!append) {
    searchSession.value = undefined;
    selectedEvidence.value = undefined;
    outcomeState.value = undefined;
    outcomeReceipt.value = undefined;
  }
  try {
    const response = await searchKnowledge({
      ...(criteria.assetTypes.length === 0 ? {} : { assetTypes: criteria.assetTypes }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(criteria.labels.length === 0 ? {} : { labels: criteria.labels }),
      query: criteria.query,
      ...(criteria.spaceId === undefined ? {} : { spaceId: criteria.spaceId }),
    });
    if (requestId !== searchRequestId) return;
    const page: DisplayedResult[] = response.results.map((item) => ({
      indexedThrough: response.indexedThrough,
      item,
      policyEpoch: response.policyEpoch,
      projectionGeneration: response.projectionGeneration,
      queryReceiptId: response.queryReceiptId,
      snapshot: response.snapshot,
    }));
    results.value = append ? [...(results.value ?? []), ...page] : page;
    searchSession.value = {
      criteria,
      indexedThrough: response.indexedThrough,
      key: searchCriteriaKey(criteria),
      ...(response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor }),
      policyEpoch: response.policyEpoch,
      projectionGeneration: response.projectionGeneration,
      queryReceiptId: response.queryReceiptId,
      snapshot: response.snapshot,
    };
    const nextQuery: Record<string, string> = { q: criteria.query };
    if (criteria.spaceId !== undefined) nextQuery.space = criteria.spaceId;
    appliedUrlSignature = urlSignature(criteria.query, criteria.spaceId);
    void router.replace({ query: nextQuery }).catch(() => undefined);
  } catch (caught) {
    if (requestId === searchRequestId) {
      searchError.value = caught instanceof Error ? caught : new Error("搜索失败");
    }
  } finally {
    if (requestId === searchRequestId) searching.value = false;
  }
}

async function runSearch(value: string = query.value): Promise<void> {
  await executeSearch(buildSearchCriteria(value, assetType.value, label.value, spaceId.value));
}

async function clearSearch(): Promise<void> {
  searchRequestId += 1;
  query.value = "";
  results.value = undefined;
  searchSession.value = undefined;
  searching.value = false;
  searchError.value = undefined;
  clearDetail();
  const nextQuery: Record<string, string> = {};
  if (spaceId.value !== undefined) nextQuery.space = spaceId.value;
  appliedUrlSignature = urlSignature("", spaceId.value);
  void router.replace({ query: nextQuery }).catch(() => undefined);
}

async function loadMore(): Promise<void> {
  const session = searchSession.value;
  if (session?.nextCursor === undefined || session.key !== draftCriteriaKey.value) return;
  await executeSearch(session.criteria, session.nextCursor);
}

async function broadenSearch(): Promise<void> {
  const criteria = buildSearchCriteria(query.value, "", "", undefined);
  assetType.value = "";
  label.value = "";
  await executeSearch(criteria);
}

async function browseKnowledge(): Promise<void> {
  searchRequestId += 1;
  assetType.value = "";
  label.value = "";
  query.value = "";
  results.value = undefined;
  searchSession.value = undefined;
  searchError.value = undefined;
  searching.value = false;
  clearDetail();
  appliedUrlSignature = urlSignature("", undefined);
  void router.replace({ path: "/knowledge" }).catch(() => undefined);
}

function removeSpaceFilter(): void {
  const currentQuery = typeof route.query.q === "string" ? route.query.q : "";
  const nextQuery: Record<string, string> = {};
  if (currentQuery.length > 0) nextQuery.q = currentQuery;
  appliedUrlSignature = urlSignature(currentQuery, undefined);
  void router.replace({ query: nextQuery }).catch(() => undefined);
  if (results.value !== undefined && query.value.trim().length > 0) {
    void executeSearch(buildSearchCriteria(query.value, assetType.value, label.value, undefined));
  }
}

function clearDetail(): void {
  detailRequestId += 1;
  selected.value = undefined;
  selectedEvidence.value = undefined;
  revision.value = undefined;
  detailError.value = undefined;
  detailLoading.value = false;
  outcomeState.value = undefined;
  outcomeReceipt.value = undefined;
  copied.value = false;
}

async function loadRevision(asset: ConsoleAsset): Promise<void> {
  detailRequestId += 1;
  const requestId = detailRequestId;
  revision.value = undefined;
  detailError.value = undefined;
  if (isUnreadable(asset.status)) {
    detailLoading.value = false;
    detailError.value = new Error(
      `该版本已${asset.status === "revoked" ? "撤销" : "擦除"}，正文不可读取。`,
    );
    return;
  }
  detailLoading.value = true;
  try {
    const detail = await getRevisionDetail(asset.spaceId, asset.revisionId);
    if (requestId === detailRequestId) revision.value = detail;
  } catch (caught) {
    if (requestId === detailRequestId) {
      detailError.value = caught instanceof Error ? caught : new Error("无法读取版本正文");
    }
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false;
  }
}

function openAsset(asset: ConsoleAsset, evidence?: DisplayedResult): void {
  selected.value = asset;
  selectedEvidence.value = evidence;
  outcomeState.value = undefined;
  outcomeReceipt.value = undefined;
  copied.value = false;
  void loadRevision(asset);
}

function openQueryResult(evidence: DisplayedResult): void {
  const item = evidence.item;
  const asset =
    (assetsData.value ?? []).find(
      (candidate) => candidate.spaceId === item.spaceId && candidate.revisionId === item.revisionId,
    ) ?? assetFromQueryResult(evidence);
  openAsset(asset, evidence);
}

async function recordOutcome(outcome: "harmed" | "helped" | "neutral"): Promise<void> {
  const evidence = selectedEvidence.value;
  if (evidence === undefined) return;
  outcomeState.value = "saving";
  try {
    await recordKnowledgeOutcome({
      item: evidence.item,
      outcome,
      queryReceiptId: evidence.queryReceiptId,
    });
    outcomeState.value = "saved";
    outcomeReceipt.value = evidence.queryReceiptId;
    ElMessage.success("任务结果已形成治理证据");
  } catch (caught) {
    outcomeState.value = undefined;
    const error = caught instanceof Error ? caught : new Error("反馈记录失败");
    searchError.value = error;
    ElMessage.error(error.message);
  }
}

async function copyCitation(): Promise<void> {
  const evidence = selectedEvidence.value;
  if (evidence === undefined) return;
  const item = evidence.item;
  try {
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          citations: item.citations,
          obligations: item.obligations,
          policyEpoch: evidence.policyEpoch,
          qualityAttestationRefs: item.qualityAttestationRefs,
          qualityDecision: item.qualityDecision,
          queryReceiptId: evidence.queryReceiptId,
          revisionId: item.revisionId,
          spaceId: item.spaceId,
        },
        null,
        2,
      ),
    );
    copied.value = true;
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied.value = false;
    }, 1600);
    ElMessage.success("引用与义务已复制");
  } catch {
    ElMessage.error("复制失败，请手动选择引用内容");
  }
}

function focusSearch(): void {
  searchInput.value?.focus();
}

function focusSearchShortcut(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    event.stopPropagation();
    focusSearch();
  }
}

function dismissDetail(event: KeyboardEvent): void {
  if (event.key === "Escape") clearDetail();
}

let previousFocus: HTMLElement | undefined;
let previousOverflow = "";
let overlayActive = false;

function releaseDetailOverlay(): void {
  if (!overlayActive) return;
  overlayActive = false;
  document.body.style.overflow = previousOverflow;
  window.removeEventListener("keydown", dismissDetail);
  previousFocus?.focus();
  previousFocus = undefined;
}

watch(selected, async (asset) => {
  if (asset !== undefined && window.innerWidth <= 1080) {
    if (!overlayActive) {
      previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", dismissDetail);
      overlayActive = true;
    }
    await nextTick();
    detailPanel.value?.focus();
  } else {
    releaseDetailOverlay();
  }
});

onMounted(() => {
  window.addEventListener("keydown", focusSearchShortcut, true);
  if (initialQuery.trim().length > 0) {
    void executeSearch(buildSearchCriteria(initialQuery, "", "", initialSpace));
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", focusSearchShortcut, true);
  window.removeEventListener("keydown", dismissDetail);
  releaseDetailOverlay();
  if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
});

/**
 * 页面内部用 router.replace 同步 ?q= 与 ?space=；这里只响应外部入口（顶栏搜索、浏览器前进后退），
 * appliedUrlSignature 用来忽略自己刚写入 URL 的回声。
 */
watch(
  () => [route.query.q, route.query.space] as const,
  () => {
    const rawQuery = route.query.q;
    const nextQuery = typeof rawQuery === "string" ? rawQuery : "";
    const rawSpace = route.query.space;
    const nextSpace =
      typeof rawSpace === "string" && rawSpace.length > 0 ? rawSpace : undefined;
    const signature = urlSignature(nextQuery, nextSpace);
    if (signature === appliedUrlSignature) return;
    appliedUrlSignature = signature;
    query.value = nextQuery;
    if (nextQuery.trim().length === 0) {
      searchRequestId += 1;
      results.value = undefined;
      searchSession.value = undefined;
      searching.value = false;
      searchError.value = undefined;
      clearDetail();
      return;
    }
    void executeSearch(buildSearchCriteria(nextQuery, assetType.value, label.value, nextSpace));
  },
);
</script>

<template>
  <LoadingState v-if="initialLoading" label="正在读取可访问知识" />
  <ErrorState
    v-else-if="initialError"
    :error="initialError"
    @retry="refreshAssets"
  />
  <template v-else>
    <PageHeader
      eyebrow="Knowledge Explorer"
      title="查找可信、可引用的知识"
      subtitle="检索返回 Passage 级引用、真实相关性、质量证明和使用义务；证据不足时返回空结果。"
    >
      <template #actions>
        <RouterLink class="btn btn-primary" to="/contribute">
          <FilePlus2 :size="15" /> 贡献知识
        </RouterLink>
      </template>
    </PageHeader>

    <div class="split split-main-side knowledge-split">
      <div class="knowledge-main">
        <section class="panel search-panel" aria-label="知识检索">
          <form class="search-form" @submit.prevent="runSearch()">
            <Search :size="18" class="search-glyph" aria-hidden="true" />
            <ElInput
              ref="searchInput"
              v-model="query"
              class="search-input"
              size="large"
              aria-label="搜索知识"
              placeholder="例如：如何安全地让 Agent 贡献新知识？"
            />
            <button
              v-if="query.length > 0"
              type="button"
              class="clear-search"
              aria-label="清空搜索"
              @click="clearSearch"
            >
              <X :size="15" />
            </button>
            <kbd class="search-kbd">⌘ K</kbd>
            <button class="btn btn-primary search-submit" type="submit" :disabled="searching">
              <LoaderCircle v-if="searching" :size="14" class="spin" />
              {{ searching ? "检索中…" : "搜索知识" }}
            </button>
          </form>

          <div class="filter-bar">
            <div class="filter-control">
              <span>知识类型</span>
              <ElSelect v-model="assetTypeSelection" class="type-select" aria-label="按知识类型筛选">
                <ElOption label="全部类型" value="all" />
                <ElOption label="Procedure" value="procedure" />
                <ElOption label="Source Document" value="source_document" />
              </ElSelect>
            </div>
            <div class="filter-control">
              <span>标签</span>
              <ElInput v-model="label" class="label-input" aria-label="按标签筛选" placeholder="精确标签" />
            </div>
            <div class="scope-filters">
              <span class="scope-chip"><BookOpenText :size="12" /> Published / Deprecated</span>
              <span class="scope-chip"><ShieldCheck :size="12" /> customer-support</span>
              <button
                v-if="spaceId !== undefined"
                type="button"
                class="scope-chip is-active is-button"
                title="清除 Space 筛选"
                @click="removeSpaceFilter"
              >
                {{ spaceShort(spaceId) }} <X :size="11" />
              </button>
            </div>
            <button
              v-if="results !== undefined && query.trim() !== ''"
              type="button"
              class="btn btn-ghost btn-sm apply-filters"
              @click="runSearch()"
            >
              应用筛选
            </button>
          </div>
        </section>

        <ErrorState v-if="searchError" :error="searchError" @retry="runSearch()" />

        <section class="panel results-panel" aria-label="知识结果">
          <header class="panel-head results-head">
            <div>
              <p class="result-kicker">
                {{ results === undefined ? "Browse · Published channel" : "Query result" }}
              </p>
              <h2>
                <strong>{{ resultCount }}</strong>
                <span v-if="results === undefined">个知识版本</span>
                <span v-else>条与“{{ currentQueryLabel }}”相关的结果</span>
              </h2>
            </div>
            <div class="results-tools">
              <span v-if="searching && results !== undefined" class="searching-note" aria-live="polite">
                <LoaderCircle :size="12" class="spin" /> 更新中
              </span>
              <label class="sort-control">
                排序
                <ElSelect v-model="sort" class="sort-select" aria-label="结果排序">
                  <ElOption label="相关性" value="relevance" />
                  <ElOption label="标题" value="title" />
                </ElSelect>
              </label>
            </div>
          </header>

          <div v-if="searchSession" class="evidence-strip" role="status">
            <span class="is-jade">
              <ShieldCheck :size="13" aria-hidden="true" /><b>授权后检索</b>
            </span>
            <span>Space：{{ spaceShort(searchSession.criteria.spaceId) }}</span>
            <span>用途：customer-support</span>
            <ElTooltip :content="searchSession.policyEpoch" placement="top">
              <span tabindex="0">策略：{{ shortId(searchSession.policyEpoch, 20) }}</span>
            </ElTooltip>
            <ElTooltip :content="searchSession.projectionGeneration" placement="top">
              <span tabindex="0">投影：{{ shortId(searchSession.projectionGeneration, 22) }}</span>
            </ElTooltip>
            <ElTooltip :content="searchSession.snapshot" placement="top">
              <span tabindex="0">快照：{{ shortId(searchSession.snapshot, 20) }}</span>
            </ElTooltip>
            <span>预算：{{ REQUEST_BUDGET }} 条</span>
            <span>
              索引截至：<time :datetime="searchSession.indexedThrough">{{
                formatRelativeTime(searchSession.indexedThrough)
              }}</time>
            </span>
            <button type="button" class="evidence-more" @click="evidenceOpen = true">
              证据回执 →
            </button>
          </div>

          <LoadingState
            v-if="searching && results === undefined && query.trim() !== ''"
            label="正在检索授权范围内的知识"
          />

          <EmptyState
            v-else-if="resultCount === 0"
            :title="results === undefined ? '当前还没有可浏览的知识' : '当前授权范围内没有足够证据'"
            :description="
              results === undefined
                ? 'Published Channel 为空；贡献会先进入 Candidate，不会绕过审核直接可见。'
                : '当前可访问 Space、customer-support 用途和 Published/Deprecated 版本中没有可引用结果；零结果不等于平台确认答案不存在。'
            "
          >
            <template #icon><CircleSlash :size="18" /></template>
            <template #action>
              <div class="empty-actions">
                <button
                  v-if="results !== undefined"
                  type="button"
                  class="btn btn-sm"
                  @click="browseKnowledge"
                >
                  浏览可访问知识
                </button>
                <button
                  v-if="results !== undefined && hasNarrowingFilters"
                  type="button"
                  class="btn btn-sm"
                  @click="broadenSearch"
                >
                  清除筛选并重搜
                </button>
                <button type="button" class="btn btn-sm btn-ghost" @click="focusSearch">
                  修改关键词
                </button>
                <RouterLink class="btn btn-sm btn-primary" to="/contribute">贡献候选知识</RouterLink>
              </div>
            </template>
          </EmptyState>

          <div v-else class="knowledge-list">
            <template v-if="results === undefined">
              <button
                v-for="(asset, index) in visibleAssets"
                :key="`${asset.spaceId}-${asset.revisionId}`"
                type="button"
                class="knowledge-row"
                :class="{ 'is-selected': isSelected(asset.spaceId, asset.revisionId) }"
                :aria-pressed="isSelected(asset.spaceId, asset.revisionId)"
                @click="openAsset(asset)"
              >
                <span class="row-index">{{ padIndex(index) }}</span>
                <span class="row-body">
                  <span class="row-top">
                    <span class="row-name">{{ asset.title }}</span>
                    <StatusBadge :status="asset.status" />
                  </span>
                  <span class="row-summary">{{ asset.summary ?? "暂无摘要" }}</span>
                  <span class="row-facts">
                    <span class="fact is-type">{{ asset.assetType }}</span>
                    <span class="fact">{{ spaceShort(asset.spaceId) }}</span>
                    <span class="fact" :class="qualityTone(asset.qualityDecision)">
                      {{ qualityDecisionLabel(asset.qualityDecision) }}
                    </span>
                    <span v-for="tag in asset.labels.slice(0, 3)" :key="tag" class="fact is-label">
                      {{ tag }}
                    </span>
                    <span v-if="asset.labels.length > 3" class="fact">
                      +{{ asset.labels.length - 3 }}
                    </span>
                  </span>
                  <span class="row-cite">
                    <ShieldCheck :size="11" aria-hidden="true" />
                    {{ asset.qualityAttestationRefs.length }} 项质量证明
                  </span>
                </span>
                <span class="row-side">
                  <span class="hash-chip">rev {{ shortRevision(asset.revisionId) }}</span>
                  <span class="row-time">{{ formatRelativeTime(asset.indexedAt) }}</span>
                </span>
                <ChevronRight :size="15" class="row-chevron" aria-hidden="true" />
              </button>
            </template>

            <template v-else>
              <button
                v-for="(entry, index) in displayedResults ?? []"
                :key="`${entry.item.spaceId}-${entry.item.revisionId}`"
                type="button"
                class="knowledge-row"
                :class="{ 'is-selected': isSelected(entry.item.spaceId, entry.item.revisionId) }"
                :aria-pressed="isSelected(entry.item.spaceId, entry.item.revisionId)"
                @click="openQueryResult(entry)"
              >
                <span class="row-index">{{ padIndex(index) }}</span>
                <span class="row-body">
                  <span class="row-top">
                    <span class="row-name">{{ entry.item.title }}</span>
                    <StatusBadge :status="queryStatus(entry.item)" />
                    <span class="score-pill" title="本次排序分，只表示查询相关性">
                      排序 {{ scoreText(entry.item) }}
                    </span>
                  </span>
                  <span class="row-summary">{{
                    entry.item.summary ?? entry.item.citations[0]?.quote ?? "暂无摘要"
                  }}</span>
                  <span class="row-facts">
                    <span class="fact is-type">{{ entry.item.assetType }}</span>
                    <span class="fact">{{ spaceShort(entry.item.spaceId) }}</span>
                    <span class="fact" :class="qualityTone(entry.item.qualityDecision)">
                      {{ qualityDecisionLabel(entry.item.qualityDecision) }}
                    </span>
                    <span v-if="sourceCount(entry.item) > 0" class="fact">
                      {{ sourceCount(entry.item) }} 个来源
                    </span>
                  </span>
                  <span class="row-cite">
                    <Quote :size="11" aria-hidden="true" />
                    {{ entry.item.citations.length }} 个 Passage 引用 ·
                    {{ entry.item.obligations.length }} 项义务
                  </span>
                </span>
                <span class="row-side">
                  <span class="hash-chip">rev {{ shortRevision(entry.item.revisionId) }}</span>
                  <span class="row-time">{{ formatRelativeTime(entry.indexedThrough) }}</span>
                </span>
                <ChevronRight :size="15" class="row-chevron" aria-hidden="true" />
              </button>
            </template>
          </div>

          <div v-if="searchSession?.nextCursor !== undefined" class="load-more-bar">
            <button
              v-if="sessionMatchesDraft"
              type="button"
              class="btn btn-sm"
              :disabled="searching"
              @click="loadMore"
            >
              <LoaderCircle v-if="searching" :size="13" class="spin" />
              {{ searching ? "加载中…" : "加载更多结果" }}
            </button>
            <p v-else class="note-block is-warn pagination-stale" role="status">
              搜索词或筛选条件已更改，请先应用后再继续分页，旧 Cursor 不会用于新条件。
            </p>
          </div>
        </section>
      </div>

      <button
        v-if="selected !== undefined"
        type="button"
        class="detail-backdrop"
        aria-label="关闭知识详情"
        @click="clearDetail"
      />

      <aside
        ref="detailPanel"
        class="panel detail"
        :class="{ 'is-empty': selected === undefined }"
        aria-label="知识详情"
        :tabindex="selected === undefined ? undefined : -1"
      >
        <div v-if="selected === undefined" class="detail-placeholder">
          <span class="placeholder-mark"><BookOpenText :size="22" /></span>
          <h3>选择一个知识版本</h3>
          <p>查看正文、来源、质量证明、义务和 Passage 引用。</p>
          <div class="placeholder-tags">
            <span>正文</span><span>来源与边界</span><span>引用</span><span>反馈</span>
          </div>
        </div>

        <template v-else>
          <header class="detail-head">
            <div class="detail-type">
              <span>{{ selected.assetType }}</span>
              <StatusBadge :status="selected.status" />
            </div>
            <button type="button" class="icon-button" aria-label="关闭详情" @click="clearDetail">
              <X :size="17" />
            </button>
          </header>

          <div class="detail-intro">
            <h2>{{ selected.title }}</h2>
            <p>{{ selected.summary ?? "此知识版本没有摘要。" }}</p>
            <div class="detail-revline">
              <ElTooltip :content="selected.revisionId" placement="top">
                <span class="hash-chip" tabindex="0">rev {{ shortRevision(selected.revisionId) }}</span>
              </ElTooltip>
              <span>索引于 {{ formatRelativeTime(selected.indexedAt) }}</span>
            </div>
          </div>

          <dl class="detail-meta">
            <div>
              <dt>Record</dt>
              <dd class="mono" :title="selected.recordId">{{ shortId(selected.recordId, 26) }}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd class="mono" :title="selected.revisionId">{{ shortRevision(selected.revisionId) }}</dd>
            </div>
            <div>
              <dt>Space</dt>
              <dd class="mono" :title="selected.spaceId">{{ spaceShort(selected.spaceId) }}</dd>
            </div>
            <div>
              <dt>质量决策</dt>
              <dd class="quality-cell">
                <ShieldCheck :size="12" aria-hidden="true" />
                {{ qualityDecisionLabel(selected.qualityDecision) }}
              </dd>
            </div>
          </dl>

          <section v-if="selectedEvidence" class="detail-section trust-section">
            <h3><Sparkles :size="14" aria-hidden="true" /> 为什么返回这条知识</h3>
            <p class="trust-copy">
              它在当前授权 Space 和 purpose 内通过治理门禁，并由 Passage 检索进入本次排序；排序分只表示本次查询相关性，不代表知识可信度。
            </p>
            <dl class="trust-grid">
              <div>
                <dt>召回方法</dt>
                <dd>{{ selectedEvidence.item.scores[0]?.method ?? "未声明" }}</dd>
              </div>
              <div>
                <dt>本次排序分</dt>
                <dd class="num">{{ scoreText(selectedEvidence.item) }}</dd>
              </div>
              <div>
                <dt>质量结论</dt>
                <dd>{{ qualityDecisionLabel(selectedEvidence.item.qualityDecision) }}</dd>
              </div>
              <div>
                <dt>稳定引用</dt>
                <dd>{{ selectedEvidence.item.citations.length }} 个 Passage</dd>
              </div>
              <div>
                <dt>策略水位</dt>
                <dd :title="selectedEvidence.policyEpoch">
                  {{ shortId(selectedEvidence.policyEpoch, 18) }}
                </dd>
              </div>
              <div>
                <dt>曝光回执</dt>
                <dd :title="selectedEvidence.queryReceiptId">
                  {{ shortId(selectedEvidence.queryReceiptId, 18) }}
                </dd>
              </div>
            </dl>
          </section>

          <section class="detail-section">
            <div class="section-head">
              <h3><BookOpenText :size="14" aria-hidden="true" /> 正文</h3>
              <ElTooltip :content="selected.revisionId" placement="top">
                <span class="hash-chip" tabindex="0">rev {{ shortRevision(selected.revisionId) }}</span>
              </ElTooltip>
            </div>
            <LoadingState v-if="detailLoading" label="读取已校验 Payload" />
            <div v-else-if="detailError" class="detail-read-error" role="alert">
              <AlertTriangle :size="16" aria-hidden="true" />
              <div>
                <strong>正文读取失败</strong>
                <p>{{ detailError.message }}</p>
              </div>
              <button
                v-if="!isUnreadable(selected.status)"
                type="button"
                class="btn btn-sm"
                @click="loadRevision(selected)"
              >
                <RefreshCw :size="13" /> 重试
              </button>
            </div>
            <p v-else-if="revision === undefined" class="muted-copy">正文尚未载入。</p>
            <pre v-else class="content-preview">{{ revision.content }}</pre>
          </section>

          <ElCollapse v-if="boundaryVisible" v-model="openSections" class="detail-collapse">
            <ElCollapseItem name="boundary">
              <template #title>
                <span class="collapse-title">
                  <GitBranch :size="14" aria-hidden="true" /> 来源与适用边界
                  <em>{{ provenanceSources.length }} 个主要来源</em>
                </span>
              </template>
              <div class="boundary-grid">
                <div>
                  <strong class="boundary-label">主要来源</strong>
                  <p v-if="provenanceSources.length === 0" class="muted-copy">未声明主要来源。</p>
                  <ul v-else class="source-list">
                    <li v-for="source in provenanceSources" :key="source">
                      <a
                        v-if="safeHttpUrl(source)"
                        class="source-link"
                        :href="source"
                        rel="noreferrer"
                        target="_blank"
                        >{{ source }}</a
                      >
                      <span v-else class="source-text">{{ source }}</span>
                    </li>
                  </ul>
                  <p v-if="generatedByActor" class="boundary-note">生成主体：{{ generatedByActor }}</p>
                </div>
                <dl class="scope-grid">
                  <div><dt>语言 / 地域</dt><dd>{{ scopeLocale }}</dd></div>
                  <div><dt>复审时间</dt><dd>{{ scopeReviewAfter }}</dd></div>
                  <div><dt>有效期</dt><dd>{{ scopeValidity }}</dd></div>
                  <div><dt>允许用途</dt><dd>{{ scopePurposes }}</dd></div>
                  <div><dt>分类 / 导出</dt><dd>{{ scopeClassification }}</dd></div>
                </dl>
              </div>
              <div v-if="assumptions.length > 0" class="assumption-block">
                <strong>适用假设</strong>
                <ul>
                  <li v-for="assumption in assumptions" :key="assumption">{{ assumption }}</li>
                </ul>
              </div>
            </ElCollapseItem>
          </ElCollapse>

          <section class="detail-section">
            <h3><Quote :size="14" aria-hidden="true" /> 引用与义务</h3>
            <p v-if="selectedEvidence === undefined" class="muted-copy">
              通过检索打开此版本后可复制 Passage 引用并记录任务结果。
            </p>
            <template v-else>
              <div class="citation-summary">
                <strong>{{ selectedEvidence.item.citations.length }} 个 Passage 引用</strong>
                <span>{{ obligationText(selectedEvidence.item.obligations) }}</span>
                <button type="button" class="btn btn-sm" @click="copyCitation">
                  <Check v-if="copied" :size="13" />
                  <Copy v-else :size="13" />
                  {{ copied ? "已复制" : "复制引用" }}
                </button>
              </div>
              <blockquote
                v-for="citation in selectedEvidence.item.citations"
                :key="citation.citationId"
                class="citation"
              >
                <Quote :size="12" class="citation-mark" aria-hidden="true" />
                <p>{{ citation.quote ?? "该引用没有内联摘录。" }}</p>
                <small class="mono">{{ locatorText(citation.locator) }}</small>
              </blockquote>
            </template>
          </section>

          <section class="detail-section">
            <h3><ShieldCheck :size="14" aria-hidden="true" /> 质量依据</h3>
            <p
              v-for="reason in selected.qualityReasons"
              :key="reason"
              class="reason-box"
              :class="{ 'is-warn': selected.qualityDecision === 'suitable_with_warning' }"
            >
              {{ reason }}
            </p>
            <p v-if="selected.qualityReasons.length === 0" class="muted-copy">
              该版本没有附带质量理由。
            </p>
            <div class="attestation-line">
              <span>Attestation</span>
              <ElTooltip
                v-for="reference in selected.qualityAttestationRefs"
                :key="reference"
                :content="reference"
                placement="top"
              >
                <span class="hash-chip" tabindex="0">{{ shortId(reference, 20) }}</span>
              </ElTooltip>
              <span v-if="selected.qualityAttestationRefs.length === 0">未绑定证明</span>
            </div>
          </section>

          <section class="detail-section">
            <h3><PenLine :size="14" aria-hidden="true" /> 后续动作</h3>
            <div class="detail-actions">
              <RouterLink
                class="btn action-primary"
                :to="`/contribute?base=${encodeURIComponent(selected.revisionId)}&space=${encodeURIComponent(selected.spaceId)}`"
              >
                <PenLine :size="14" /> 发起修订
              </RouterLink>
              <template v-if="selectedEvidence">
                <div v-if="outcomeState === 'saved'" class="feedback-saved">
                  <Check :size="14" aria-hidden="true" />
                  <span>任务结果已形成治理证据</span>
                  <ElTooltip v-if="outcomeReceipt !== undefined" :content="outcomeReceipt" placement="top">
                    <span class="hash-chip" tabindex="0">曝光回执 {{ shortId(outcomeReceipt, 16) }}</span>
                  </ElTooltip>
                </div>
                <template v-else>
                  <div class="feedback-buttons">
                    <button
                      type="button"
                      class="btn btn-sm"
                      :disabled="outcomeState === 'saving'"
                      @click="recordOutcome('helped')"
                    >
                      <ThumbsUp :size="13" /> 有帮助
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost"
                      :disabled="outcomeState === 'saving'"
                      @click="recordOutcome('neutral')"
                    >
                      一般
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-danger"
                      :disabled="outcomeState === 'saving'"
                      @click="recordOutcome('harmed')"
                    >
                      <ThumbsDown :size="13" /> 有伤害
                    </button>
                  </div>
                  <p v-if="outcomeState === 'saving'" class="feedback-saving" role="status">
                    正在写入治理证据…
                  </p>
                </template>
              </template>
            </div>
          </section>
        </template>
      </aside>
    </div>

    <ElDialog
      v-model="evidenceOpen"
      title="本次检索的证据"
      width="min(560px, 92vw)"
      append-to-body
      class="evidence-dialog"
    >
      <template v-if="searchSession">
        <p class="dialog-intro">
          这次返回绑定在同一个请求快照上：策略水位、投影代数与快照共同决定结果能否复现。
        </p>
        <dl class="evidence-dl">
          <div><dt>查询</dt><dd>{{ searchSession.criteria.query }}</dd></div>
          <div><dt>Space</dt><dd>{{ searchSession.criteria.spaceId ?? "Principal 允许范围" }}</dd></div>
          <div>
            <dt>知识类型</dt>
            <dd>{{ searchSession.criteria.assetTypes.join(" · ") || "全部类型" }}</dd>
          </div>
          <div><dt>标签</dt><dd>{{ searchSession.criteria.labels.join(" · ") || "未限定" }}</dd></div>
          <div><dt>请求预算</dt><dd>{{ REQUEST_BUDGET }} 条</dd></div>
          <div><dt>策略水位</dt><dd>{{ searchSession.policyEpoch }}</dd></div>
          <div><dt>投影代数</dt><dd>{{ searchSession.projectionGeneration }}</dd></div>
          <div><dt>快照</dt><dd>{{ searchSession.snapshot }}</dd></div>
          <div><dt>曝光回执</dt><dd>{{ searchSession.queryReceiptId }}</dd></div>
          <div><dt>索引截至</dt><dd>{{ formatDateTime(searchSession.indexedThrough) }}</dd></div>
        </dl>
        <p class="dialog-foot">
          {{ BRAND.protocol.label }} · 快照与回执只对本次请求有效，不会沿用到新的筛选条件。
        </p>
      </template>
      <template #footer>
        <button type="button" class="btn btn-sm" @click="evidenceOpen = false">关闭</button>
      </template>
    </ElDialog>
  </template>
</template>

<style scoped>
.knowledge-split {
  align-items: start;
}

.knowledge-main {
  display: grid;
  gap: var(--gap);
  min-width: 0;
}

/* ---------- 检索面板 ---------- */
.search-panel {
  padding: 14px 16px 13px;
  background: var(--card);
}

.search-form {
  display: flex;
  align-items: center;
  gap: 9px;
}

.search-glyph {
  color: var(--faint);
}

.search-input {
  flex: 1 1 auto;
  min-width: 0;
}

.search-input :deep(.el-input__wrapper) {
  padding: 1px 12px;
  background: var(--paper);
}

.search-input :deep(.el-input__inner) {
  height: 36px;
  font-size: 13px;
}

.search-kbd {
  padding: 4px 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--faint);
  font: 500 10px/1 var(--mono);
}

.clear-search {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  color: var(--faint);
  transition: color 0.15s var(--ease), background 0.15s var(--ease);
}

.clear-search:hover {
  background: var(--slate-soft);
  color: var(--ink);
}

.search-submit {
  height: 38px;
}

.spin {
  animation: knowledge-spin 0.9s linear infinite;
}

@keyframes knowledge-spin {
  to {
    transform: rotate(360deg);
  }
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 12px;
  margin-top: 13px;
  padding-top: 13px;
  border-top: 1px solid var(--line-soft);
}

.filter-control {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.filter-control > span {
  color: var(--faint);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.type-select {
  width: 132px;
}

.label-input {
  width: 136px;
}

.scope-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding-bottom: 1px;
}

.scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--muted);
  font: 500 10px/1.2 var(--mono);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.scope-chip.is-active {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.scope-chip.is-button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.apply-filters {
  margin-bottom: 0;
}

/* ---------- 结果面板 ---------- */
.results-panel {
  overflow: hidden;
}

.results-panel :deep(.loading) {
  min-height: 210px;
  padding: 0 18px;
  font-size: 12px;
}

.results-head {
  align-items: center;
}

.result-kicker {
  margin-bottom: 5px;
  color: var(--faint);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.results-head h2 {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0;
}

.results-head h2 strong {
  color: var(--ink);
  font: 600 23px/1 var(--sans);
  letter-spacing: -0.6px;
  font-variant-numeric: tabular-nums;
}

.results-tools {
  display: flex;
  align-items: center;
  gap: 14px;
}

.searching-note {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--faint);
  font: 500 10px/1 var(--mono);
}

.sort-control {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--faint);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.1em;
}

.sort-select {
  width: 94px;
}

/* ---------- 检索证据条 ---------- */
.evidence-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 13px;
  padding: 9px 18px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--card-warm);
  color: var(--muted);
  font: 500 10.5px/1.7 var(--mono);
}

.evidence-strip > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.evidence-strip b {
  color: var(--ink-2);
  font-weight: 600;
}

.evidence-strip .is-jade {
  color: var(--jade);
}

.evidence-strip time {
  color: var(--ink-2);
}

.evidence-more {
  margin-left: auto;
  color: var(--accent);
  font: 500 10.5px/1.6 var(--mono);
  border-bottom: 1px solid var(--accent-line);
  padding-bottom: 1px;
}

.evidence-more:hover {
  border-color: var(--accent);
}

/* ---------- 结果行 ---------- */
.knowledge-list {
  display: flex;
  flex-direction: column;
}

.knowledge-row {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto 13px;
  align-items: start;
  gap: 12px;
  width: 100%;
  padding: 13px 18px 13px 14px;
  border-bottom: 1px solid var(--line-soft);
  text-align: left;
  color: inherit;
  transition: background 0.15s var(--ease);
}

.knowledge-row:last-child {
  border-bottom: 0;
}

.knowledge-row:hover,
.knowledge-row.is-selected {
  background: var(--paper);
}

.knowledge-row::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.15s var(--ease);
}

.knowledge-row.is-selected::before {
  opacity: 1;
}

.row-index {
  padding-top: 2px;
  color: var(--faint);
  font: 500 10px/1.9 var(--mono);
  font-variant-numeric: tabular-nums;
}

.row-body {
  display: block;
  min-width: 0;
}

.row-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.row-name {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
  line-height: 1.45;
}

.row-summary {
  display: -webkit-box;
  margin-top: 4px;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.row-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.fact {
  padding: 2px 5px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font: 500 9.5px/1.5 var(--mono);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.fact.is-type {
  border-color: var(--line);
  background: var(--paper);
  color: var(--ink-2);
}

.fact.is-quality {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.fact.is-warning {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.fact.is-label {
  background: var(--card-warm);
}

.score-pill {
  padding: 2px 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card-warm);
  color: var(--ink-2);
  font: 600 9.5px/1.5 var(--mono);
  font-variant-numeric: tabular-nums;
}

.row-cite {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  color: var(--faint);
  font: 500 10px/1.5 var(--mono);
  letter-spacing: 0.02em;
}

.row-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  padding-top: 1px;
}

.row-side .hash-chip {
  color: var(--ink-2);
  white-space: nowrap;
}

.row-time {
  color: var(--faint);
  font: 500 10px/1.4 var(--mono);
  white-space: nowrap;
}

.row-chevron {
  margin-top: 3px;
  color: var(--faint);
}

/* ---------- 结果底部 ---------- */
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.load-more-bar {
  display: flex;
  justify-content: center;
  padding: 12px 18px;
  border-top: 1px solid var(--line-soft);
}

.pagination-stale {
  width: 100%;
  margin: 0;
}

/* ---------- 详情 ---------- */
.detail {
  position: sticky;
  top: calc(var(--topbar-height) + 26px);
  max-height: calc(100vh - var(--topbar-height) - 52px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.detail.is-empty {
  background: var(--card-warm);
}

.detail-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 380px;
  padding: 34px 26px;
  text-align: center;
}

.placeholder-mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
  color: var(--faint);
}

.detail-placeholder h3 {
  font-size: 14px;
}

.detail-placeholder p {
  max-width: 250px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.placeholder-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
  margin-top: 16px;
}

.placeholder-tags span {
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--faint);
  font: 500 9.5px/1.5 var(--mono);
}

.detail-head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
}

.detail-type {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.detail-type > span:first-child {
  overflow: hidden;
  color: var(--faint);
  font: 500 9.5px/1 var(--mono);
  letter-spacing: 0.12em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.detail-intro {
  padding: 16px 16px 4px;
}

.detail-intro h2 {
  font-size: 17px;
  line-height: 1.35;
  letter-spacing: -0.3px;
}

.detail-intro > p {
  margin-top: 7px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.detail-revline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-top: 11px;
  color: var(--faint);
  font: 500 10px/1.5 var(--mono);
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 12px 16px 0;
  border-top: 1px solid var(--line-soft);
  border-left: 1px solid var(--line-soft);
}

.detail-meta > div {
  min-width: 0;
  padding: 8px 10px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}

.detail-meta dt {
  color: var(--faint);
  font: 600 9px/1.2 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.detail-meta dd {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta dd.mono {
  font-size: 10.5px;
  letter-spacing: 0.01em;
}

.detail-meta .quality-cell {
  color: var(--jade);
  font-size: 11px;
}

/* ---------- 详情通用 section ---------- */
.detail-section {
  padding: 15px 16px;
  border-top: 1px solid var(--line);
}

.detail-section > h3,
.section-head h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink);
  font-size: 12.5px;
  letter-spacing: -0.1px;
}

.detail-section > h3 {
  margin-bottom: 9px;
}

.detail-section > h3 svg,
.section-head h3 svg {
  color: var(--faint);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 9px;
}

.muted-copy {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.trust-section {
  background: var(--card-warm);
}

.trust-copy {
  margin-bottom: 11px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.7;
}

.trust-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px 12px;
}

.trust-grid dt {
  color: var(--faint);
  font: 600 9px/1.2 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.trust-grid dd {
  margin-top: 3px;
  overflow-wrap: anywhere;
  color: var(--ink-2);
  font: 500 11px/1.5 var(--mono);
  font-variant-numeric: tabular-nums;
}

/* ---------- 正文 ---------- */
.content-preview {
  max-height: 380px;
  margin: 0;
  overflow: auto;
  padding: 13px 14px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink-2);
  font: 400 12.5px/1.85 var(--sans);
  white-space: pre-wrap;
  word-break: break-word;
}

.detail :deep(.loading) {
  min-height: 96px;
  padding: 0;
  justify-content: flex-start;
  font-size: 12px;
}

.detail-read-error {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent);
}

.detail-read-error > div {
  flex: 1;
  min-width: 0;
}

.detail-read-error strong {
  font-size: 12px;
}

.detail-read-error p {
  margin-top: 3px;
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.6;
}

.detail-read-error .btn {
  align-self: center;
}

/* ---------- 来源与边界 ---------- */
.detail-collapse {
  border-top: 1px solid var(--line);
}

.detail-collapse :deep(.el-collapse-item__header) {
  height: auto;
  padding: 13px 16px;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
}

.detail-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
  background: transparent;
}

.detail-collapse :deep(.el-collapse-item__content) {
  padding: 13px 16px 15px;
}

.collapse-title {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.1px;
}

.collapse-title svg {
  color: var(--faint);
}

.collapse-title em {
  margin-left: auto;
  color: var(--faint);
  font: 500 9.5px/1 var(--mono);
  font-style: normal;
  letter-spacing: 0.06em;
}

.boundary-grid {
  display: grid;
  gap: 14px;
}

.boundary-label {
  display: block;
  margin-bottom: 6px;
  color: var(--faint);
  font: 600 9px/1.2 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.source-list {
  display: grid;
  gap: 4px;
}

.source-list li {
  overflow-wrap: anywhere;
}

.source-link {
  color: var(--accent);
  font: 500 10.5px/1.65 var(--mono);
  border-bottom: 1px solid var(--accent-line);
}

.source-link:hover {
  border-color: var(--accent);
}

.source-text {
  color: var(--ink-2);
  font: 500 10.5px/1.65 var(--mono);
}

.boundary-note {
  margin-top: 9px;
  color: var(--faint);
  font-size: 11px;
  line-height: 1.6;
}

.scope-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px 12px;
}

.scope-grid dt {
  color: var(--faint);
  font: 600 9px/1.2 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.scope-grid dd {
  margin-top: 3px;
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.assumption-block {
  margin-top: 14px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
}

.assumption-block strong {
  display: block;
  margin-bottom: 6px;
  color: var(--faint);
  font: 600 9px/1.2 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.assumption-block ul {
  display: grid;
  gap: 4px;
}

.assumption-block li {
  position: relative;
  padding-left: 12px;
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.6;
}

.assumption-block li::before {
  content: "—";
  position: absolute;
  left: 0;
  color: var(--faint);
}

/* ---------- 引用 ---------- */
.citation-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: var(--card-warm);
}

.citation-summary strong {
  font-size: 12px;
}

.citation-summary span {
  color: var(--muted);
  font: 500 10px/1.5 var(--mono);
}

.citation-summary .btn {
  margin-left: auto;
}

.citation {
  position: relative;
  margin: 9px 0 0;
  padding: 10px 12px 10px 13px;
  border-left: 2px solid var(--line-2);
  border-radius: 0 var(--radius) var(--radius) 0;
  background: var(--paper);
}

.citation-mark {
  margin-bottom: 4px;
  color: var(--faint);
}

.citation p {
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.75;
}

.citation small {
  display: block;
  margin-top: 6px;
  overflow-wrap: anywhere;
  color: var(--faint);
  font: 500 9.5px/1.5 var(--mono);
}

/* ---------- 质量 ---------- */
.reason-box {
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: var(--card-warm);
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.65;
}

.reason-box:last-of-type {
  margin-bottom: 0;
}

.reason-box.is-warn {
  border-color: var(--gold-line);
  background: var(--gold-soft);
}

.attestation-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  color: var(--faint);
  font: 500 9.5px/1.4 var(--mono);
}

.attestation-line > span:first-child {
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* ---------- 后续动作 ---------- */
.detail-actions {
  display: grid;
  gap: 9px;
}

.action-primary {
  width: 100%;
}

.feedback-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.feedback-saved {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--jade-line);
  border-radius: var(--radius);
  background: var(--jade-soft);
  color: var(--jade);
  font-size: 11.5px;
}

.feedback-saved .hash-chip {
  border-color: var(--jade-line);
  background: transparent;
  color: var(--jade);
}

.feedback-saving {
  color: var(--muted);
  font-size: 11px;
}

/* ---------- 证据弹窗 ---------- */
.dialog-intro {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.evidence-dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 13px;
  border-top: 1px solid var(--line-soft);
  border-left: 1px solid var(--line-soft);
}

.evidence-dl > div {
  min-width: 0;
  padding: 8px 10px;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}

.evidence-dl dt {
  color: var(--faint);
  font: 600 9px/1.2 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.evidence-dl dd {
  margin-top: 3px;
  overflow-wrap: anywhere;
  color: var(--ink-2);
  font: 500 10.5px/1.5 var(--mono);
}

.dialog-foot {
  margin-top: 12px;
  color: var(--faint);
  font-size: 9.5px;
  letter-spacing: 0.03em;
}

/* ---------- 窄屏 ---------- */
.detail-backdrop {
  display: none;
}

@media (max-width: 1180px) {
  .detail {
    position: static;
    max-height: none;
  }
}

@media (max-width: 1080px) {
  .detail {
    position: fixed;
    inset: calc(var(--topbar-height) + 10px) 10px 10px;
    z-index: 40;
    max-height: none;
    overflow-y: auto;
    background: var(--card);
  }

  .detail-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 35;
    background: color-mix(in srgb, var(--ink) 42%, transparent);
  }
}

@media (max-width: 720px) {
  .search-glyph,
  .search-kbd {
    display: none;
  }

  .filter-control,
  .type-select,
  .label-input {
    width: 100%;
  }

  .scope-filters {
    margin-left: 0;
  }

  .results-tools {
    gap: 8px;
  }

  .knowledge-row {
    grid-template-columns: minmax(0, 1fr) auto 13px;
    gap: 9px;
    padding-right: 14px;
  }

  .row-index {
    display: none;
  }

  .row-side .hash-chip {
    font-size: 9.5px;
  }

  .evidence-dl {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail {
    inset: var(--topbar-height) 0 0;
    border-radius: 0;
  }
}
</style>
