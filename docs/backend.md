# 后端开发与联调

更新：2026-10-26。统一实训已通过 [PR #9](https://github.com/2791243700-hue/agent-practice-lab/pull/9) 合并到 main `af36497`，包含第一关 1.1.0 正式复盘、草稿恢复、Tips 和提交弹窗。当前契约 v0.1.0：41 个 HTTP 操作、102 个 schema、11 类 SSE 事件。 接口以[契约说明](../contracts/README.md)为准，功能与验证见[统一交付](unified-practice-delivery.md)。

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

合并前重新验证：193 项后端、18 项前端单元、52 项浏览器、231 项契约结构检查全部通过。main `af36497` 的三类云端 CI 也全部通过。后端测试包含真实 SDK + 本地 HTTP 脚本服务，不消耗外部模型额度。2026-10-19 的 DeepSeek 后端实测为历史记录，不能代替新复盘、Tips 或 Key 导入的真实服务商验收，见[实测记录](live-model-validation.md)。

本次接口更新已修复 discriminator 映射并删除前端适配，见[更新记录](interface-update-2026-10-26.md)。第四关 task_id 指导和启动器前端 HTTP 就绪等待仍待完善。首版不提供线上身份系统、任意 shell、文件上传或自定义 MCP 执行。

## 复盘、Tips 与恢复接入

第一关 1.1.0 根据公开 ReflectionForm 渲染，GET/PUT reflection-draft 使用独立 revision，正式 ReflectionAnswers 经 POST /submissions 冻结评分；旧 1.0.0 继续 choice。完整字段映射、错误与调用顺序见[复盘接入说明](reflection-assessment-backend-handoff.md)。

草稿保存、正式提交、读取 Tips 都不调用模型。生成 Tips 需主动确认，POST 使用幂等键和已检查的当前配置；按运行缓存，失败手动重试，TIPS_UNCERTAIN 不再次请求。缓存可在清 Key 或重启后读取；编辑复盘不自动重评。服务端可以将匹配的已保存复盘提供给 Tips 模型，但私有评分参数不外发。

重置请求只传 expected_revision，不接受 profile_id 或 Key；模型选择由前端继续携带，后端内存凭据及检查保留。旧实验 superseded 且只读，旧草稿可读取/导出，新草稿为空。完整后端重启才会清空 Key 并使检查失效。ZIP 的 learning.json 包含 reflection_draft 及冻结提交，不包含模型配置或 Key。

## 内部结构清理（2026-10-23）

HTTP 边界和业务服务共享 Contracts 实例，避免重复读取和构建契约校验器；直接创建 School 的测试仍支持自动加载。离线 SDK 模拟器移至 `apps/api/tests/runtime_probe.py`，不再随生产包安装。对外 HTTP 操作、字段和状态码保持兼容，核对结果见[清理记录](cleanup-2026-10-23.md)。
