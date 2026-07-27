# 从一条退款规则读懂受治理知识平台

这个项目让 Agent 读取有来源、版本和授权边界的知识，也允许提交新候选。候选必须经过审核与发布才能成为可消费知识；一次搜索结果不会直接改写知识正文。

教程面向有 Java 后端基础的读者。Core 用 TypeScript/Fastify，Web 用 Vue 3/Vite，另有 Python Worker、SDK 和独立 MCP Adapter。先理解服务职责，再学语言差异，不必先学完整前端生态。

## 推荐路径

1. [候选怎样成为发布知识](01-publication.md)：跟踪一条规则，理解角色与状态。
2. [查询怎样形成可引用上下文](02-query-context.md)：理解权限、切片、检索、预算与回执。
3. [版本、并发与接入](03-version-auth-integration.md)：理解内容地址、幂等、ETag、SDK/MCP。
4. [启动与动手练习](04-run-and-practice.md)：先看能力发现，再走引导闭环。
5. [项目追问](05-questions.md)：检查概念是否能落到源码。
6. [本次证据](06-evidence.md)：明确实测范围与环境缺口。

第一轮完成标志：你能解释“提交成功为什么搜不到”“同一内容如何固定引用”“当前用户为什么可能看不到某条知识”。第二轮再读 PostgreSQL 事务、RLS 与生产治理。

当前启用 source_document/procedure Profile 与 lexical/exact 查询。NIAN v0.1 是此项目的实验协议草案，不是通用行业标准；pgvector 出现在基础设施里，不证明 semantic/hybrid 查询已经启用。

核对日期：2026-10-29；基线：本仓库当前主分支。仓库地址：[knowledge-ledger](https://github.com/97Three/Knowledge-Ledger)。文档入口为 [docs/README.md](../README.md)；本套提供按业务链路学习的补充。
