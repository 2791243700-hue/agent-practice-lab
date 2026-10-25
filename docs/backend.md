# 后端开发与联调

2026-10-25 当前更新：统一实训、新版 1.1.0 正式复盘及草稿 API 已在 PR #9 功能分支接入，尚未合并 main。当前协议为 41 操作、102 schema；以下既有记录按日期保留，其“预览/未接入/37 或 39 操作”描述属于历史基线。最新功能与验证以[统一交付](unified-practice-delivery.md)和[当前索引](project-status.md)为准。

2026-10-23 通过 feat/practice-tips-and-feedback 分支交付，尚未合并 main：新增按需模型 Tips（GET/POST `/runs/{run_id}/tips`），当前本地 39 个 HTTP 操作、92 个 schema；缓存按运行持久保存，独立于正式评分。用量与异常/中断处理见[契约说明](../contracts/README.md)，使用边界见[版本状态](project-status.md)。下文 2026-10-22 的数字与验证记录属于已合并历史基线。

历史基线（2026-10-22）：后端本地实现 v0.1.0 的 37 个 HTTP 操作，已与前端接通课程、Key 管理、Agent 运行、授权、评分、下载和导出。已合并的 main 版本与验证边界见[版本状态](project-status.md)。

## 准备

2026-10-24 前端变化：第一关旧单选提交已被复盘模板替换，新复盘不调用正式提交，也不能生成新通关成绩。后端旧契约作为兼容能力保留；第二至四关继续正式验收。新答案、评分、存储、回看和导出需按[后端清单](reflection-assessment-backend-handoff.md)先协调再实现。本文其余接口说明仍对应已发布 v0.1.0。

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

## 前端的接入位置

浏览器只调用同源 /api/v1。Next.js 的服务端代理使用：

| 私有环境变量 | 用途 |
| --- | --- |
| AGENT_SCHOOL_API_ORIGIN | 默认 http://127.0.0.1:8000，FastAPI 地址 |
| AGENT_SCHOOL_LOCAL_TOKEN | 为转发请求覆盖 X-Local-Token，不读取浏览器同名头 |
| AGENT_SCHOOL_FRONTEND_ORIGIN | 默认 http://127.0.0.1:3000，校验浏览器 Origin 与 Host |

禁止给令牌变量加 NEXT_PUBLIC 前缀。代理不要缓冲 SSE，保留 Last-Event-ID、状态码、Content-Type 和下载附件头。前端写请求还需拒绝缺失 Origin 或错误 Host；后端允许带内部令牌的无 Origin 启动器/开发请求。

课程目录和导读不需要模型 Key。设置页使用 connectProfile → 选择目录模型/必要时 updateProfile → checkConnection；旧 createProfile → setCredential 流程保留兼容。新增 listProfileModels 使用当前内存 Key 请求所选服务商 GET /models，不自动推理。connectProfile 必须有幂等键，官方 DeepSeek/OpenAI 自动定位地址，兼容服务支持自定义地址和显式手动模型。详见[契约](../contracts/README.md)。

检查会发出最多三次模型请求，验证文本、标准工具调用和工具结果继续处理；真实运行要求当前配置检查通过且内存凭据存在，凭据变更会清空检查，没有独立的 generation 字段。模型列表不是工具兼容证明。目录、检查与 Run 共用全局槽；使用中的 profile 不能修改、删除或清除 Key。多个 Key 可独立管理，重启仅保留非敏感元数据；只改名保留检查，改模型/地址/凭据使检查失效。

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

最近本地通过 91 项后端测试、197 项契约检查及 Ruff，见[后端验证报告](runtime-validation.md)。自动测试包含真实 SDK + 本地 HTTP 测试服务；2026-10-19 另有 DeepSeek 后端实测，四关正式提交通过但第四关依赖额外任务 ID 提示，详见[实测记录](live-model-validation.md)。新增 Key 导入/目录尚未用真实服务商复测，不能以旧实测代替。

当前 8 项前端与 26 项浏览器回归通过；浏览器用本地脚本模型，真实外部模型的浏览器验收仍待执行。TypeScript discriminator 适配、第四关指导和启动器未等待前端 HTTP 就绪仍待完善。首版不提供线上身份系统、任意 shell、文件上传或自定义 MCP 执行。

## 内部结构清理（2026-10-23）

HTTP 边界和业务服务共享 Contracts 实例，避免重复读取和构建契约校验器；直接创建 School 的测试仍支持自动加载。离线 SDK 模拟器移至 `apps/api/tests/runtime_probe.py`，不再随生产包安装。对外 HTTP 操作、字段和状态码保持兼容，核对结果见[清理记录](cleanup-2026-10-23.md)。
