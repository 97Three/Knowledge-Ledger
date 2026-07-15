<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { useRouter } from "vue-router";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  DatabaseZap,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { BRAND, PROTOCOL_LABEL } from "@/brand";
import { getCapability, searchKnowledge } from "@/api/client";
import {
  createDemoKnowledgeCandidate,
  publishDemoKnowledge,
  type DemoKnowledge,
} from "@/api/demo";
import { useOnboardingStore } from "@/stores/onboarding";

const DEMO_SPACE = "https://knowledge.local/spaces/demo-onboarding";
const DEMO_TITLE = "Agent 知识贡献检查清单";

const STEP_NAMES = ["连接节点", "导入知识", "审核发布", "引用检索", "Agent 接入"] as const;

interface StepMeta {
  readonly action: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly hint: string;
  readonly icon: Component;
  readonly learn: string;
  readonly title: string;
}

const STEP_META: readonly [StepMeta, StepMeta, StepMeta, StepMeta, StepMeta] = [
  {
    action: "测试连接",
    description:
      "平台会读取标准能力文档，确认协议版本、Profile 与可用 Operations；后面的每一步都建立在真实节点能力之上。",
    eyebrow: "CAPABILITY",
    hint: "只读能力发现 · 不写入任何知识",
    icon: DatabaseZap,
    learn: "不硬编码节点能力，接入前先做能力发现。",
    title: "连接你的第一个知识节点",
  },
  {
    action: "创建示例候选",
    description:
      "示例内容会在浏览器内生成 Payload Digest 与 Revision ID，然后作为候选提交到隔离的演示 Space，等待独立审核。",
    eyebrow: "CONTRIBUTE",
    hint: "隔离的 demo-onboarding Space · 可随时重置",
    icon: Sparkles,
    learn: "候选不等于已发布事实，贡献与发布是两件事。",
    title: "创建第一条知识候选",
  },
  {
    action: "生成评测并发布",
    description:
      "服务端绑定实际 Schema 校验与安全扫描，Curator 与 Publisher 分别签发审核、策略证明，知识才会进入 Published Channel。",
    eyebrow: "REVIEW & PUBLISH",
    hint: "Curator 审核 · Publisher 发布",
    icon: ShieldCheck,
    learn: "贡献、评测、审核、发布职责分离。",
    title: "用独立角色完成审核与发布",
  },
  {
    action: "运行真实检索",
    description:
      "检索只会从 Published Channel 返回结果，并附上 Passage Citation、Revision 与策略义务，让每个回答都能回到原文。",
    eyebrow: "RETRIEVAL",
    hint: "只读取已发布知识 · 不产生写入",
    icon: Search,
    learn: "每次消费都保留可审计的引用上下文。",
    title: "执行一次带稳定引用的检索",
  },
  {
    action: "我已了解接入方式",
    description:
      "Agent 应先做能力发现、声明用途与支持的 obligations，并在回答里保留所引用的 Citation。",
    eyebrow: "AGENT ACCESS",
    hint: "可随时从 /agents 查看完整接入文档",
    icon: Bot,
    learn: "Agent 共享的是受治理知识，不是无边界记忆。",
    title: "让 Agent 使用这份知识",
  },
];

const AGENT_SNIPPET = `import { NIANClient } from "@nian/sdk";

const knowledge = new NIANClient({
  baseUrl: "https://knowledge.example/nian/0.1",
  token: () => process.env.NIAN_TOKEN!,
  supportedObligations: ["cite", "no-train"],
});

const context = await knowledge.createContextPack({
  task: "生成带引用的退款处理步骤",
  purpose: "customer-support",
  budgetCharacters: 12_000,
});

console.log(context.contextDigest, context.passages);`;

interface ConnectionInfo {
  readonly name: string;
  readonly operations: number;
  readonly profiles: number;
  readonly protocol: string;
  readonly trustDomain: string;
}

const store = useOnboardingStore();
const router = useRouter();

const closeButton = ref<HTMLButtonElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const busy = ref(false);
const error = ref("");
const connection = ref<ConnectionInfo | undefined>(undefined);
const searchHits = ref<number | undefined>(undefined);
const queryReceipt = ref("");

