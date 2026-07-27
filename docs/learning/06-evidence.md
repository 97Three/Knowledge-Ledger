# 核对范围与未验证项

核对日期：2026-10-29；基线为本仓库当前主分支。

已核对依赖声明、Compose、应用装配、版本摘要、贡献审核发布路由、质量门禁、查询与切片、SDK/MCP、Python Worker 和对应测试。技术描述以本次源码为准，未直接把 README 宣传语当作运行结论。

实测：Python SDK 的 unittest **3 项通过**；Python Worker pytest **8 项通过**。Worker 由 uv 建立隔离环境，解释器为 Python 3.14.7。SDK 测试使用本机 Python 3.11.8，并非 Core 的 Node 环境。

未执行：Node Core/Web 全套检查、构建、真实 PostgreSQL 集成、浏览器引导、MCP 外部客户端调用、四项目联合验收。当前 Node 为 22.23.3，不满足本仓库声明的 Node 24；当前 PATH 未发现 docker。没有替换全局运行时，也没有启动任何本项目常驻服务。

测试参考：[packages/sdk-python/tests/test_client.py](D:/Code/Knowledge Ledger/packages/sdk-python/tests/test_client.py)、[workers/knowledge-worker/tests/test_worker.py](D:/Code/Knowledge Ledger/workers/knowledge-worker/tests/test_worker.py)。只读检查与样例测试不能推导吞吐量、多租户隔离验收或生产可靠性。

本次新增本地学习文档，未修改业务代码、根 README、锁文件或 Git 历史，未提交或推送。原始文档仍保留。后续源码更新时，先核对 Revision、查询模式、Profile 要求、默认配置，再更新学习材料。
