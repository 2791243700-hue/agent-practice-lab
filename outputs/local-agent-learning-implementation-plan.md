# 本地 Agent 教学平台 Implementation Plan

2026-10-27 实现对照：第一关 1.2.0、其余三关 1.1.0 已接入客观证据与模型内容联合验收，契约 41 操作 / 109 schema / 11 事件。现行范围见[版本索引](../docs/project-status.md)，评分与接口见[验收说明](../docs/model-assessment-2026-10-27.md)。以下为原设计或原始分工归档，日期、旧版规则及待办须结合版本阅读，不覆盖已发布课件。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 按用户最新要求，改为两名开发者在同一个 GitHub 仓库协作，具体归属见 [双人协作方案](two-person-github-collaboration-plan.md)。两名开发者不等于两个自动代理。

**Goal:** 构建浏览器内完成导读、配置、Agent 实训、授权、提交和反馈的本地单用户教学应用。

**Architecture:** Next.js 前端通过同源 API 转发连接单进程 FastAPI，AgentScope SDK 经 AgentRuntime 适配层运行。SQLite 保存版本化课程、尝试、事件和提交，本地工作区保存材料及产物，Key 仅保存在后端内存。运行、凭据、存储和调度按模块组织；身份协议只保留声明，当前服务与存储仍固定使用 local-owner，尚未注入可替换身份实现。

**Tech Stack:** Next.js、TypeScript、FastAPI、AgentScope（先验证 v2.0.10）、Python 3.11/3.12、SQLAlchemy、Alembic、SQLite、SSE、pytest、Playwright。

**Spec:** [已确认设计](local-agent-learning-design.md)，以及 [四关导读](lesson-introductions.md)。执行者先读这两份文档。

初稿：2026-10-17；进度同步：2026-10-22。四关应用和本地启停已实现，PR #1—#7 已合并；新增 Key 管理、审查修复及实训工作区交互均已进入 main。HTTP 字段、状态和边界行为以[现行契约](../contracts/README.md)为准，精确交付状态见[版本状态](../docs/project-status.md)。

## 当前执行结果

| 原任务 | 当前交付 |
| --- | --- |
| 1：SDK 探针 | AgentScope 2.0.10 适配、读取/保存/拒绝/取消及错误测试已实现 |
| 2：课程与实验 | 四关 1.0.0 导读、材料、归档、归属和独立实验已实现；第四关任务 ID 指导待新版本修正 |
| 3：模型与凭据 | 内存凭据和兼容检查已实现；已加入官方服务商定位、目录及多 Key 管理 |
| 4—6：工具/运行/验收 | 受控工具、逐次授权、恢复、规则评分、不可变快照和导出已接通 |
| 7：浏览器闭环 | 四关、恢复、授权、预览及设置已实现，26 项浏览器测试通过；真实服务商浏览器验收仍待执行 |
| 8：本地交付 | 启停和文档已提供；启动器前端 HTTP 就绪等待尚待完善 |

2026-10-22 本地验证为 197 项契约、91 项后端、8 项前端及 26 项浏览器测试通过，Ruff/格式/类型/生产构建通过。2026-10-19 DeepSeek 后端四关实测通过，但第四关额外给出任务 ID 映射；新 Key 导入/列表未做外部实测。详见[后端报告](../docs/runtime-validation.md)、[前端报告](../docs/frontend-validation.md)、[实测边界](../docs/live-model-validation.md)。

以下任务框保留原始实施拆分，不追溯勾选当时每条“先失败再通过/逐步提交”的过程，也不作为当前未完成清单。文件名和方法签名是最初建议，实际服务聚合与路径以当前源码和契约为准；不要重建重复模块。当前剩余工作以版本状态页为准。

## Global Constraints