function firstIncomplete(): number {
  for (let index = 0; index < store.totalSteps; index += 1) {
    if (!store.completed.includes(index)) return index;
  }
  return store.totalSteps - 1;
}

const step = ref(firstIncomplete());
const demo = computed<DemoKnowledge | undefined>(() => store.demo);
const activeStep = computed<StepMeta>(() => STEP_META[step.value] ?? STEP_META[0]);
const connectedNodeName = computed(() => connection.value?.name ?? "");
const connectedTrustDomain = computed(() => connection.value?.trustDomain ?? "—");
const connectedProtocol = computed(() => connection.value?.protocol ?? "");
const connectedOperationCount = computed(() => connection.value?.operations ?? 0);
const connectedProfileCount = computed(() => connection.value?.profiles ?? 0);

let previousOverflow = "";
let previousFocus: HTMLElement | undefined;

watch(
  () => store.isOpen,
  (open, wasOpen) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      step.value = firstIncomplete();
      error.value = "";
      void nextTick(() => closeButton.value?.focus());
      return;
    }
    if (wasOpen === true) {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
      previousFocus = undefined;
    }
  },
  { immediate: true },
);

watch(step, () => {
  error.value = "";
  contentRef.value?.scrollTo({ top: 0 });
});

function isDone(index: number): boolean {
  return store.completed.includes(index);
}

function isLocked(index: number): boolean {
  return index > 0 && !isDone(index - 1) && !isDone(index);
}

function railClass(index: number): Record<string, boolean> {
  return {
    "is-active": index === step.value,
    "is-done": isDone(index),
    "is-locked": isLocked(index),
  };
}

