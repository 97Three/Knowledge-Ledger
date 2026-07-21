<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Fingerprint,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-vue-next";
import { getCapability, getOverview } from "@/api/client";
import type { Capability, Overview } from "@/api/types";
import { BRAND } from "@/brand";
import { useAsyncResource } from "@/composables/useAsyncResource";
import { formatDate, shortId } from "@/utils/format";
import ErrorState from "@/components/ErrorState.vue";
import LoadingState from "@/components/LoadingState.vue";
import PageHeader from "@/components/PageHeader.vue";

interface RuntimeRow {
  readonly detail: string;
  readonly icon: Component;
  readonly title: string;
}

interface RoleRow {
  readonly detail: string;
  readonly label: string;
  readonly name: string;
}

const RUNTIME_ROWS: readonly RuntimeRow[] = [
  {
    detail: `${BRAND.protocol.name} ${BRAND.protocol.version} · connected`,
    icon: Server,
    title: "Core API",
  },
  {
    detail: "持久化工作流与检索索引",
    icon: Database,
    title: "PostgreSQL + pgvector",
  },
  {
    detail: "六个固定角色 token",
    icon: ShieldCheck,
    title: "开发身份映射",
  },
];

const ROLES: readonly RoleRow[] = [
  {
    detail: "提交新知识、修订与补充证据，不能自行审核或发布。",
    label: "提交候选 / 补证",
    name: "Contributor",
  },
  {
    detail: "独立核验来源与适用范围，决定候选是否进入发布队列。",
    label: "核验 / 拒绝 / 隔离",
    name: "Curator",
  },
  {
    detail: "把通过审核的修订绑定当前策略水位发布，或执行废弃。",
    label: "发布 / 废弃",
    name: "Publisher",
  },
  {
    detail: "发现高风险错误时立即撤销，优先于常规维护流程。",
    label: "紧急撤销",
    name: "Incident",
  },
  {
    detail: "按监管要求擦除内容，仅保留受审计的最小回执。",
    label: "监管擦除",
    name: "Erasure",
  },
  {
    detail: "检索并引用已发布知识，产生使用与反馈证据。",
    label: "查询 / 消费",
    name: "Reader",
  },
];

const {
  data: capabilityData,
  error: capabilityError,
  loading: capabilityLoading,
  refresh: refreshCapability,
} = useAsyncResource<Capability>(getCapability);
const {
  data: overviewData,
  error: overviewError,
  loading: overviewLoading,
  refresh: refreshOverview,
} = useAsyncResource<Overview>(getOverview);

const capability = computed(() => capabilityData.value);
const overview = computed(() => overviewData.value);

const showFullIdentifiers = ref(false);
const openSections = ref<string[]>(["operations"]);

const nodeId = computed(() => overviewData.value?.node.id ?? "");
const nodeDisplayId = computed(() => {
  if (nodeId.value.length === 0) return "—";
  return showFullIdentifiers.value ? nodeId.value : shortId(nodeId.value, 62);
});

const versionList = computed<readonly string[]>(() => capabilityData.value?.versions ?? []);
const profileList = computed<readonly string[]>(() => capabilityData.value?.profiles ?? []);
const operationList = computed<readonly string[]>(() => capabilityData.value?.operations ?? []);
const extensionList = computed(() => capabilityData.value?.supportedExtensions ?? []);
const schemaEntries = computed<readonly (readonly [string, string])[]>(() =>
  Object.entries(capabilityData.value?.schemas ?? {}),
);
const limits = computed(() => capabilityData.value?.limits);