- 面向零 Agent 使用经验；学生通过浏览器完成实训，自行申请 API Key；API 不是课程主线。
- 每关必须先有文字导读，未配置 Key 也能阅读，实训中可随时回看。
- 默认身份 local-owner；所有业务记录包含 owner_id，服务端解析身份。
- 单进程运行，全局最多一个运行中的任务；首版不依赖 Redis 或容器服务。
- 每轮默认最多 10 次模型调用，普通执行最长 120 秒；等待授权默认 10 分钟，独立计时。
- API Key 仅存在后端内存，不进入 localStorage、SQLite、日志、模型提示词、导出或工作区；重启后重新输入。
- 首版仅允许课程指定的文本读取、课程查询和待办保存工具，无任意 shell/Python 执行、外部 MCP 安装或插件市场。
- 工具与设置限制在后端执行；批准操作不扩大课程工具权限。
- 真实运行与模拟运行严格区分；模拟结果不能使正式课程完成。
- 默认前端 127.0.0.1:3000、后端 127.0.0.1:8000，端口可配置；线上登录及部署只预留接口。
- 在 Windows 上优先验收；不无提示改动全局 Node/Python 安装。
- 实施时在现有工作区创建代码；设计和计划作为用户交付物保留在 outputs。统一使用公开仓库 https://github.com/2791243700-hue/agent-practice-lab，默认分支 main。初始提交提供文档基线；应用代码后续通过功能分支与 PR 逐步合并，保留已有历史。

## Review Focus

1. **刷新、SSE 断线与重新打开页面**：只补读事件，不重复调用模型或执行工具；任务 5 的事件重放测试及任务 7 的浏览器重连测试覆盖。
2. **重置、取消和授权同时发生**：旧任务不能继续写新实验，过期授权不能生效；任务 4、5 的竞争与重复授权测试覆盖。
3. **Windows 路径及链接**：中文路径可用，父目录穿越、junction、符号链接不能越过工作区；任务 4 的实际文件系统测试覆盖。
4. **“兼容”模型返回异常格式或泄露请求内容**：明确提示不兼容/失败，错误中不出现 Key；任务 1、3 的模型适配与脱敏测试覆盖。
5. **课程更新及重新提交**：旧实验使用旧导读与规则，旧成绩不被文件变化重写；任务 2、6 的版本与快照测试覆盖。

## 文件组织与边界

以下路径相对本项目根目录。每个功能文件负责表中列出的单一模块；不要提前创建未使用的远程实现。

| 文件/目录 | 职责 |
| --- | --- |
| apps/api/pyproject.toml、uv.lock | Python 依赖和锁定版本；uv 若不可用，在项目环境准备后使用，不假设已安装 |
| apps/api/src/agent_school/contracts.py | 跨模块 DTO、Protocol 与标准事件 |
| apps/api/src/agent_school/runtime/ | SDK 适配、连接检查、确定性模拟实现 |
| apps/api/src/agent_school/identity.py、db.py、models.py | 本地身份、数据库会话、持久化模型 |
| apps/api/alembic/ | 可重放数据库迁移 |
| apps/api/src/agent_school/lessons.py、attempts.py | 课程版本导入、实验配置与生命周期 |
| apps/api/src/agent_school/credentials.py、model_profiles.py | 内存凭据与非敏感连接配置 |
| apps/api/src/agent_school/workspaces.py、tools.py、approvals.py | 文件边界、受控工具与逐次授权 |
| apps/api/src/agent_school/runs.py、events.py | 调度、状态恢复、事件持久化与 SSE |
| apps/api/src/agent_school/grading.py、submissions.py、exports.py | 规则检查、提交快照与导出 |
| apps/api/src/agent_school/main.py、routes/ | FastAPI 入口与各资源路由，业务逻辑留在上述模块 |
| apps/api/tests/ | 后端单元/集成测试；临时数据库、文件、模型、时钟 fixtures |
| apps/web/src/app/、components/、lib/ | 路由、教学组件、API 客户端与事件状态 |
| content/lessons/01-task/、02-context/、03-tools/、04-permission/ | 各含 manifest.json、intro.md、task.md、材料、规则和理解题；目录 ID 与 API 一致 |
| contracts/ | 已提供 OpenAPI、事件/课程 schema、TypeScript 类型、模拟样例和验证工具 |
| data/ | SQLite、工作区、快照，加入 .gitignore |
| scripts/start.ps1、stop.ps1 | 启停本项目进程，不终止其他同端口进程 |
| docs/runtime-validation.md、README.md | 技术验证证据、使用说明与限制 |

## 共用契约

任务 1 在 contracts.py 定义以下 Python 类型；后续任务保持字段与名称一致。具体序列化使用 Pydantic，日期和事件时间使用 ISO 8601 字符串。