function shortId(value: string, maxLength = 44): string {
  if (value.length === 0) return "—";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function describeError(caught: unknown): string {
  if (caught instanceof Error && caught.message.trim().length > 0) return caught.message;
  return "操作失败，请稍后重试";
}

function goTo(index: number): void {
  if (busy.value || isLocked(index)) return;
  step.value = index;
}

function prevStep(): void {
  if (busy.value || step.value === 0) return;
  step.value -= 1;
}

function goNext(): void {
  if (busy.value || !isDone(step.value)) return;
  if (step.value >= store.totalSteps - 1) {
    finishWizard();
    return;
  }
  step.value += 1;
}

function dismissWizard(): void {
  store.dismiss();
}

function skipWizard(): void {
  store.dismiss();
  ElMessage.info("已跳过引导，可随时从侧栏「新手任务」重新打开");
}

function finishWizard(): void {
  if (!store.allDone) return;
  store.finish();
  ElMessage.success("引导完成，正在进入知识库");
  void router.push("/knowledge");
}

function resetWizard(): void {
  store.reset();
  step.value = 0;
  error.value = "";
  connection.value = undefined;
  searchHits.value = undefined;
  queryReceipt.value = "";
  ElMessage.info("引导已重置，示例知识将重新创建");
}

async function runStep(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const current = step.value;
  try {
    if (current === 0) {
      const capability = await getCapability();
      connection.value = {
        name: capability.node.name || "知识节点",
        operations: capability.operations.length,
        profiles: capability.profiles.length,
        protocol: capability.protocol || PROTOCOL_LABEL,
        trustDomain: capability.node.trustDomain ?? "—",
      };
      store.completeStep(0);
      ElMessage.success(`已连接知识节点：${capability.node.name || "知识节点"}`);
    } else if (current === 1) {
      const candidate = store.demo ?? (await createDemoKnowledgeCandidate(DEMO_SPACE));
      store.setDemo(candidate);
      store.completeStep(1);
      ElMessage.success("示例知识候选已创建，等待独立审核");
    } else if (current === 2) {
      const candidate = store.demo;
      if (candidate === undefined) throw new Error("请先导入示例知识候选");
      const published = await publishDemoKnowledge(candidate);
      store.setDemo(published);
      store.completeStep(2);
      ElMessage.success("审核与发布完成，知识已进入 Published Channel");
    } else if (current === 3) {
      const candidate = store.demo;
      if (candidate === undefined || !candidate.published) {
        throw new Error("请先完成示例知识的审核发布");
      }
      searchHits.value = undefined;
      queryReceipt.value = "";
      const response = await searchKnowledge({
        query: DEMO_TITLE,
        spaceId: candidate.spaceId,
      });
      if (response.results.length === 0) {
        throw new Error("没有找到示例知识，请先确认审核发布已完成");
      }
      searchHits.value = response.results.length;
      queryReceipt.value = response.queryReceiptId;
      store.completeStep(3);
      ElMessage.success(`检索命中 ${response.results.length} 条结果`);
    } else {
      store.completeStep(4);
      ElMessage.success("已了解 Agent 接入方式");
    }
  } catch (caught) {
    error.value = describeError(caught);
  } finally {
    busy.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!store.isOpen || event.key !== "Escape") return;
  event.preventDefault();
  dismissWizard();
}

onMounted(() => window.addEventListener("keydown", onKeydown));

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (store.isOpen) {
    document.body.style.overflow = previousOverflow;
    previousFocus?.focus();
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="ob-dialog">
      <div
        v-if="store.isOpen"
        class="ob-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <div class="ob-modal">
          <aside class="ob-rail">
            <div class="ob-brand">
              <span class="ob-brand-mark"><Sparkles :size="15" /></span>
              <div class="ob-brand-copy">
                <strong>{{ BRAND.nameZh }} {{ BRAND.name }}</strong>
                <small>新手引导 · 5 分钟上手</small>
              </div>
            </div>

            <nav class="ob-nav" aria-label="引导步骤">
              <ol class="ob-steps">
                <li v-for="(name, index) in STEP_NAMES" :key="name" :class="railClass(index)">
                  <button type="button" :disabled="isLocked(index)" @click="goTo(index)">
                    <span class="ob-step-num">
                      <Check v-if="isDone(index)" :size="11" :stroke-width="2.4" />
                      <template v-else>{{ index + 1 }}</template>
                    </span>
                    <span class="ob-step-label">{{ name }}</span>
                    <span v-if="index === step" class="ob-step-now">当前</span>
                  </button>
                </li>
              </ol>
            </nav>

            <div class="ob-rail-foot">
              <p class="ob-rail-note">
                示例使用隔离的 demo-onboarding Space，可安全重置，不污染默认知识空间。
              </p>
              <button
                type="button"
                class="ob-reset"
                :disabled="busy"
                @click="resetWizard"
              >
                <RotateCcw :size="12" /> 重置引导
              </button>
            </div>
          </aside>

          <section class="ob-stage">
            <header class="ob-stage-head">
              <div class="ob-progress-copy">
                <span class="ob-progress-label">新手引导</span>
                <span class="ob-progress-count">
                  {{ store.completed.length }} / {{ store.totalSteps }}
                </span>
              </div>
              <button
                ref="closeButton"
                type="button"
                class="ob-close"
                aria-label="稍后继续"
                @click="dismissWizard"
              >
                <X :size="15" />
              </button>
            </header>

            <div
              class="ob-progress-track"
              role="progressbar"
              aria-label="新手引导完成进度"
              aria-valuemin="0"
              aria-valuemax="5"
              :aria-valuenow="store.completed.length"
            >
              <i :style="{ width: `${store.progress}%` }" />
            </div>

            <div ref="contentRef" class="ob-content">
              <div class="ob-content-head">
                <span class="ob-glyph" :class="{ 'is-done': isDone(step) }">
                  <component :is="activeStep.icon" :size="19" />
                </span>
                <div class="ob-heading">
                  <p class="eyebrow">STEP {{ step + 1 }} · {{ activeStep.eyebrow }}</p>
                  <h1 id="onboarding-title">{{ activeStep.title }}</h1>
                </div>
              </div>

              <p class="ob-lede">{{ activeStep.description }}</p>

              <div
                v-if="step === 0 && isDone(0) && connectedNodeName !== ''"
                class="ob-result"
              >
                <div class="ob-result-head">
                  <CheckCircle2 :size="14" />
                  <strong>能力发现成功</strong>
                  <span class="ob-result-meta">{{ PROTOCOL_LABEL }} · READY</span>
                </div>
                <div class="ob-result-body">
                  <div class="ob-kv">
                    <dt>节点</dt>
                    <dd>{{ connectedNodeName }}</dd>
                  </div>
                  <div class="ob-kv">
                    <dt>信任域</dt>
                    <dd class="mono">{{ connectedTrustDomain }}</dd>
                  </div>
                  <div class="ob-kv">
                    <dt>协议</dt>
                    <dd class="mono">{{ connectedProtocol }}</dd>
                  </div>
                  <div class="ob-kv">
                    <dt>Operations</dt>
                    <dd class="mono">
                      {{ connectedOperationCount }} 个 · {{ connectedProfileCount }} 个 Profile
                    </dd>
                  </div>
                </div>
              </div>

              <div
                v-if="step === 1 && isDone(1) && demo !== undefined"
                class="ob-result"
              >
                <div class="ob-result-head">
                  <CheckCircle2 :size="14" />
                  <strong>候选已创建，等待独立审核</strong>
                  <span class="ob-result-meta">CANDIDATE</span>
                </div>
                <div class="ob-result-body">
                  <div class="ob-kv">
                    <dt>Revision</dt>
                    <dd>
                      <code class="hash-chip ob-id" :title="demo?.revisionId ?? ''">
                        {{ shortId(demo?.revisionId ?? "") }}
                      </code>
                    </dd>
                  </div>
                  <div class="ob-kv">
                    <dt>Contribution</dt>
                    <dd>
                      <code class="hash-chip ob-id" :title="demo?.contributionId ?? ''">
                        {{ shortId(demo?.contributionId ?? "") }}
                      </code>
                    </dd>
                  </div>
                </div>
              </div>

              <div
                v-if="step === 2 && isDone(2) && demo?.published === true"
                class="ob-result"
              >
                <div class="ob-result-head">
                  <CheckCircle2 :size="14" />
                  <strong>校验、审核与发布完成</strong>
                  <span class="ob-result-meta">PUBLISHED CHANNEL</span>
                </div>
                <div class="ob-result-body">
                  <div class="ob-kv">
                    <dt>Record</dt>
                    <dd>
                      <code class="hash-chip ob-id" :title="demo?.recordId ?? ''">
                        {{ shortId(demo?.recordId ?? "") }}
                      </code>
                    </dd>
                  </div>
                  <div class="ob-kv">
                    <dt>Revision</dt>
                    <dd>
                      <code class="hash-chip ob-id" :title="demo?.revisionId ?? ''">
                        {{ shortId(demo?.revisionId ?? "") }}
                      </code>
                    </dd>
                  </div>
                  <div class="ob-kv">
                    <dt>Contribution</dt>
                    <dd>
                      <code class="hash-chip ob-id" :title="demo?.contributionId ?? ''">
                        {{ shortId(demo?.contributionId ?? "") }}
                      </code>
                    </dd>
                  </div>
                </div>
              </div>

              <div
                v-if="step === 3 && isDone(3) && searchHits !== undefined"
                class="ob-result"
              >
                <div class="ob-result-head">
                  <CheckCircle2 :size="14" />
                  <strong>检索成功</strong>
                  <span class="ob-result-meta">PUBLISHED CHANNEL</span>
                </div>
                <div class="ob-result-body">
                  <p class="ob-hits">
                    <b>{{ searchHits ?? 0 }}</b>
                    <span>条结果命中「{{ DEMO_TITLE }}」</span>
                  </p>
                  <div v-if="queryReceipt !== ''" class="ob-kv">
                    <dt>Query Receipt</dt>
                    <dd>
                      <code class="hash-chip ob-id" :title="queryReceipt">
                        {{ shortId(queryReceipt) }}
                      </code>
                    </dd>
                  </div>
                </div>
              </div>

              <template v-if="step === 4">
                <pre class="code-block ob-code">{{ AGENT_SNIPPET }}</pre>
                <RouterLink class="ob-inline-link" to="/agents" @click="dismissWizard">
                  打开 Agent 接入页 <ExternalLink :size="12" />
                </RouterLink>
              </template>

              <div v-if="!isDone(step)" class="ob-action-row">
                <button type="button" class="btn btn-primary" :disabled="busy" @click="runStep">
                  <LoaderCircle v-if="busy" class="ob-spin" :size="14" />
                  <RotateCcw v-else-if="error !== ''" :size="14" />
                  <component :is="activeStep.icon" v-else :size="14" />
                  <span>{{ busy ? "正在执行…" : error !== "" ? "重试" : activeStep.action }}</span>
                </button>
                <span class="ob-action-hint">{{ activeStep.hint }}</span>
              </div>
              <p v-else class="ob-done-note">
                <Check :size="12" />
                <span>
                  {{
                    step === store.totalSteps - 1
                      ? "全部步骤已完成，可以结束引导。"
                      : "当前步骤已完成，可以进入下一步。"
                  }}
                </span>
              </p>

              <div v-if="error !== ''" class="form-error ob-error" role="alert">
                <AlertCircle :size="14" />
                <span>{{ error }}</span>
              </div>

              <div class="ob-learn">
                <span>你会学到</span>
                <p>{{ activeStep.learn }}</p>
              </div>
            </div>

            <footer class="ob-actions">
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                :disabled="step === 0 || busy"
                @click="prevStep"
              >
                <ArrowLeft :size="13" /> 上一步
              </button>
              <span class="ob-step-count">{{ step + 1 }} / {{ store.totalSteps }}</span>
              <div class="ob-actions-right">
                <button type="button" class="btn btn-ghost btn-sm" @click="skipWizard">
                  跳过引导
                </button>
                <button
                  v-if="isDone(step)"
                  type="button"
                  class="btn btn-primary btn-sm"
                  @click="goNext"
                >
                  <template v-if="step === store.totalSteps - 1">
                    完成引导 <Check :size="13" />
                  </template>
                  <template v-else>下一步 <ArrowRight :size="13" /></template>
                </button>
                <button
                  v-else
                  type="button"
                  class="btn btn-sm"
                  disabled
                  title="请先完成当前步骤"
                >
                  下一步 <ArrowRight :size="13" />
                </button>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ob-overlay {
  position: fixed;
  inset: 0;
  z-index: 1900;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--sidebar) 56%, transparent);
  backdrop-filter: blur(3px);
}

