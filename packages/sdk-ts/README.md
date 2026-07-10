# `@nian/sdk`

仓库内的 TypeScript NIAN 客户端。它复用 NIAN 的 Revision、Citation、Exposure Receipt、
Usage 与 Feedback 身份，不维护第二套知识缓存或版本号。

## 使用

先构建 workspace 包：

```bash
pnpm --filter @nian/sdk build
```

```ts
import { NIANClient } from "@nian/sdk";

const client = new NIANClient({
  baseUrl: "https://knowledge.example/nian/0.1",
  token: async () => process.env.NIAN_TOKEN!,
  supportedObligations: ["cite", "no-train"],
});

const capabilities = await client.discover();
const results = await client.query({
  text: "退款超过 30 天如何处理？",
  purpose: "customer-support",
  mode: "lexical",
});
const context = await client.createContextPack({
  task: "为客服生成带引用的退款处理步骤",
  purpose: "customer-support",
  budgetCharacters: 12_000,
});
```

当前 Core 实际启用 `lexical` 和 `exact` 查询；`semantic`、`hybrid` 虽保留在基础 Query
协议类型中，但未启用时服务端会返回 `NIAN_QUERY_MODE_UNSUPPORTED`。客户端不会吞掉治理
错误，失败会抛出带 `status`、`code` 和可选 `traceId` 的 `NIANError`。

## 方法与权限

| 方法 | Scope | 说明 |
| --- | --- | --- |
| `discover` | 无 | 获取短期 Capability 文档 |
| `query`、`createContextPack` | `nian:query` | 只返回当前策略允许的 Published 知识 |
| `getRevision` | `nian:read` | 固定 Space 与 Revision，返回 `revision`、`exposureReceiptId` 及含 Citation 的 `exposureReceipt` |
| `recordUsage`、`recordFeedback` | `nian:feedback` | 记录真实 Exposure → Usage → Feedback 证据链 |
| `contribute` | `nian:contribute` | 只创建候选，不直接发布 |

调用方仍需按公开 Schema 构造 Usage、Feedback 和 Contribution。SDK 会自动发送协议版本，
并为每次写调用生成新的幂等键；需要跨进程/跨调用严格重放时，应直接调用 REST 固定请求与
幂等键，或先扩展 SDK 的幂等键参数。

此包当前为 workspace 私有包（`private: true`），尚未发布到公共 npm registry。