- `Actor(id: str, auth_mode: Literal["local"])`。
- `ChatMessage(role: Literal["system", "user", "assistant", "tool"], content: str, tool_call_id: str | None, tool_calls: list[ToolCall])`；`ToolSpec(name: str, description: str, input_schema: dict, approval_required: bool)`，均由任务 1 定义并供 SDK 适配使用。
- `ModelAccess(provider: str, base_url: str, model: str, api_key: SecretStr)`：运行期对象，不可持久化。
- `RuntimeRequest(run_id: str, attempt_id: str, messages: list[ChatMessage], settings: dict, allowed_tools: list[ToolSpec], model: ModelAccess, mode: Literal["live", "demo"])`。
- `ToolCall(id: str, name: str, arguments: dict)`；`ToolResult(call_id: str, status: Literal["ok", "denied", "error"], data: dict)`。
- `RuntimeEvent(kind: str, payload: dict)`；`StoredEvent(run_id: str, seq: int, kind: str, payload: dict, created_at: str)`。
- `RuleResult(rule_id: str, passed: bool, required: bool, message: str, evidence_refs: list[str])`。
- `AgentRuntime.stream(request: RuntimeRequest, invoke_tool: Callable[[ToolCall], Awaitable[ToolResult]]) -> AsyncIterator[RuntimeEvent]`；`AgentRuntime.cancel(run_id: str) -> Awaitable[None]`。
- `IdentityProvider.current_actor() -> Actor`；`CredentialStore.set(owner_id, profile_id, key: SecretStr) -> None`、`get(owner_id, profile_id) -> SecretStr`、`delete(owner_id, profile_id) -> None`。
- 运行事件限定为 `run.started`、`message.delta`、`message.completed`、`tool.requested`、`approval.requested`、`approval.decided`、`tool.completed`、`run.completed`、`run.failed`、`run.cancelled`、`run.interrupted`。事件来自服务端，原始提供商对象不直接透传。

返回 DTO 在双人并行开发前由开发者 B 定义最小版本：RunView 至少含 id、attempt_id、mode、status、last_seq；ApprovalView 含 id、run_id、call_id、arguments、decision、expires_at；SubmissionView 含 id、attempt_id、lesson_version、passed、rules、created_at；文件引用只包含服务端 ID、相对展示路径和哈希，不向浏览器暴露任意绝对路径。LessonDefinition 字段对应模板，SnapshotRef 为不可变目录引用与哈希，AttemptEvidence 包含当前尝试的真实运行、工具及授权记录。

现有 contracts/openapi.json、events.schema.json、lesson.schema.json、types.d.ts 和 examples/ 是双方基线。JSON 契约继续为规范来源，路由校验、内部 Pydantic DTO 已实现，全量模型导出延后。前端复用生成类型及样例，discriminator 差异暂由边界适配处理。SSE 每种事件有明确 payload schema。接口变更同时更新契约、示例及消费方；双方确认后合并。

v0.1.0 的补充约定：Attempt.mode 创建后固定；Run 从 Attempt 继承模式，live 要求 profile_id、demo 要求 null。Submission.evaluation_passed 表示规则检查通过，passed 仅表示真实实训正式通过。新增实训与运行历史、事件分页、提交快照附件和导出下载接口。设置采用 expected_revision，创建类操作使用 Idempotency-Key。其他精确字段及错误码见接口契约，不按下文服务方法签名自行推导 HTTP 请求体。

## Task 1：验证 SDK 能完成真实的工具调用循环

**Files:** 创建 contracts.py、runtime/agentscope_runtime.py、runtime/probe.py、runtime/demo_runtime.py、apps/api/pyproject.toml、tests/test_runtime.py、docs/runtime-validation.md。

**Interfaces:** 实现共用契约 `AgentRuntime`；`probe_runtime(scenario: Literal["read", "deny", "cancel", "malformed"]) -> ProbeResult` 返回 `tool_calls`、`writes`、`terminal_state`、`events`。测试提供协议兼容的脚本模型，走真实 SDK 调用链。

