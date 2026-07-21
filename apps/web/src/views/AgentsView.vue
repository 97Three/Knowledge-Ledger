<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  Bot,
  Check,
  CircleAlert,
  Clipboard,
  Code2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
} from "lucide-vue-next";
import { getCapability } from "@/api/client";
import {
  runIntegrationPreflight,
  type IntegrationPreflightReport,
  type PreflightState,
} from "@/api/integration-preflight";
import type { Capability } from "@/api/types";
import { BRAND } from "@/brand";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { useOnboardingStore } from "@/stores/onboarding";
import { shortId } from "@/utils/format";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import PageHeader from "@/components/PageHeader.vue";

type SnippetKey = "curl" | "mcp" | "python" | "typescript";

type ConnectionState = "failed" | "idle" | "passed" | "running" | "warning";

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  failed: "预检失败",
  idle: "Discovery 已读取",
  passed: "公开预检通过",
  running: "正在检查",
  warning: "预检有提醒",
};

const CHECK_STATE_LABELS: Record<PreflightState, string> = {
  failed: "失败",
  passed: "通过",
  warning: "提醒",
};

const SNIPPET_LABELS: Record<SnippetKey, string> = {
  curl: "cURL",
  mcp: "MCP",
  python: "Python",
  typescript: "TypeScript",
};

const { data: capability, error, loading, refresh } = useAsyncResource<Capability>(getCapability);
const onboarding = useOnboardingStore();

const tab = ref<string>("typescript");
const copied = ref(false);
const preflight = ref<IntegrationPreflightReport>();
const preflightError = ref<string>();
const preflightRunning = ref(false);
let preflightRun = 0;

const apiBaseUrl = `${window.location.origin.replace(/\/$/u, "")}/${BRAND.protocol.name.toLowerCase()}/${BRAND.protocol.version}`;

const snippets: Record<SnippetKey, string> = {
  typescript: `import { NIANClient } from "@nian/sdk";

const knowledge = new NIANClient({
  baseUrl: "${apiBaseUrl}",
  token: () => obtainAudienceBoundToken(),
  supportedObligations: ["cite", "no-train"]
});
const context = await knowledge.createContextPack({
  task: "如何贡献 Agent 知识？",
  purpose: "customer-support",
  budgetCharacters: 12000
});
if (context.passages.length === 0) throw new Error("证据不足，拒绝回答");
// 回答必须保留 context.citations，并在任务结束后 recordUsage。`,
  python: `from nian_sdk import NIANClient

knowledge = NIANClient(
    "${apiBaseUrl}",
    token=obtain_audience_bound_token,
    supported_obligations=("cite", "no-train"),
)
context = knowledge.create_context_pack(
    "如何贡献 Agent 知识？",
    "customer-support",
    budget_characters=12000,
)
if not context["passages"]:
    raise RuntimeError("证据不足，拒绝回答")`,
  curl: `curl --fail-with-body -sS '${apiBaseUrl}/context-packs' \\
  -H 'Authorization: Bearer <reader-token>' \\
  -H '${BRAND.protocol.name}-Version: ${BRAND.protocol.version}' \\
  -H 'Content-Type: application/json' \\
  --data '{"nianVersion":"${BRAND.protocol.version}","task":"如何贡献 Agent 知识？","mode":"lexical","purpose":"customer-support","budget":{"maxCharacters":12000,"maxPassages":12},"spaces":["<authorized-space-uri>"],"supportedObligations":["cite","no-train"],"critical":[],"extensions":{}}'`,
  mcp: `{
  "mcpServers": {
    "governed-knowledge": {
      "command": "pnpm",
      "args": ["--filter", "@nian/mcp-server", "start"],
      "env": {
        "${BRAND.protocol.name}_BASE_URL": "${apiBaseUrl}",
        "${BRAND.protocol.name}_TOKEN": "<short-lived-reader-token>"
      }
    }
  }
}`,
};

const activeSnippet = computed(() => snippets[tab.value as SnippetKey] ?? "");

