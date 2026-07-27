# 从“退款怎么处理”到一段有引用的上下文

Agent 需要的不是所有知识正文，而是当前用途允许读取、与问题相关、能放进上下文预算的片段。这里用“退款怎么处理”贯穿查询过程。

## 先决定能读什么，再谈相关性

[apps/core/src/modules/query/routes.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/query/routes.ts) 中 queries/context-packs 路由先解析输入与访问条件，再得到可消费资产集合。查询语义还绑定 Space、purpose、策略和义务；游标不能脱离授权上下文随意复用。

进入 [apps/core/src/modules/query/search.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/query/search.ts) 的 `PostgresQuerySearchStore.search` 时，查询使用 allowed 的 `(space_id, revision_id)` 集合与 tenant 条件，再做匹配、排序与候选上限。不能先全库 top-k 再用前端过滤掉其他用户内容：那样既可能漏掉有权看的结果，也暴露了错误的访问边界。

## 当前实现是词法与精确匹配

`requireImplementedMode` 只接受 exact/lexical。词法模式会做规范化和词项处理，并在 PostgreSQL 查询中用文本匹配及候选筛选，再进入 `rankCandidates`。不要把这里直接称作 BM25、神经 reranker 或 embedding 检索；具体算法以代码为准。

search.ts 中有查询包装语停用项，例如“如何”“请求”等。其意图是避免“请按如下要求处理这个退款问题”中的包装语稀释真正查询词。实验时可以比较短查询和礼貌长查询，但排名是否一致要看测试结果，不能只看注释便宣称所有同义问法都有效。

代码的切片参数是 UTF-8 字节：最大 1600、边界阈值 960、重叠 160。一个汉字不等于一个字节，因此不能把字节上限直接说成“1600 个汉字”。切片会保留 locator、payload digest 与 revision，使引用指向固定内容范围。

## ContextPack 是有预算的交付物

教学中间结果如下，不是精确 API 响应：

| 阶段 | 内容示意 |
| --- | --- |
| 已授权资产 | 退款规则 v1、订单核对指南 v2 |
| 检索候选 | 规则片段 A、指南片段 B、重复段 C |
| 预算选择 | A、B；C 可能因为去重或预算被省略 |
| ContextPack | 片段、引用、质量说明、义务、摘要、Exposure ID |

引用至少要能关联到固定 revision、payload digest 与定位信息。引用不是“随便附一个网页链接”；否则上游文本修改后，旧任务的依据就无法复查。

预算选择可能造成空结果或覆盖不足。`quality.decision` 与 warnings 应随内容一起交给消费方，不应只保留正文。当前零结果只表示在本次权限、模式、预算与知识集合下没找到，不是世界上不存在答案。

## Exposure、Usage、Feedback 不可合并

Exposure 表示服务向这个主体、用途暴露了哪些知识；Usage 声明消费使用了哪些引用；Feedback 描述有依据的效果。相同 request ID 方便串日志，但不能替代三者的业务回执。

[apps/core/src/modules/growth/routes.ts](D:/Code/Knowledge Ledger/apps/core/src/modules/growth/routes.ts) 对 usage/feedback 校验引用关系与当前有效性。反馈不会自动修改正文或发布状态。若需要更新知识，应走新候选、修订和治理流程。

在 QuantPilot 中，[src/lib/platform/knowledge/service.ts](D:/Code/QuantPilot/src/lib/platform/knowledge/service.ts) 的 `prepareGovernedKnowledge` 会再次检查 purpose 和 Space，区分 disabled、empty、prepared 等结果。外部服务返回 HTTP 200，不代表消费方可以无条件信任其业务字段。

练习：把同一查询分别放在有权/无权 Space 中，预测差异；再把预算减少，观察引用是否仍覆盖每段实际交付内容。相关测试入口：[apps/core/test/query-search.test.ts](D:/Code/Knowledge Ledger/apps/core/test/query-search.test.ts)、[apps/core/test/authorization.test.ts](D:/Code/Knowledge Ledger/apps/core/test/authorization.test.ts)。本次未启动 Core 做真实 HTTP 检索，测试与实测范围见证据页。