.ob-dialog-enter-active,
.ob-dialog-leave-active {
  transition: opacity 0.16s var(--ease);
}

.ob-dialog-enter-from,
.ob-dialog-leave-to {
  opacity: 0;
}

.ob-dialog-enter-active .ob-modal,
.ob-dialog-leave-active .ob-modal {
  transition: transform 0.18s var(--ease), opacity 0.18s var(--ease);
}

.ob-dialog-enter-from .ob-modal,
.ob-dialog-leave-to .ob-modal {
  opacity: 0;
  transform: translateY(8px) scale(0.995);
}

.ob-modal {
  display: grid;
  grid-template-columns: 258px minmax(0, 1fr);
  width: min(920px, 100%);
  height: min(640px, calc(100dvh - 48px));
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--card);
  box-shadow: 0 24px 60px rgb(22 19 14 / 18%);
}

/* ---------- 左侧步骤栏 ---------- */
.ob-rail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 22px 16px 16px;
  background: var(--sidebar);
  border-right: 1px solid var(--sidebar-line);
}

.ob-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px 18px;
  border-bottom: 1px solid var(--sidebar-line);
}

.ob-brand-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--card-warm);
}

.ob-brand-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.ob-brand-copy strong {
  color: var(--card-warm);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.05px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ob-brand-copy small {
  color: var(--sidebar-muted);
  font: 500 10.5px/1.3 var(--mono);
  letter-spacing: 0.05em;
}

.ob-nav {
  min-height: 0;
  overflow-y: auto;
}

.ob-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 0 0;
}