const connectionState = computed<ConnectionState>(() => {
  if (preflightRunning.value) return "running";
  if (preflight.value !== undefined) return preflight.value.overall;
  if (preflightError.value !== undefined) return "failed";
  return "idle";
});

const connectionLabel = computed(() => CONNECTION_LABELS[connectionState.value]);

const preflightButtonLabel = computed(() => {
  if (preflightRunning.value) return "检查中…";
  return preflight.value === undefined ? "运行接入检查" : "重新检查";
});

async function copySnippet(): Promise<void> {
  try {
    await navigator.clipboard.writeText(activeSnippet.value);
    copied.value = true;
    ElMessage.success(`已复制 ${SNIPPET_LABELS[tab.value as SnippetKey] ?? "接入"} 示例`);
    window.setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    ElMessage.error("复制失败，请手动选择代码");
  }
}

async function runPreflight(): Promise<void> {
  const runId = preflightRun + 1;
  preflightRun = runId;
  preflightRunning.value = true;
  preflightError.value = undefined;
  try {
    const report = await runIntegrationPreflight({ publicOrigin: window.location.origin });
    if (preflightRun !== runId) return;
    preflight.value = report;
    if (report.overall === "passed") {
      onboarding.completeStep(4);
      ElMessage.success("公开预检通过，Agent 接入步骤已记录");
    } else if (report.overall === "warning") {
      ElMessage.warning("预检有提醒，请查看检查项");
    } else {
      ElMessage.error("预检未通过，请修复后重新检查");
    }
  } catch (caught) {
    if (preflightRun !== runId) return;
    preflightError.value = caught instanceof Error ? caught.message : "接入前检查失败";
    ElMessage.error("接入前检查失败");
  } finally {
    if (preflightRun === runId) preflightRunning.value = false;
  }
}

function checkStateLabel(state: PreflightState): string {
  return CHECK_STATE_LABELS[state];
}
</script>

