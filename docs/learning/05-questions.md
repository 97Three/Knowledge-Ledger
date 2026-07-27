# 项目追问：解释机制，也说明边界

| 问题 | 参考回答与思路 | 追问边界 |
| --- | --- | --- |
| 与普通 RAG 有何不同？ | 检索外还管理候选、证明、独立审核、发布、版本和效果证据 | 当前检索不是完整向量/hybrid 管线 |
| Candidate 为什么不能直接给 Agent 用？ | 未经过治理的候选不能污染 Published 消费通道 | 不是所有文本质量问题都能被扫描自动发现 |
| NIAN 是行业标准吗？ | 该仓库 v0.1 实验协议及参考实现 | 不把项目命名等同标准组织认证 |
| Manifest 与 payload 的区别？ | 前者描述身份、策略、来源与摘要，后者保存内容字节 | 二者靠 digest 绑定，不应独立覆盖 |
| Revision ID 如何产生？ | 规范化 JSON 后做 SHA-256，形成内容地址 | 哈希不等于签名，也不证明知识真伪 |
| 审核与发布为什么分开？ | 不同权限和独立证据避免作者自证即发布 | 仍需核对具体 Profile，不泛化 benchmark 要求 |
| 幂等与 ETag 是否重复？ | 前者解决同一动作重试，后者解决基于旧状态更新 | 数据库存储层仍要原子检查版本 |
| ContextPack 比文本列表多什么？ | 预算化片段、固定引用、义务、质量、回执与摘要 | 排名高不等于内容真实或满足所有业务要求 |
| 为什么先授权后排序？ | 防止越权候选参与结果选择，并避免过滤后丢失有权结果 | 不能仅靠前端过滤或 token 存在 |
| pgvector 是否说明有向量检索？ | 不能，当前 modes 只接受 lexical/exact | 基础设施可用与能力启用分开核实 |
| Exposure 与 Usage 有何区别？ | 返回过某知识与消费者实际采用是两类事实 | 消费者声明仍需引用与回执校验 |
| feedback 能直接改正文吗？ | 不能，内容修改继续走候选修订与治理 | 任务成功不能自动给每条知识正奖励 |
| MCP 是后端业务核心吗？ | 它通过 SDK 调 Core，把能力包装成工具 | 当前 stdio adapter 不暴露治理发布权限 |
| 有 RLS 就是多租户平台吗？ | 当前单租户进程下有数据库防护，但共享多租户验收未完成 | 角色、连接池、缓存和队列也要考虑 |

代码索引：版本看 [apps/core/src/contracts/revision.ts](D:/Code/Knowledge Ledger/apps/core/src/contracts/revision.ts)；状态和回执看 [apps/core/src/modules/growth/routes.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/growth/routes.ts)；查询看 [apps/core/src/modules/query/routes.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/query/routes.ts) 与 [apps/core/src/modules/query/search.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/query/search.ts)；门禁看 [apps/core/src/modules/evaluation/quality-gate.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/evaluation/quality-gate.ts)；接入看 [apps/mcp-server/src/server.ts](D:/Code/Knowledge Ledger/apps/mcp-server/src/server.ts)。

建议口头练习只选一个故事：“我提交了一条退款规则，第一次查询没有结果”。用它解释候选/发布、权限/用途、相关性/预算三个层面，最后指出每层对应的代码和验证方法。
