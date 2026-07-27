# 同一知识如何固定版本，多个系统如何安全接入？

这一章从三个容易误解的标识讲起：Revision ID 标识内容版本，ETag 标识并发前提，幂等键标识一次业务动作。它们解决的问题不同。

## 内容地址：哈希的是规范化 Manifest

[apps/core/src/contracts/revision.ts](D:/Code/Knowledge Ledger/apps/core/src/contracts/revision.ts) 的核心顺序是 `canonicalJson → sha256Digest → urn:nian:sha256:...`。JSON 属性排列顺序不应改变同一个 Manifest 的身份，所以先做规范化；内容变了则形成新版本。Payload 摘要包含在 Manifest 中，绑定正文的变化。

教学对象 `{"a":1,"b":2}` 与 `{"b":2,"a":1}` 展示键序差异；它们不是合法知识 Manifest，只用于理解规范化。不要自行用普通 `JSON.stringify` 或 Python 默认 `json.dumps` 替换跨语言规范化，数字和 Unicode 边界也要一致。

TypeScript 黄金向量测试是 [apps/core/test/revision.test.ts](D:/Code/Knowledge Ledger/apps/core/test/revision.test.ts)；Python Worker 使用 RFC 8785 实现并有独立测试。哈希保证内容标识与完整性核对，不证明作者可信、内容正确或许可有效。

## 幂等防重复，ETag 防旧状态覆盖

假设客户端审核请求超时：它可以用原幂等键和原请求重试，查到同一动作结果。另一个审核者已经改变状态时，持有旧 If-Match 的新动作应失败。一个控制重复提交，一个控制竞争更新。

在 growth routes 的 `workflowReplay`、`requireMatchingEtag` 与 `requireWorkflowUpdate` 中跟踪顺序，再到 store 看持久化前提。不能因为路由先检查过版本就省略数据库更新时的并发控制：检查和写入之间可能发生竞争。

## 身份、权限与租户各回答不同问题

- 身份认证回答“是谁发来的”：开发 token 与 OIDC/JWKS 模式不同。
- 权限回答“这个主体能否做该动作”：review、publish、read 不是一个超级开关。
- Tenant/Space/purpose 回答“在哪个数据范围、为哪个用途”：不是模型通过自然语言自行决定的字段。

入口：[apps/core/src/platform/auth.ts](D:/Code/Knowledge Ledger/apps/core/src/platform/auth.ts)、[apps/core/src/platform/authorization.ts](D:/Code/Knowledge Ledger/apps/core/src/platform/authorization.ts)、[apps/core/src/platform/database.ts](D:/Code/Knowledge Ledger/apps/core/src/platform/database.ts)。当前是单租户进程模型，数据库 RLS 属纵深防御；不能由存在 tenant_id 推导出共享多租户生产平台已经验收。

## REST、SDK、MCP 是接入层，不是三个知识库

[apps/mcp-server/src/server.ts](D:/Code/Knowledge Ledger/apps/mcp-server/src/server.ts) 创建 stdio MCP server，通过 TypeScript SDK 调 Core，暴露 knowledge_search、knowledge_context、knowledge_get 等工具。它不把发布治理权限交给 Agent。Python SDK 则适合 Python 消费程序。

客户端应先 Discovery，再按服务声明的能力调用；接口 Schema 里出现某字段不等于运行节点启用它。MCP 工具声明 readOnlyHint 是提示，真正授权仍需后端执行。

四项目组合应在消费方发生：QuantPilot 获取知识 ContextPack 与用户记忆 Projection，网关负责模型流量。不能把个人偏好自动写入团队 Published Channel，也不能让知识平台直接读取记忆数据库来省一个接口。

阅读 [docs/architecture/memory-knowledge-composition.md](D:/Code/Knowledge Ledger/docs/architecture/memory-knowledge-composition.md) 时把它当设计与接入约束；本地 QuantPilot 的 HTTP 适配器确实存在，但本次没有验证四服务的运行配置、凭证和端到端闭环。

自测：同一正文改了允许用途，Revision 可能变吗？旧回执能否永久授权读取撤销版本？回答时分别回到 Manifest、当前授权和引用有效性检查。