.ob-steps li {
  position: relative;
}

.ob-steps button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border-radius: var(--radius);
  color: var(--sidebar-muted);
  text-align: left;
  transition: background 0.15s var(--ease), color 0.15s var(--ease);
}

.ob-steps button:hover:not(:disabled) {
  background: var(--sidebar-raised);
  color: var(--sidebar-ink);
}

.ob-steps button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.ob-step-num {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border: 1px solid var(--sidebar-line);
  border-radius: 50%;
  background: var(--sidebar);
  color: var(--sidebar-muted);
  font: 600 10.5px/1 var(--mono);
  transition: background 0.15s var(--ease), border-color 0.15s var(--ease),
    color 0.15s var(--ease);
}

.ob-step-num::after {
  content: "";
  position: absolute;
  top: calc(100% + 1px);
  left: 50%;
  width: 1px;
  height: 16px;
  background: var(--sidebar-line);
  transform: translateX(-50%);
}

.ob-steps li:last-child .ob-step-num::after {
  display: none;
}

.ob-step-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ob-step-now {
  flex: 0 0 auto;
  color: var(--accent-soft);
  font: 600 10.5px/1 var(--mono);
  letter-spacing: 0.12em;
}

.ob-steps li.is-done .ob-step-num {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.ob-steps li.is-done button {
  color: var(--sidebar-ink);
}

.ob-steps li.is-active button {
  background: var(--sidebar-raised);
  color: var(--card-warm);
}

.ob-steps li.is-active .ob-step-label {
  color: var(--card-warm);
  font-weight: 600;
}

.ob-steps li.is-active .ob-step-num {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--card-warm);
}