- [ ] 核对 Node/npm 与可用 Python 的实际版本；当前仅已发现命令路径，python/py 是 WindowsApps 路径，不能当成已确认可运行的 Python。准备项目级环境并锁定兼容依赖。
- [ ] 编写 SDK 探针测试：read 场景恰好执行一次指定工具；deny 场景 `writes == 0`；cancel 最终 `terminal_state == "cancelled"`；malformed 返回结构化错误且输出不包含测试 Key。
- [ ] 在 apps/api 运行 `uv run pytest tests/test_runtime.py -q`，确认测试因适配尚未实现而失败。
- [ ] 实现 `AgentScopeRuntime.stream/cancel`，只注册 request.allowed_tools，经 invoke_tool 执行；对 SDK 的具体 API 通过固定版本代码确认，不沿用开发版文档猜测。权限由后续工具包装层控制；SDK 若不提供合用暂停机制，await invoke_tool 即为等待点。
- [ ] 运行相同测试并确认通过；记录具体 SDK API 和限制。真实服务商验证留待任务 7 页面可输入 Key 后完成，此时明确标注尚未验证外部服务。
- [ ] 实现独立 DemoRuntime，以明确模拟事件支持后续无 Key 开发，默认生产配置不启用 demo；提交该任务。

## Task 2：课程导读、版本和本地实验记录

