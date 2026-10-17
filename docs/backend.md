# 后端开发与联调

后端实现 v0.1.0 的 35 个 HTTP 操作。前端页面由 A 开发；当前可独立验证课程、配置、Agent 运行、授权、评分、下载和导出。

## 准备

需要 Python 3.11 或 3.12 与 uv。模型使用 AgentScope 2.0.10 SDK，不需要 Redis、数据库服务器或 Docker。锁文件固定依赖，项目级虚拟环境放 apps/api/.venv。

在仓库根目录运行：

```powershell
uv sync --project apps/api --locked
uv run --project apps/api pytest apps/api/tests -q
```

测试使用独立临时目录和本地测试提供商，不消耗外部模型额度。首次同步需要联网下载依赖。

## Windows 启动与停止

```powershell
.\scripts\start.ps1 -ApiPort 8000 -WebPort 3000
.\scripts\stop.ps1
```

可使用 -DataDir 指定独立数据目录；启动和停止需使用相同目录。-NoWeb 仅启动 API；-Demo 开启显式演示模式，默认关闭。检测到 apps/web/package.json 后会同时启动前端，并要求 Node.js/npm 和前端已安装依赖。

启动器生成一次性 AGENT_SCHOOL_LOCAL_TOKEN，经私有环境变量传给前后端。令牌不写进参数、PID 文件或配置文件。后台进程隐藏运行，日志在 data/runtime/；SQLite、文件和快照保存在 data/。API 只绑定 127.0.0.1，单进程单 worker。API 有内部令牌校验，直接用浏览器访问后端地址会返回 401；学生从前端地址使用应用。

同一数据目录有 OS 进程锁，拒绝第二个后端实例。端口被其他程序占用时退出；停止时核对本项目 supervisor 的 PID、创建时间和命令，随后仅清理其子进程。Windows 停止后台进程可能中断当前运行；下次启动会保留记录并标记 interrupted，不自动重做任务。

## 前端 A 的接入位置

浏览器只调用同源 /api/v1。Next.js 的服务端代理使用：

| 私有环境变量 | 用途 |
| --- | --- |
| AGENT_SCHOOL_API_ORIGIN | 默认 http://127.0.0.1:8000，FastAPI 地址 |
| AGENT_SCHOOL_LOCAL_TOKEN | 为转发请求覆盖 X-Local-Token，不读取浏览器同名头 |
| AGENT_SCHOOL_FRONTEND_ORIGIN | 默认 http://127.0.0.1:3000，校验浏览器 Origin 与 Host |

禁止给令牌变量加 NEXT_PUBLIC 前缀。代理不要缓冲 SSE，保留 Last-Event-ID、状态码、Content-Type 和下载附件头。前端写请求还需拒绝缺失 Origin 或错误 Host；后端允许带内部令牌的无 Origin 启动器/开发请求。

课程目录和导读不需要模型 Key。模型配置按 createProfile → setCredential → checkConnection 顺序调用；检查会发出最多三次模型请求，验证文本、标准工具调用和工具结果继续处理。真实运行要求当前配置和凭据代次的工具检查通过。

继续实验时用 Attempt.lesson_version 读取课程；按 last_seq 恢复事件。批准卡片显示完整参数；批准后等待 tool.completed，不能提前显示“已保存”。正式通过看 Submission.passed；演示只显示 evaluation_passed。

完整字段、错误码和示例见 [契约](../contracts/README.md)。前端使用 contracts/types.d.ts；接口结构仍以 JSON 契约为规范来源。当前 FastAPI 路由边界校验请求和响应，避免两份类型定义漂移；后续切换 Pydantic 全量导出时需保持这些行为。

## 仅后端手动调试

在同一 PowerShell 会话中：

```powershell
$env:AGENT_SCHOOL_LOCAL_TOKEN = [guid]::NewGuid().ToString("N")
$env:AGENT_SCHOOL_DATA = Join-Path $PWD "data"
$env:AGENT_SCHOOL_FRONTEND_ORIGIN = "http://127.0.0.1:3000"
$env:AGENT_SCHOOL_DEMO = "1"
uv run --project apps/api uvicorn agent_school.main:app_factory --factory --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

开发请求在本地使用 X-Local-Token 头，值取本会话的私有变量。API /openapi.json 同样受令牌保护。不要把令牌或学生 Key 复制到公开仓库、截图或 PR。

## 数据与恢复

- SQLite 由 SQLAlchemy 管理，Alembic 自动迁移至 head；也可在 apps/api 运行 uv run alembic upgrade head，重复运行安全。
- 课程版本包含导读、任务和材料正文的归档；已发布版本不可原地改写。课程内容调整应发布新版本。
- 运行事件先持久化再发送，刷新不重复工具执行；重启使未完成任务 interrupted、未决授权 cancelled，Key 清空，连接检查失效。
- 创建类接口幂等成功结果持久化。若连接检查期间进程崩溃，原 key 保留未确认状态，返回 IDEMPOTENCY_IN_PROGRESS，retryable=false；用户查看当前配置后可用新操作 key 重试，系统不自动重复计费调用。
- 实验产物按文件组原子发布；提交复制文件形成不可变快照。拒绝保存前后的哈希用于验收。导出排除个人连接配置与凭据，导出包上限 25 MiB。
- 材料和产物每个最多 1 MiB；前端预览最多 20000 字符。文件边界拒绝父目录穿越、绝对路径、symlink 和 Windows junction；它不是任意程序执行的操作系统沙箱。

## 验证与限制

验证结果见 [后端验证报告](runtime-validation.md)。自动测试包含真实 SDK + 本地 HTTP 测试服务，不能替代外部提供商兼容性实测。当前没有使用学生 Key，外部真实模型连接尚未验证。

尚无前端浏览器端到端验收；待 A 接入后共同执行。首版不提供线上身份系统、任意 shell、文件上传或自定义 MCP 执行。
