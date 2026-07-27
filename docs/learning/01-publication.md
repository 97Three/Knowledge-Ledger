# Agent 提交了退款规则，为什么用户还搜不到？

假设团队要沉淀“退款前先核对订单状态”这一操作规则。它可能来自人、文档或 Agent，但来源不同并不改变一件事：新内容首先是候选，不能因为提交者说它正确就直接发布。这个教学例子与仓库退款场景测试相近，不代表本次已往数据库写入规则。

## 入口接收到的不只是正文

[apps/core/src/modules/growth/routes.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/growth/routes.ts) 中 `registerGrowthRoutes` 注册 `/contributions`。请求进入后核对协议版本、主体权限、幂等键及 Schema，再将 manifest 与 payload 等内容组织为贡献状态。API 路由前缀由 [apps/core/src/app.ts](D:/Code/Knowledge Ledger/apps/core/src/app.ts) 注册，阅读路径时要看组合后的实际 URL。

Manifest 是这份知识的描述与约束：身份、内容摘要、来源、适用 Profile、策略等。Payload 才是实际内容字节。不要把这两者理解成两个可以随意独立修改的文本字段：Manifest 通过摘要绑定 payload。

| 阶段 | 变化的对象 | 尚未证明什么 |
| --- | --- | --- |
| 提交候选 | Contribution 与 subject revision | 未证明内容通过独立审核 |
| 补证或审核 | Attestation、review decision、workflow version | 未证明已经发布 |
| 发布 | PublishedAsset、publication event、accepted receipt | 未证明对任何用户、任何用途都可见 |
| 消费 | 当前授权下的引用、Exposure 回执 | 未证明该知识对任务产生了正面作用 |

这类流程适合借用 Java 状态机经验：每个动作都有允许的前置状态、执行权限和持久化结果。它不是让模型自行选择下一状态。

## 审核与发布是两个动作

`/contributions/:contributionId/decisions` 检查 reviewer 与 contributor 的身份摘要，拒绝作者独立审核自己的贡献。还核对 If-Match、当前候选状态和证明材料。证明不是一个随意填写的“已审核=true”，它要绑定目标 Revision 和内容摘要，且满足有效期及 Profile 要求。

`/actions/publish` 另外要求发布权限、当前工作流可发布、策略版本一致、独立证明满足要求。修订操作还检查父版本属于同一 record。随后创建 PublishedAsset 与 publication event，由存储方法 `publishContribution` 处理版本前提和保存。

注意细节：本次查看的发布路由向 `evaluateAttestationGate` 传 `requireBenchmark: false`，但仍检查 Profile 的 requiredAttestations。因此不能一概说“所有知识都必须跑一次 benchmark 才能发布”，也不能说“完全不需要质量门禁”。具体要求来自已启用 Profile 与当前路由。

核对 [apps/core/src/modules/evaluation/quality-gate.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/evaluation/quality-gate.ts)：证明要来自可信发行者，绑定正确目标，时间合法，结果为 pass/warning；若出现 benchmark-result，还要核对对应 EvaluationRun 的完成状态和关联对象。

## 为什么“质量高”仍可能不可见

规则已发布，也可能用途不匹配、Space 不允许、证明过期或状态已撤销。发布解决“平台是否接受这个版本”，授权解决“这个主体能否为这个用途读取”。二者不能互相替代。

也不要把静态内容扫描理解成保证文本绝不会诱导 Agent。知识正文仍需当作不可信数据；消费方应保留指令边界，不能把检索文本升级为系统指令。

## 阅读与自测

先沿 growth routes 找提交、decisions、publish 三段，再看 [apps/core/src/modules/growth/store.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/growth/store.ts) 的保存接口，最后读 [apps/core/test/growth-loop.test.ts](D:/Code/Knowledge Ledger/apps/core/test/growth-loop.test.ts)。每读一个动作，都记录“输入状态、身份、前提、结果状态”。

练习：预测 contributor 用同一身份 review 的结果；预测另一个 reviewer 使用旧 ETag 的结果；预测审核完成但没 publish 时的查询结果。完成标志不是背出状态名称，而是能解释每次拒绝在保护什么。