.ob-rail-foot {
  margin-top: auto;
  padding: 14px 4px 0;
  border-top: 1px solid var(--sidebar-line);
}

.ob-rail-note {
  color: var(--sidebar-muted);
  font-size: 11.5px;
  line-height: 1.75;
}

.ob-reset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 4px 0;
  color: var(--sidebar-muted);
  font-size: 11.5px;
  transition: color 0.15s var(--ease);
}

.ob-reset:hover:not(:disabled) {
  color: var(--sidebar-ink);
}

.ob-reset:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ---------- 右侧内容区 ---------- */
.ob-stage {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--card);
}

.ob-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 22px 10px;
}

.ob-progress-copy {
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.ob-progress-label {
  color: var(--muted);
  font-size: 11.5px;
}

.ob-progress-count {
  color: var(--ink);
  font: 600 11px/1 var(--mono);
  letter-spacing: 0.06em;
}

.ob-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius);
  color: var(--muted);
  transition: background 0.15s var(--ease), color 0.15s var(--ease);
}

.ob-close:hover {
  background: var(--slate-soft);
  color: var(--ink);
}

.ob-progress-track {
  height: 2px;
  margin: 0 22px;
  border-radius: 2px;
  background: var(--line-soft);
  overflow: hidden;
}

.ob-progress-track i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.25s var(--ease);
}

.ob-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 18px;
  scrollbar-gutter: stable;
}

.ob-content-head {
  display: flex;
  align-items: flex-start;
  gap: 13px;
}

.ob-glyph {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--accent);
  transition: background 0.15s var(--ease), border-color 0.15s var(--ease),
    color 0.15s var(--ease);
}