<template>
  <LoadingState v-if="loading" label="正在发现节点能力" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh" />
  <template v-else-if="capability">
    <PageHeader
      eyebrow="Agent Integration"
      title="让 Agent 消费同一份知识"
      subtitle="优先请求 ContextPack；Agent 必须执行返回的义务、保留 Passage Citation，并在任务结束后上报 Usage 与 Outcome。"
    >
      <template #actions>
        <span class="connection-pill" :class="`is-${connectionState}`">
          <LoaderCircle
            v-if="connectionState === 'running'"
            class="spin"
            :size="14"
            aria-hidden="true"
          />
          <Check v-else-if="connectionState === 'passed'" :size="14" aria-hidden="true" />
          <CircleAlert
            v-else-if="connectionState === 'warning' || connectionState === 'failed'"
            :size="14"
            aria-hidden="true"
          />
          <Network v-else :size="14" aria-hidden="true" />
          {{ connectionLabel }}
        </span>
      </template>
    </PageHeader>

    <div class="page-stack">
      <section class="protocol-card" :aria-label="`${BRAND.protocol.label} 节点协议`">
        <div class="protocol-identity">
          <span class="protocol-orbit"><Bot :size="28" aria-hidden="true" /></span>
          <div class="protocol-copy">
            <p class="protocol-eyebrow">{{ BRAND.protocol.label }}</p>
            <h2 class="protocol-name">{{ capability.node.name }}</h2>
            <p class="protocol-meta mono">
              {{ capability.node.trustDomain ?? "本地信任域" }} ·
              <el-tooltip :content="capability.node.id" placement="top">
                <span class="protocol-node-id">{{ shortId(capability.node.id, 42) }}</span>
              </el-tooltip>
            </p>
          </div>
        </div>
        <dl class="protocol-stats">
          <div>
            <dt>协议版本</dt>
            <dd>{{ capability.versions.join(", ") }}</dd>
          </div>
          <div>
            <dt>Profiles</dt>
            <dd>{{ capability.profiles.length }}</dd>
          </div>
          <div>
            <dt>Operations</dt>
            <dd>{{ capability.operations.length }}</dd>
          </div>
        </dl>
      </section>

      <section class="panel">
        <header class="panel-head">
          <div>
            <h2>浏览器到节点的接入前检查</h2>
            <p>
              验证公开健康端点、{{ BRAND.protocol.label }} Capability、OAuth 资源边界和关键
              Schema。
            </p>
          </div>
          <el-button
            :type="preflight?.overall === 'failed' ? 'default' : 'primary'"
            :disabled="preflightRunning"
            @click="runPreflight"
          >
            <span class="button-label">
              <LoaderCircle
                v-if="preflightRunning"
                class="spin"
                :size="14"
                aria-hidden="true"
              />
              <Play v-else-if="preflight === undefined" :size="14" aria-hidden="true" />
              <RefreshCw v-else :size="14" aria-hidden="true" />
              {{ preflightButtonLabel }}
            </span>
          </el-button>
        </header>

        <p class="preflight-scope">
          <CircleAlert :size="15" aria-hidden="true" />
          <span>
            检查只读取公开端点，<b>绝不发送 Authorization 请求头</b>；不验证真实 token、Space 或
            purpose 权限，也不代表 Agent 部署网络可达。
          </span>
        </p>

        <div class="preflight-results" aria-live="polite">
          <div v-if="preflightError" class="error-box preflight-error" role="alert">
            <CircleAlert :size="16" aria-hidden="true" />
            <div>
              <strong>接入前检查失败</strong>
              <p>{{ preflightError }}</p>
            </div>
          </div>

          <div v-if="preflight === undefined" class="preflight-placeholder">
            <Network :size="20" aria-hidden="true" />
            <span>尚未运行检查。Discovery 页面可见不等于完整接入已经可用。</span>
          </div>

          <template v-else>
            <div
              v-for="item in preflight.checks"
              :key="item.id"
              class="check-row"
              :class="`is-${item.state}`"
            >
              <span class="check-icon">
                <Check v-if="item.state === 'passed'" :size="14" aria-hidden="true" />
                <CircleAlert v-else :size="14" aria-hidden="true" />
              </span>
              <div class="check-body">
                <div class="check-title">
                  <strong>{{ item.label }}</strong>
                  <span class="check-state">{{ checkStateLabel(item.state) }}</span>
                </div>
                <p>{{ item.detail }}</p>
                <small v-if="item.remediation">{{ item.remediation }}</small>
              </div>
              <span class="check-latency mono">
                {{ item.latencyMs === undefined ? "—" : `${item.latencyMs} ms` }}
              </span>
            </div>
          </template>
        </div>
      </section>

      <div class="split split-main-side agent-split">
        <section class="panel code-card">
          <header class="panel-head">
            <div>
              <h2>ContextPack 与 MCP 接入</h2>
              <p>
                SDK 处理版本、错误和请求契约；Agent 仍必须实际执行返回的义务。生产 token
                必须绑定 audience 与最小 scopes。
              </p>
            </div>
            <el-button size="small" @click="copySnippet">
              <span class="button-label">
                <Check v-if="copied" :size="14" aria-hidden="true" />
                <Clipboard v-else :size="14" aria-hidden="true" />
                {{ copied ? "已复制" : "复制" }}
              </span>
            </el-button>
          </header>

          <el-tabs v-model="tab" class="snippet-tabs">
            <el-tab-pane name="typescript">
              <template #label>
                <span class="tab-label"><Code2 :size="14" aria-hidden="true" /> TypeScript</span>
              </template>
            </el-tab-pane>
            <el-tab-pane name="python">
              <template #label>
                <span class="tab-label"><Code2 :size="14" aria-hidden="true" /> Python</span>
              </template>
            </el-tab-pane>
            <el-tab-pane name="curl">
              <template #label>
                <span class="tab-label">
                  <TerminalSquare :size="14" aria-hidden="true" /> cURL
                </span>
              </template>
            </el-tab-pane>
            <el-tab-pane name="mcp">
              <template #label>
                <span class="tab-label"><Network :size="14" aria-hidden="true" /> MCP</span>
              </template>
            </el-tab-pane>
          </el-tabs>

          <pre class="code-block snippet-code"><code>{{ activeSnippet }}</code></pre>
        </section>

        <aside class="rail-stack">
          <section class="panel">
            <header class="panel-head">
              <div>
                <h2>上线前仍需人工确认</h2>
                <p>预检只覆盖公开契约，不覆盖部署网络、授权与义务执行。</p>
              </div>
            </header>

            <ol class="checklist">
              <li>
                <span class="checklist-icon"><Network :size="15" aria-hidden="true" /></span>
                <div>
                  <strong>Agent 运行网络</strong>
                  <p>从实际部署环境重复 Discovery、TLS 和超时检查。</p>
                </div>
              </li>
              <li>
                <span class="checklist-icon"><KeyRound :size="15" aria-hidden="true" /></span>
                <div>
                  <strong>最小权限</strong>
                  <p>为 Agent 分配用途限定、audience-bound 的短期 token。</p>
                </div>
              </li>
              <li>
                <span class="checklist-icon"><ShieldCheck :size="15" aria-hidden="true" /></span>
                <div>
                  <strong>执行义务</strong>
                  <p>不支持 critical obligation 时必须拒绝结果。</p>
                </div>
              </li>
              <li>
                <span class="checklist-icon"><ExternalLink :size="15" aria-hidden="true" /></span>
                <div>
                  <strong>稳定引用与反馈</strong>
                  <p>回答绑定 Revision、Payload、locator，再上报 Usage/Feedback。</p>
                </div>
              </li>
            </ol>

            <div class="panel-body">
              <div class="note-block is-warn mcp-caveat">
                <CircleAlert :size="15" aria-hidden="true" />
                <span>
                  当前 MCP 示例面向本仓库 stdio Adapter，并使用进程注入的短期 token，不代表已发布公共
                  MCP 服务。
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section class="panel">
        <header class="panel-head">
          <div>
            <h2>节点支持能力</h2>
            <p>Discovery 声明的 Reader 操作与 Profile；Profiles 决定可请求的证据形态。</p>
          </div>
        </header>
        <div class="panel-body capability-grid">
          <div class="capability-group">
            <div class="capability-title">
              <strong>Operations</strong>
              <em class="mono">{{ capability.operations.length }}</em>
            </div>
            <div class="capability-chips">
              <code v-for="item in capability.operations" :key="item" class="cap-chip">
                {{ item }}
              </code>
              <span v-if="capability.operations.length === 0" class="faint">
                未声明 Reader 操作
              </span>
            </div>
          </div>
          <div class="capability-group">
            <div class="capability-title">
              <strong>Profiles</strong>
              <em class="mono">{{ capability.profiles.length }}</em>
            </div>
            <div class="capability-chips">
              <el-tooltip
                v-for="item in capability.profiles"
                :key="item"
                :content="item"
                placement="top"
              >
                <code class="cap-chip">{{ shortId(item, 52) }}</code>
              </el-tooltip>
              <span v-if="capability.profiles.length === 0" class="faint">
                未声明 Profile
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </template>
</template>