**Files:** identity.py、db.py、models.py、lessons.py、attempts.py、alembic/versions/0001_initial.py、content/lessons/*、tests/test_lessons.py、tests/test_attempts.py。

**Interfaces:** `LessonCatalog.get(lesson_id, version: str | None) -> LessonDefinition`；`AttemptService.create(actor, lesson_id) -> AttemptView`；`get(actor, attempt_id) -> AttemptView`。AttemptView 含 id、owner_id、lesson_id、lesson_version、settings、selected_file_ids、progress；后续服务通过 id 查询，不能直接接受任意工作区路径。

- [ ] 定义 manifest 字段与数据表；四关导读从已确认稿拆分。固定材料为虚构教学通知：任务 `submit-summary` 截止 2026-11-04，`reserve-lab` 截止 2026-11-06；课程查询 `agent101` 返回 2026-11-05、A301。日期明确属于示例，不使用系统当天生成。
- [ ] 写测试：四关 intro 正文非空；缺 intro_file 拒绝导入；发布版本 2 后版本 1 的实验仍返回版本 1 导读与规则；伪造 owner 读取实验返回 not-found；不同 Attempt id 不同且不共享设置。
- [ ] 运行 `uv run pytest tests/test_lessons.py tests/test_attempts.py -q` 确认失败。
- [ ] 实现 SQLite 模型、迁移、LocalIdentityProvider、模板导入及实验创建。模板路径也受课程目录边界约束；所有版本内容存档，不在读取旧实验时重新解析最新文件。
- [ ] 运行相同测试；执行 `uv run alembic upgrade head` 两次确认迁移可重复执行；提交该任务。

## Task 3：自备模型配置及内存凭据

**Files:** credentials.py、model_profiles.py、runtime/model_connector.py、routes/model_profiles.py、tests/test_credentials.py、tests/test_model_connector.py。

**Interfaces:** `ModelConnector.check(access: ModelAccess) -> ConnectionCheck(text_ok: bool, tools_ok: bool, error_code: str | None, message: str)`；`ModelProfileService.resolve(actor, profile_id) -> ModelAccess`。CredentialStore 实现为 InMemoryCredentialStore，secret 字段从所有响应 DTO 排除。

- [ ] 写测试：重建 CredentialStore 后 Key 不存在；GET 配置、SQL 数据和错误日志不含 Key；文本调用成功而工具不兼容时 tools_ok=false；认证失败/超时/非 JSON 返回有明确错误码；自定义 base_url 的查询参数和 userinfo 不得存放凭据。
- [ ] 运行 `uv run pytest tests/test_credentials.py tests/test_model_connector.py -q` 确认失败。
- [ ] 实现非敏感配置 CRUD、凭据 set/delete 和 OpenAI-compatible Chat Completions 检查。检查包含小型无副作用工具调用，页面提示会使用模型额度；失败不自动无限重试。
- [ ] 将 Key 清除接口与后续任务运行锁对接：被运行任务占用时返回 409，提示先停止。用 MemoryCredentialStore 对外仅返回“已配置/未配置”。
- [ ] 运行相同测试通过，检查 SQLite 及捕获日志中的测试密钥零命中；提交该任务。

## Task 4：受控工作区、工具和逐次授权

**Files:** workspaces.py、tools.py、approvals.py、tests/test_workspace.py、tests/test_approvals.py。

**Interfaces:** `WorkspaceStore.create(actor, attempt_id, lesson) -> WorkspaceRef`、`read_material(actor, attempt_id, file_id) -> Material`、`save_todos(actor, attempt_id, items: list[TodoItem]) -> ArtifactRef`、`snapshot(actor, attempt_id) -> SnapshotRef`；`ToolGateway.invoke(actor, run_id, call: ToolCall) -> ToolResult`；`ApprovalBroker.decide(actor, approval_id, decision: Literal["approve", "deny"]) -> ApprovalView`。

TodoItem 包含 task_id、title、due_date、source_id。来源 ID 为课程预置资料标识；模型工具响应可携带它，学生界面用资料标题显示。保存工具同时生成 Markdown 与 JSON，并记录两者内容哈希；文件组以临时目录生成后原子发布，避免只保存一半。

- [ ] 写实际文件测试：中文目录正常；`../`、绝对路径、外指 junction/符号链接不能读取；只允许 selected_file_ids 对应材料；未知工具被拒绝；deny 前后文件哈希相同；approve 生成两个一致产物；重复审批不会重复写入。
- [ ] 写授权边界测试：参数变更需新 approval；取消或过期的 approval 不执行；审批期限用可注入时钟验证 600 秒，不真实等待十分钟。
- [ ] 运行 `uv run pytest tests/test_workspace.py tests/test_approvals.py -q` 确认失败。
- [ ] 实现四个工具 `list_materials`、`read_material`、`lookup_course`、`save_todos`。读取限 1 MiB，文本返回限 20,000 字符并明确标注截断，课堂材料保持远低于上限。使用 run_id+call_id 去重，授权决定与执行状态关联。
- [ ] 运行相同测试通过；Windows 链接测试若环境无法建立链接，应记录限制，不静默视为隔离已验证；提交该任务。

## Task 5：运行调度、事件、恢复和重置

**Files:** runs.py、events.py、routes/runs.py、routes/approvals.py、attempts.py、tests/test_runs.py、tests/test_events.py、tests/test_recovery.py。

**Interfaces:** `RunService.start(actor, attempt_id, profile_id, input_text, idempotency_key, mode="live") -> RunView`；`cancel(actor, run_id) -> RunView`；`AttemptService.reset(actor, attempt_id) -> AttemptView`；`EventStore.append(run_id, event: RuntimeEvent) -> StoredEvent`；`subscribe(actor, run_id, after_seq: int) -> AsyncIterator[StoredEvent]`。

- [ ] 写测试：相同幂等键返回相同 Run；不同运行同时启动第二个返回 409；未通过 tools_ok 的配置不能启动 live；修改当前设置不改变运行快照；10 次模型调用后停止；120 秒有效执行超时不包含等待授权时间。
- [ ] 写恢复测试：SSE 重连仅补读已有序号后的事件、无重复工具调用；重启把活跃任务置 interrupted 并使审批失效；取消与重置竞争时新 Attempt 文件不被旧任务写入；同一 Attempt 后续运行保留已完成对话，跨 Attempt 不带记忆。
- [ ] 运行 `uv run pytest tests/test_runs.py tests/test_events.py tests/test_recovery.py -q` 确认失败。
- [ ] 实现单运行锁、Runtime 适配和事件归一化；事件持久化后发布，提供 Last-Event-ID 重连；队列不持久化自动重跑。超时、取消和审批等待使用统一生命周期，终止后释放锁。
- [ ] 实现 reset 先终止原任务再创建全新 Attempt；规则读取必须来自被锁定版本。相同测试通过后提交该任务。

## Task 6：可解释的验收与不可变提交

**Files:** grading.py、submissions.py、exports.py、routes/submissions.py、tests/test_grading.py、tests/test_submissions.py。

**Interfaces:** `SubmissionService.submit(actor, attempt_id, answers: dict) -> SubmissionView`；`evaluate(lesson: LessonDefinition, evidence: AttemptEvidence, snapshot: SnapshotRef, answers: dict) -> list[RuleResult]`；`ExportService.export_attempt(actor, attempt_id) -> ExportRef`。

明确事实验收方式：第 2、3 关设置少量“信息核对”字段，学生根据 Agent 结果填写日期/来源/地点；按模板预置值与真实调用结果检查。自由回答正文只用于查看和提示，不用字符串包含匹配冒充语义评分。这是实现层面的默认选择，学生不需要填写 JSON。

answers 按课时分别校验：关 1 为 question_id、option_id；关 2 为 facts 列表，每项含 task_id、due_date、source_id；关 3 为 course_id、session_date、room；关 4 无额外答案字段，检查正式提交的产物。禁止未知字段，空值返回可定位到对应项目的验证提示。

- [ ] 写四组评分用例：关 1 两个不同指令的真实完成运行＋理解题正确；关 2 指定资料真实读取＋事实核对正确；关 3 指定参数查询成功＋返回信息核对正确；关 4 拒绝未写入＋批准写入＋两项待办的日期和来源正确。
- [ ] 写反例：仅模型声称完成不能通过；demo 事件不能通过；其他 Attempt 的证据不能通过；缺任务、日期错误和来源错误分别返回明确 rule_id；乱序字段不影响结果；自由措辞不触发硬失败。
- [ ] 写快照测试：运行/审批中提交返回 409；提交后修改原文件不改变成绩和证据；旧提交按旧规则读取；导出 ZIP 排除 Key 和个人模型连接信息；损坏或不匹配的 Markdown/JSON 哈希不能通过产物检查。
- [ ] 运行 `uv run pytest tests/test_grading.py tests/test_submissions.py -q` 确认失败。
- [ ] 实现冻结当前 Attempt 证据、产物快照与规则版本；返回每项 passed/required/message/evidence_refs，所有必要项通过才完成。实现两份规范化清单的校验，不调用额外模型裁判。
- [ ] 相同测试通过并提交该任务。

## Task 7：浏览器中的完整教学流程

**Files:** apps/web/package.json、src/app/page.tsx、lessons/[lessonId]/page.tsx、attempts/[attemptId]/page.tsx、settings/page.tsx、api/[...path]/route.ts；components/LessonIntro.tsx、AgentConversation.tsx、ToolTimeline.tsx、ApprovalCard.tsx、WorkspaceFiles.tsx、SubmissionFeedback.tsx、ModelSettings.tsx；lib/api.ts、events.ts；tests/e2e/learning.spec.ts；后端 main.py 和资源 routes。

**Interfaces:** 前端只调用 /api/v1；GET /me 返回本地身份；课程详情含版本导读；其他资源沿用任务 2—6 的服务方法。POST /runs 接收幂等键，GET /runs/{id}/events 为 SSE；GET /submissions/{id} 读取冻结结果。

- [ ] 搭建本地前后端入口，锁定兼容的稳定 Next.js 依赖；前端使用 npm 锁文件，API DTO 从后端 OpenAPI 生成/校验，避免手写两套不一致字段。
- [ ] 先写浏览器闭环用例：无 Key 阅读四关导读；配置模拟连接；开始实验；看工具事件；拒绝/批准；打开产物；提交查看证据；回看介绍保留进度；刷新后继续；重置进入新 Attempt。测试环境有明确模拟标签，成绩显示演示结果而非正式通过。
- [ ] 运行 `npm run test:e2e -- learning.spec.ts` 确认因功能未完成失败；开始前按环境提供的浏览器工具/测试规范配置执行器。
- [ ] 实现课程目录、模型设置和实验工作台；任务与对话为主，文件、过程、导读按需打开，配置仅显示关卡允许项。失败提示解释原因与下一步操作，不直接展示异常堆栈；API Key 输入不自动保存到浏览器持久存储。
- [ ] 实现同源代理的 SSE 流式转发、来源校验、下载与错误处理，未配置 Key 时操作入口提示去配置，导读仍可读。浏览器写请求的 Origin 必须匹配配置的前端地址，Host 必须为配置的回环主机与端口；Next.js 在服务端转发时附加随机的 X-Local-Token，FastAPI 核对该令牌。令牌由启动器为本次进程组生成并仅经私有环境变量传入两个子进程，不使用 NEXT_PUBLIC 前缀、不返回页面、不充当未来用户登录凭据。服务器只绑定回环地址。
- [ ] 补充重连去重、按钮重复点击、历史版本导读、不同 owner 的资源访问、浏览器存储无 Key 的验收。运行 `npm run typecheck`、`npm run build` 和上述 e2e，通过后提交。
- [ ] 用户在本地设置页输入自备 Key 后，执行一条真实链路并记录提供商、模型、SDK 版本及结果。若用户未提供可用连接，其他开发继续，报告真实连接尚未验证，不能用模拟结果替代。

## Task 8：本地启动、交付与整体检查

**Files:** scripts/start.ps1、scripts/stop.ps1、.gitignore、README.md、.env.example、docs/runtime-validation.md、tests/e2e/restart.spec.ts、tests/test_exports.py。

**Interfaces:** `start.ps1 -WebPort 3000 -ApiPort 8000`；`stop.ps1` 只读取本项目的进程记录并验证对应命令行/启动时间后停止。启动记录放 data/runtime，不把 API Key 写到 .env.example 或脚本参数。

- [ ] 增加启动与恢复用例：依赖缺失、端口占用时清晰退出；重复启动不产生两组进程；失败时清理刚启动的子进程；项目路径包含空格/中文可正常工作；启动已有数据库可读进度，未结束运行标记 interrupted，Key 状态为未配置。
- [ ] 实现脚本，以隐藏窗口方式启动后台进程并保留可读日志，检查端口就绪后输出访问地址；不自动关闭占用端口的其他程序。
- [ ] 写 README：项目依赖、启动/停止、申请后在本地输入 Key、四关学习、查看反馈、导出、清除凭据和已知限制。更新验证报告，区分自动测试、浏览器测试和真实模型实测。
- [ ] 运行后端完整测试、前端 typecheck/build、两条 e2e；手动完成从未配置 Key 的导读到实训反馈，再关闭重启验证进度。只在新修改/失败需要时扩大或重复测试。
- [ ] 检查 Git 差异及导出包中无凭据和运行数据，提交交付内容，提供启动入口与验证结果。最终代码整体审阅按用户选定的执行方式进行，不将文档审阅替代代码审阅。

## 双人执行顺序与里程碑

先共同确认接口契约和课程模板。B 执行任务 1 与后端骨架，继而按依赖实现任务 2—6；A 在契约确定后并行完成任务 2 的课程内容、任务 7 的前端和浏览器测试。任务 7 中 FastAPI 路由仍归 B，Next.js 同源转发归 A。任务 8 中启动脚本、后端验证和 CI 归 B，README、浏览器验收及操作说明归 A。按功能逐步联调，不等待后端全部完成才接入前端。

- **里程碑 A（契约与任务 1）**：契约、事件示例、课程 schema 可供两端使用；SDK 工具调用循环及拒绝/取消可用；真实外部模型验证状态单独报告。
- **里程碑 B（第一关闭环）**：前端接入课程、配置、运行和提交接口；完成第一关的导读、练习与反馈。使用模拟模型联调时明确标注，不能算正式通过。
- **里程碑 C（其余三关与任务 8）**：资料读取、查询、授权、产物与规则评分接入；浏览器可操作四关，本地启动，进度可恢复，交付完整验证说明。

## 自查结果

- 设计覆盖：导读与版本归任务 2/7，身份和登录扩展归 2/7，凭据归 3，执行边界归 4，运行与恢复归 5，验收/快照/导出归 6，浏览器交互归 7，Windows 启停与交付归 8。
- 类型一致：AgentRuntime、ModelAccess、RuntimeEvent、StoredEvent、RuleResult 在共用契约定义，跨任务沿用；Approval 与 Workspace 的具体返回 DTO 在所属任务定义。
- 五项 Review Focus 均已映射到具体测试。使用可注入时钟验证超时，不为测试阻塞等待。
- 本计划保留最初的任务设计；应用现已实施。当前已完成与待办见上方执行结果，不将历史未勾选框解释为所有测试尚未执行。

2026-10-23 实现位置更新：原计划的 `runtime/probe.py` 已迁至 `apps/api/tests/runtime_probe.py`，仅用于离线测试；其余原始任务说明保留为历史设计。