.ob-glyph.is-done {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.ob-heading {
  min-width: 0;
  padding-top: 1px;
}

.ob-content-head .eyebrow {
  margin: 0 0 7px;
  color: var(--accent);
}

.ob-content-head h1 {
  color: var(--ink);
  font-size: 20px;
  line-height: 1.3;
  letter-spacing: -0.35px;
}

.ob-lede {
  max-width: 560px;
  margin-top: 11px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.75;
}

/* ---------- 成功结果 ---------- */
.ob-result {
  margin-top: 18px;
  border: 1px solid var(--jade-line);
  border-radius: var(--radius);
  background: var(--card-warm);
  overflow: hidden;
}

.ob-result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.ob-result-head strong {
  font-size: 12.5px;
  font-weight: 600;
}

.ob-result-meta {
  margin-left: auto;
  color: var(--jade);
  opacity: 0.75;
  font: 600 10.5px/1 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}

.ob-result-body {
  display: grid;
  gap: 9px;
  padding: 12px;
}

.ob-kv {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.ob-kv dt {
  color: var(--faint);
  font: 600 10.5px/1.4 var(--mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ob-kv dd {
  min-width: 0;
  margin: 0;
  color: var(--ink-2);
  font-size: 12px;
}

.ob-id {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.ob-hits {
  display: flex;
  align-items: baseline;
  gap: 7px;
  color: var(--ink-2);
  font-size: 12.5px;
}

.ob-hits b {
  color: var(--jade);
  font: 600 24px/1 var(--mono);
  letter-spacing: -0.5px;
}

.ob-hits span {
  color: var(--muted);
}

/* ---------- 代码与说明 ---------- */
.ob-code {
  max-height: 232px;
  margin-top: 16px;
  font-size: 11.5px;
  line-height: 1.7;
}

.ob-inline-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 12px;
  padding-bottom: 1px;
  border-bottom: 1px solid var(--accent-line);
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
}

.ob-inline-link:hover {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.ob-learn {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 20px;
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: var(--paper);
}

.ob-learn span {
  flex: 0 0 auto;
  color: var(--faint);
  font: 600 10.5px/1.5 var(--mono);
  letter-spacing: 0.1em;
}

.ob-learn p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}

/* ---------- 操作与反馈 ---------- */
.ob-action-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.ob-action-row .btn {
  height: 34px;
  padding: 0 14px;
}

.ob-action-hint {
  color: var(--faint);
  font-size: 11.5px;
  line-height: 1.5;
}

.ob-done-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  color: var(--jade);
  font-size: 12px;
}

.ob-error {
  margin-top: 16px;
  align-items: flex-start;
  line-height: 1.6;
}

.ob-error svg {
  margin-top: 2px;
}

.ob-spin {
  animation: ob-rotate 0.9s linear infinite;
}

@keyframes ob-rotate {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 底栏 ---------- */
.ob-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 22px;
  border-top: 1px solid var(--line);
  background: var(--card);
}

.ob-step-count {
  margin: 0 auto;
  color: var(--faint);
  font: 600 10.5px/1 var(--mono);
  letter-spacing: 0.08em;
}

.ob-actions-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

@media (max-width: 900px) {
  .ob-modal {
    grid-template-columns: 228px minmax(0, 1fr);
  }

  .ob-rail {
    padding: 18px 12px 14px;
  }

  .ob-content {
    padding: 18px 20px;
  }

  .ob-actions {
    padding: 12px 20px;
  }
}

@media (max-width: 720px) {
  .ob-overlay {
    padding: 0;
  }

  .ob-modal {
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    border: 0;
    border-radius: 0;
  }

  .ob-rail {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 14px;
    border-right: 0;
    border-bottom: 1px solid var(--sidebar-line);
    overflow: visible;
  }

  .ob-brand {
    flex: 0 0 auto;
    padding: 0;
    border-bottom: 0;
  }

  .ob-brand-copy small {
    display: none;
  }

  .ob-brand-mark {
    width: 26px;
    height: 26px;
  }

  .ob-nav {
    flex: 1 0 100%;
    order: 3;
    min-width: 0;
    overflow: visible;
  }

  .ob-steps {
    flex-direction: row;
    gap: 4px;
    padding: 0;
  }

  .ob-steps button {
    width: auto;
    padding: 5px 6px;
  }

  .ob-step-label,
  .ob-step-now {
    display: none;
  }

  .ob-step-num::after {
    display: none;
  }

  .ob-rail-foot {
    flex: 0 0 auto;
    order: 2;
    margin: 0 0 0 auto;
    padding: 0;
    border-top: 0;
  }

  .ob-rail-note {
    display: none;
  }

  .ob-reset {
    margin-top: 0;
    padding: 4px;
    white-space: nowrap;
  }

  .ob-stage-head {
    padding: 12px 18px 8px;
  }

  .ob-progress-track {
    margin: 0 18px;
  }

  .ob-content {
    padding: 16px 18px;
  }

  .ob-actions {
    flex-wrap: wrap;
    padding: 10px 16px;
  }

  .ob-step-count {
    order: 3;
    width: 100%;
    margin: 0;
    text-align: center;
  }
}

@media (max-height: 640px) {
  .ob-rail-note {
    display: none;
  }
}
</style>