<style scoped>
/* ---------- 页面堆叠 ---------- */
.page-stack {
  display: grid;
  gap: var(--gap);
}

/* ---------- 连接状态 ---------- */
.connection-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background: var(--card-warm);
  color: var(--muted);
  font: 600 10.5px/1 var(--mono);
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.connection-pill.is-passed {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.connection-pill.is-warning {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.connection-pill.is-failed {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.connection-pill.is-running {
  border-color: var(--line-2);
  background: var(--slate-soft);
  color: var(--slate);
}

.spin {
  animation: agent-spin 0.9s linear infinite;
}

@keyframes agent-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 协议卡片 ---------- */
.protocol-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 24px;
  border: 1px solid var(--sidebar-line);
  border-radius: var(--radius);
  background: var(--sidebar);
  color: var(--sidebar-ink);
}

.protocol-identity {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.protocol-orbit {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
  border: 1px solid var(--sidebar-line);
  border-radius: 50%;
  background: var(--sidebar-raised);
  color: var(--accent);
}

.protocol-copy {
  min-width: 0;
}

.protocol-eyebrow {
  color: var(--sidebar-muted);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.protocol-name {
  margin-top: 5px;
  color: var(--paper);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.3px;
  line-height: 1.25;
}

.protocol-meta {
  margin-top: 5px;
  color: var(--sidebar-muted);
  font-size: 10.5px;
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.protocol-node-id {
  border-bottom: 1px dotted var(--sidebar-line);
}

.protocol-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 20px 32px;
  margin: 0;
  padding-left: 24px;
  border-left: 1px solid var(--sidebar-line);
}

.protocol-stats dt {
  color: var(--sidebar-muted);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.protocol-stats dd {
  margin: 7px 0 0;
  color: var(--paper);
  font: 600 15px/1.2 var(--mono);
  font-variant-numeric: tabular-nums;
}

/* ---------- 接入前检查 ---------- */
.preflight-scope {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 11px 18px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--paper);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}

.preflight-scope svg {
  margin-top: 2px;
  color: var(--gold);
}

.preflight-scope b {
  color: var(--ink-2);
  font-weight: 600;
}

.preflight-results {
  display: grid;
}

.preflight-error {
  margin: 12px 18px 0;
}

.preflight-placeholder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 22px 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}

.preflight-placeholder svg {
  color: var(--faint);
}

.check-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.check-row:last-child {
  border-bottom: 0;
}

.check-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--paper);
  color: var(--faint);
}

.check-row.is-passed .check-icon {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.check-row.is-warning .check-icon {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.check-row.is-failed .check-icon {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.check-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.check-title strong {
  font-size: 12.5px;
  font-weight: 600;
}

.check-state {
  padding: 2px 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font: 600 9.5px/1.4 var(--mono);
  letter-spacing: 0.06em;
}

.check-row.is-passed .check-state {
  border-color: var(--jade-line);
  background: var(--jade-soft);
  color: var(--jade);
}

.check-row.is-warning .check-state {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.check-row.is-failed .check-state {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.check-body p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.check-body small {
  display: block;
  margin-top: 4px;
  color: var(--gold);
  font-size: 11.5px;
  line-height: 1.6;
}

.check-latency {
  padding-top: 4px;
  color: var(--faint);
  font-size: 10.5px;
  text-align: right;
  white-space: nowrap;
}

/* ---------- 接入示例 ---------- */
.agent-split {
  align-items: start;
}

.rail-stack {
  display: grid;
  gap: var(--gap);
}

.button-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.snippet-tabs {
  padding: 0 18px;
}

.snippet-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.snippet-tabs :deep(.el-tabs__item) {
  padding: 0 14px;
}

.snippet-tabs :deep(.el-tabs__item:first-child) {
  padding-left: 0;
}

.snippet-tabs :deep(.el-tabs__item:last-child) {
  padding-right: 0;
}

.snippet-tabs :deep(.el-tabs__content) {
  display: none;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.snippet-code {
  margin: 14px 18px 18px;
}

/* ---------- 上线检查清单 ---------- */
.checklist {
  display: grid;
}

.checklist li {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 10px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.checklist li:last-child {
  border-bottom: 0;
}

.checklist-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--muted);
}

.checklist strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.checklist p {
  margin-top: 3px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.6;
}

.mcp-caveat {
  margin: 0;
}

/* ---------- 节点能力 ---------- */
.capability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}

.capability-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.capability-title strong {
  font-size: 12px;
  font-weight: 600;
}

.capability-title em {
  color: var(--faint);
  font-size: 10px;
  font-style: normal;
  letter-spacing: 0.08em;
}

.capability-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cap-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 4px 7px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--ink-2);
  font: 500 10.5px/1.4 var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .protocol-stats {
    width: 100%;
    padding-top: 16px;
    padding-left: 0;
    border-top: 1px solid var(--sidebar-line);
    border-left: 0;
  }
}

@media (max-width: 720px) {
  .protocol-card {
    padding: 18px;
  }

  .protocol-name {
    font-size: 18px;
  }

  .capability-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
  }

  .check-row {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .check-latency {
    grid-column: 2;
    text-align: left;
  }
}
</style>
