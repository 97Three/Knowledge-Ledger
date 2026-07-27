# 从能力发现到第一条发布知识

## 本机环境现状

仓库已在 `D:\Code\Knowledge Ledger`。项目声明 Node.js 24、pnpm 11，当前终端 Node 是 22.23.3，不能把当前全局环境称为已满足要求。本次没有替换全局 Node；Docker 命令未在当前 PATH 发现，也没有尝试启动容器。Python Worker 已使用独立的 Python 3.14.7 环境验证。

你可以以后选择完整容器环境，或准备 Node 24 后走原生开发。不要为了让安装通过就改项目 engines 或锁文件。

## 容器方式的已核对命令

以下是 **PowerShell**，前提是 Docker Desktop/Engine 与 Compose 已安装运行，端口 5432、33005、38085 可用。在该仓库目录执行：

```powershell
Set-Location D:\Code\Knowledge Ledger
docker compose config --services
docker compose --profile app up --build
```

这会下载/构建镜像、创建容器和持久卷，并初始化数据库。不是只读检查。默认 Compose 的 app profile 包含 Core 和 Web；Python Worker 不会因此自动启动。

浏览器访问 `http://localhost:33005`。依次完成 Discovery、Candidate、审核、发布、带引用查询。开发引导使用不同开发身份演示职责分离，不等于已经接入正式组织登录。

另一个 PowerShell 终端检查：

```powershell
Invoke-RestMethod http://localhost:38085/.well-known/nian
Invoke-RestMethod http://localhost:38085/health/ready
docker compose ps
docker compose logs --tail 80 core
```

端口冲突只调整本项目变量：

```powershell
$env:NIAN_HOST_PORT='38086'
$env:NIAN_WEB_PORT='33006'
docker compose --profile app up --build
```

数据库宿主机 5432 的映射另在 Compose 中定义，上面两个变量不解决数据库端口冲突。停止时使用 `docker compose down`，它保留命名卷；不要为了“重启”加删除卷选项。

## 原生方式的前提与顺序

准备符合仓库 engines 的 Node 24 和 pnpm 后，按 [docs/runbooks/local-development.md](D:/Code/Knowledge Ledger/docs/runbooks/local-development.md) 安装依赖、启动独立 PostgreSQL、创建本地配置并迁移，再分别运行 `pnpm dev` 和 `pnpm dev:web`。迁移会修改数据库，先确认目标是本项目开发库。根 [package.json](D:/Code/Knowledge Ledger/package.json) 中 sdk:check 使用 POSIX 环境变量赋值，Windows PowerShell 不能原样粘贴其内部命令。

## 不依赖数据库的先行练习

本次在 PowerShell 运行的 SDK 检查：

```powershell
$env:PYTHONPATH='packages/sdk-python'
python -m unittest discover -s packages/sdk-python/tests
Remove-Item Env:PYTHONPATH
```

Worker 测试：

```powershell
uv run --project workers/knowledge-worker --group dev pytest workers/knowledge-worker/tests -q -p no:cacheprovider
```

分别通过 3 项与 8 项。它们验证客户端及隔离 Worker 行为，不证明 Core/PostgreSQL 已跑通。

## 故障定位与验收

| 现象 | 先检查 | 成功标准 |
| --- | --- | --- |
| 页面打开但提交失败 | Core ready、浏览器响应、开发身份和协议头 | 能看到具体贡献回执，不只页面渲染 |
| 已提交搜不到 | 是否 publish、Space、purpose、查询模式 | 发布后在有权范围返回稳定引用 |
| 审核失败 | 作者身份冲突、旧 ETag、缺失证明 | 符合独立审核和 Profile 前提 |
| knowledge 工具不可用 | MCP 的 NIAN_BASE_URL、token、Core 连通性 | Discovery 和实际授权查询都通过 |
| 数据库连接失败 | 宿主机与容器地址是否混用 | Core 容器使用服务名 postgres，而非其自身 localhost |

练习不要直接改业务规则“让测试通过”。先预测拒绝原因，再观察接口回执。完成闭环后记录一个 contribution ID、revision ID 和 citation，对照源码说清它们各自代表什么。