function formatBytes(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value >= 1_048_576) {
    const megabytes = value / 1_048_576;
    return `${Number.isInteger(megabytes) ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
  }
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

async function refreshAll(): Promise<void> {
  await Promise.all([refreshCapability(), refreshOverview()]);
}
</script>

<template>
  <PageHeader
    eyebrow="Platform Settings"
    title="平台设置"
    subtitle="这里显示服务端公开的运行状态；密钥、原始 token 与敏感策略不会下发到浏览器。"
  >
    <template #actions>
      <button
        class="btn btn-ghost"
        :disabled="capabilityLoading || overviewLoading"
        @click="refreshAll"
      >
        <RefreshCw :size="15" /> 刷新
      </button>
    </template>
  </PageHeader>

  <LoadingState
    v-if="(capabilityLoading && capability === undefined) || (overviewLoading && overview === undefined)"
    label="正在读取平台配置"
  />
  <ErrorState
    v-else-if="capabilityError"
    :error="capabilityError"
    @retry="refreshCapability"
  />
  <ErrorState v-else-if="overviewError" :error="overviewError" @retry="refreshOverview" />

  <div v-else-if="capability !== undefined && overview !== undefined" class="settings-layout">
    <nav class="settings-nav" aria-label="设置页面目录">
      <a href="#node-identity"><Server :size="14" /> 节点身份</a>
      <a href="#capability"><Fingerprint :size="14" /> 协议能力</a>
      <a href="#runtime"><Database :size="14" /> 运行环境</a>
      <a href="#roles"><KeyRound :size="14" /> 身份与角色</a>
    </nav>

    <div class="settings-content">
      <section id="node-identity" class="panel settings-section">
        <header class="panel-head">
          <div>
            <h2>节点身份</h2>
            <p>联邦互操作时由稳定 Node ID 与 Trust Domain 标识知识来源。</p>
          </div>
          <span class="identifier-toggle">
            <span>完整标识</span>
            <el-switch v-model="showFullIdentifiers" size="small" />
          </span>
        </header>

        <dl class="identity-list">
          <div>
            <dt>显示名称</dt>
            <dd>{{ overview.node.name }}</dd>
          </div>
          <div>
            <dt>Node ID</dt>
            <dd><code class="mono identity-id">{{ nodeDisplayId }}</code></dd>
          </div>
          <div>
            <dt>Trust Domain</dt>
            <dd class="mono">{{ overview.node.trustDomain }}</dd>
          </div>
          <div>
            <dt>Base URL</dt>
            <dd><code class="mono identity-id">{{ capability.baseUrl }}</code></dd>
          </div>
          <div>
            <dt>Policy Epoch</dt>
            <dd>
              <span class="epoch-pill">
                <Fingerprint :size="12" />
                {{ overview.node.policyEpoch }}
              </span>
            </dd>
          </div>
          <div>
            <dt>状态生成时间</dt>
            <dd>{{ formatDate(overview.generatedAt) }}</dd>
          </div>
        </dl>
      </section>

      <section id="capability" class="panel settings-section">
        <header class="panel-head">
          <div>
            <h2>协议能力</h2>
            <p>取自 <code class="mono">/.well-known/nian</code> 的公开能力文档，只读。</p>
          </div>
          <span class="protocol-chip mono">{{ BRAND.protocol.label }}</span>
        </header>

        <div class="panel-body capability-body">
          <div class="capability-meta">
            <div class="meta-cell">
              <span class="meta-label">Protocol</span>
              <span class="meta-value mono">{{ capability.protocol }}</span>
            </div>
            <div class="meta-cell">
              <span class="meta-label">Versions</span>
              <span class="meta-value mono">{{ versionList.join(" · ") || "—" }}</span>
            </div>
            <div class="meta-cell">
              <span class="meta-label">Expires At</span>
              <span class="meta-value mono">{{ formatDate(capability.expiresAt) }}</span>
            </div>
          </div>

          <div class="capability-limits">
            <div class="limit-cell">
              <span>幂等窗口</span>
              <b>{{ limits?.idempotencyWindowSeconds ?? "—" }}<small v-if="limits">秒</small></b>
            </div>
            <div class="limit-cell">
              <span>最大分页</span>
              <b>{{ limits?.maxPageSize ?? "—" }}<small v-if="limits">条</small></b>
            </div>
            <div class="limit-cell">
              <span>最大负载</span>
              <b>{{ formatBytes(limits?.maxPayloadBytes) }}</b>
            </div>
          </div>

          <div class="field">
            <label>Profiles</label>
            <div class="chip-row">
              <span v-for="profile in profileList" :key="profile" class="hash-chip">
                {{ profile }}
              </span>
              <span v-if="profileList.length === 0" class="faint">—</span>
            </div>
          </div>

          <el-collapse v-model="openSections" class="capability-collapse">
            <el-collapse-item name="operations" :title="`Operations · ${operationList.length}`">
              <div class="chip-row">
                <code v-for="operation in operationList" :key="operation" class="hash-chip">
                  {{ operation }}
                </code>
                <span v-if="operationList.length === 0" class="faint">—</span>
              </div>
            </el-collapse-item>

            <el-collapse-item name="schemas" :title="`Schemas · ${schemaEntries.length}`">
              <div class="schema-list">
                <div v-for="entry in schemaEntries" :key="entry[0]" class="schema-row">
                  <span class="schema-name mono">{{ entry[0] }}</span>
                  <code class="schema-uri mono" :title="entry[1]">{{ entry[1] }}</code>
                </div>
                <span v-if="schemaEntries.length === 0" class="faint">—</span>
              </div>
            </el-collapse-item>

            <el-collapse-item name="extensions" :title="`扩展 · ${extensionList.length}`">
              <div class="schema-list">
                <div v-for="extension in extensionList" :key="extension.uri" class="schema-row">
                  <code class="schema-uri mono">{{ extension.uri }}</code>
                  <span class="schema-flag" :class="{ 'is-required': extension.required }">
                    {{ extension.required ? "required" : "optional" }}
                  </span>
                </div>
                <div v-if="extensionList.length === 0" class="schema-row">
                  <span class="faint">未声明扩展。</span>
                </div>
                <div class="schema-row">
                  <span class="schema-name">受保护资源元数据</span>
                  <code class="schema-uri mono">{{ capability.auth.protectedResourceMetadata }}</code>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </section>

      <section id="runtime" class="panel settings-section">
        <header class="panel-head">
          <div>
            <h2>本地开发状态</h2>
            <p>以下状态来自当前进程，仅用于开发与演示验证。</p>
          </div>
          <span class="status-pill"><i />{{ BRAND.workspace.environment }}</span>
        </header>

        <div class="panel-body runtime-body">
          <div class="runtime-grid">
            <div v-for="row in RUNTIME_ROWS" :key="row.title" class="runtime-row">
              <span class="runtime-icon"><component :is="row.icon" :size="15" /></span>
              <div>
                <strong>{{ row.title }}</strong>
                <p>{{ row.detail }}</p>
              </div>
              <CheckCircle2 class="runtime-ok" :size="16" />
            </div>
          </div>

          <div class="note-block is-warn">
            <AlertTriangle :size="15" />
            <div>
              <strong>当前不是生产安全配置</strong>
              <p>
                生产环境必须替换开发 token、启用可信 OIDC/JWKS、外部策略决策点、密钥管理、
                对象存储、审计导出与备份恢复演练。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="roles" class="panel settings-section">
        <header class="panel-head">
          <div>
            <h2>职责分离</h2>
            <p>同一个浏览器可以演示流程，但服务端仍按 scope 独立授权。</p>
          </div>
          <span class="panel-count mono">{{ ROLES.length }} ROLES</span>
        </header>

        <div class="panel-body">
          <div class="role-grid">
            <div v-for="role in ROLES" :key="role.name" class="role-card">
              <span class="role-name mono">{{ role.name }}</span>
              <b>{{ role.label }}</b>
              <p>{{ role.detail }}</p>
            </div>
          </div>

          <div class="note-block is-warn role-caveat">
            <AlertTriangle :size="15" />
            <div>
              <strong>开发身份映射不是真实登录</strong>
              <p>
                浏览器用固定的开发 token 代你切换角色：可以演示流程，但没有经过 OIDC/JWKS 校验，
                也不代表生产授权；读取、审核、发布、撤销与擦除各自使用独立 scope，不能互相借用。
                上线前必须换成真实身份与独立授权。
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-layout {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  gap: var(--gap);
  align-items: start;
}

.settings-nav {
  position: sticky;
  top: calc(var(--topbar-height) + 18px);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.settings-nav a {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-left: 2px solid var(--line);
  color: var(--muted);
  font-size: 12.5px;
  transition: border-color 0.15s var(--ease), background 0.15s var(--ease),
    color 0.15s var(--ease);
}

.settings-nav a svg {
  opacity: 0.7;
}

.settings-nav a:hover {
  border-left-color: var(--line-2);
  background: var(--card);
  color: var(--ink);
}

.settings-nav a:hover svg {
  opacity: 1;
}

.settings-content {
  display: grid;
  gap: var(--gap);
  min-width: 0;
}

.settings-section {
  scroll-margin-top: calc(var(--topbar-height) + 18px);
}

.identifier-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.panel-count {
  flex: 0 0 auto;
  color: var(--faint);
  font: 600 10px/1 var(--mono);
  letter-spacing: 0.12em;
}

.protocol-chip {
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--muted);
  font-size: 10.5px;
  white-space: nowrap;
}

.identity-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.identity-list > div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 11px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.identity-list > div:nth-child(odd) {
  border-right: 1px solid var(--line-soft);
}

.identity-list > div:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.identity-list dt {
  color: var(--muted);
  font-size: 11.5px;
}

.identity-list dd {
  margin: 0;
  min-width: 0;
  color: var(--ink-2);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.identity-id {
  color: var(--ink-2);
  font-size: 11px;
  letter-spacing: 0.01em;
}

.epoch-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  color: var(--ink-2);
  font: 500 10.5px/1.6 var(--mono);
}

.epoch-pill svg {
  color: var(--accent);
}

.capability-body {
  display: grid;
  gap: 16px;
}

.capability-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gap-sm);
}

.meta-cell {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
}

.meta-label {
  display: block;
  margin-bottom: 6px;
  color: var(--faint);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.meta-value {
  display: block;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.capability-limits {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.limit-cell {
  padding: 11px 13px;
  border-right: 1px solid var(--line);
}

.limit-cell:last-child {
  border-right: 0;
}

.limit-cell > span {
  display: block;
  color: var(--muted);
  font-size: 11.5px;
}

.limit-cell b {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 5px;
  font: 600 16px/1.25 var(--mono);
  font-variant-numeric: tabular-nums;
}

.limit-cell small {
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip-row .hash-chip {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.capability-collapse {
  border-top: 1px solid var(--line);
}

.schema-list {
  display: grid;
}

.schema-row {
  display: grid;
  grid-template-columns: minmax(120px, 200px) minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line-soft);
  font-size: 11.5px;
}

.schema-row:last-child {
  border-bottom: 0;
}

.schema-name {
  color: var(--ink-2);
  font-size: 11px;
}

.schema-uri {
  color: var(--muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.schema-flag {
  justify-self: start;
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--faint);
  font: 500 9.5px/1.5 var(--mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.schema-flag.is-required {
  border-color: var(--gold-line);
  background: var(--gold-soft);
  color: var(--gold);
}

.runtime-body {
  display: grid;
  gap: 14px;
}

.runtime-grid {
  display: grid;
  gap: var(--gap-sm);
}

.runtime-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card-warm);
}

.runtime-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  background: var(--slate-soft);
  color: var(--ink-2);
}

.runtime-row strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.runtime-row p {
  margin-top: 2px;
  color: var(--muted);
  font-size: 11.5px;
}

.runtime-ok {
  color: var(--jade);
}

.note-block strong {
  display: block;
  margin-bottom: 2px;
  font-size: 12px;
}

.note-block p {
  color: inherit;
  font-size: 11.5px;
  line-height: 1.7;
  opacity: 0.92;
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gap-sm);
}

.role-card {
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card-warm);
}

.role-name {
  display: block;
  color: var(--faint);
  font: 600 9.5px/1 var(--mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.role-card b {
  display: block;
  margin: 7px 0 4px;
  font-size: 12.5px;
  font-weight: 600;
}

.role-card p {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.65;
}

.role-caveat {
  margin-top: 14px;
}

@media (max-width: 1080px) {
  .settings-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    padding-bottom: 4px;
  }

  .settings-nav a {
    padding: 6px 9px;
    border: 1px solid var(--line);
    border-left-width: 1px;
    border-radius: var(--radius);
    background: var(--card);
    font-size: 12px;
  }
}

@media (max-width: 720px) {
  .identity-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .identity-list > div:nth-child(odd) {
    border-right: 0;
  }

  .identity-list > div:nth-last-child(-n + 2) {
    border-bottom: 1px solid var(--line-soft);
  }

  .identity-list > div:last-child {
    border-bottom: 0;
  }

  .capability-meta,
  .capability-limits,
  .role-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .limit-cell {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .limit-cell:last-child {
    border-bottom: 0;
  }

  .schema-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
  }
}
</style>
