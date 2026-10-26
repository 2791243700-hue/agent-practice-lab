# 前后端接口契约 v0.1.0

更新：2026-10-26。统一实训已通过 [PR #9](https://github.com/2791243700-hue/agent-practice-lab/pull/9) 合并到 main `af36497`，包含第一关 1.1.0 正式复盘、草稿恢复、Tips 和提交弹窗。当前契约 v0.1.0：41 个 HTTP 操作、102 个 schema、11 类 SSE 事件。 本页按合并实现维护；机器可读字段见 OpenAPI，样例用于结构验证，不代表真实模型调用。

## 文件与唯一来源

| 文件 | 用途 |
| --- | --- |
| [openapi.json](openapi.json) | 41 个 HTTP 操作、102 个 schema 的请求、响应、字段约束和操作 ID |
| [events.schema.json](events.schema.json) | 11 类 SSE 事件及每类 payload 的 JSON Schema |
| [lesson.schema.json](lesson.schema.json) | 服务端私有课程 manifest，包括评分规则和参考事实 |
| [types.d.ts](types.d.ts) | 从 OpenAPI 生成的 TypeScript 类型，不手工修改 |
| [examples/http.json](examples/http.json) | 按 schema 标注的请求和响应样例 |
| [examples/events.json](examples/events.json) | 拒绝后批准、过期、取消、重启中断、模型失败、读取和查询等模拟事件序列 |
| [examples/lesson-manifest.json](examples/lesson-manifest.json) | 第四关的课程模板格式示例，非完整课程包 |

OpenAPI 与本说明是现有实现的规范来源，FastAPI 路由与 School 共用同一个 Contracts 对象，按 JSON 契约校验请求和响应，内部 DTO 使用 Pydantic，尚未全量切换为模型导出。事件 schema 是 OpenAPI 的 StoredEvent 及其依赖的独立副本，验证脚本检查两者一致。调整生成方式时须保持既有线上字段和行为，不维护两套各自变化的定义。

HTTP 字段结构以 OpenAPI 为准；跨字段、并发和权限规则以本说明为准。冲突必须修正文档与 schema 后再合并，不由两端各自解释。本次对既有计划的具体化包括：固定 Attempt.mode、演示成绩单独表示、分页历史、版本冲突处理、提交快照下载和全局幂等约定。

## 1. 通用约定

- 浏览器访问同源 `/api/v1`；Next.js 服务端转发到回环地址上的 FastAPI。默认前端 3000、后端 8000，具体端口由启动器配置。
- 浏览器不传 owner_id 或本地令牌；当前服务固定使用 local-owner，并按存储中的归属过滤资源。IdentityProvider/LocalIdentityProvider 仅为预留声明，尚未注入服务、存储或幂等链路；未来接入登录需贯穿这些调用，不能只替换 `/me`。不存在或不属于当前本地身份的 ID 统一 404。
- Next.js 写请求校验 Origin 和 Host，拒绝不匹配或缺失 Origin 的浏览器写请求。代理覆盖客户端提供的 X-Local-Token，使用启动器传入的私有令牌；FastAPI 对所有路由验证令牌。健康检查由启动器带令牌访问。此令牌不进入 NEXT_PUBLIC、页面、浏览器存储或 URL。
- 请求及 JSON 响应采用 UTF-8，业务字段通常使用 snake_case；ReflectionDraftData 为已发布的表单快照，保留 beforeId、nextInstruction 等 camelCase 字段，不能自行转换；成功响应直接返回对象，列表返回 items，分页列表另有 next_cursor。204 没有响应体。
- ID 是不透明字符串，不从其内容推导路径或顺序。时间用带时区的 RFC 3339 字符串，服务端输出 UTC；日期用 YYYY-MM-DD，按课程材料中的日期解释。
- 请求拒绝未知字段；可空字段显式传 null。所有写请求的 Content-Type 为 application/json，有空请求体的操作发送 `{}`；DELETE 通过查询参数携带版本号。
- 所有业务响应使用 Cache-Control: no-store；接口错误不返回堆栈、提供商原始响应、请求头、密钥或本机绝对路径。
- 分页默认 limit=20，上限 100；opaque cursor 不透明且绑定过滤条件，按 created_at 降序、ID 降序稳定排序，不用 offset。next_cursor=null 表示结束；无效/跨过滤条件 cursor 返回 400 CURSOR_INVALID。

### 幂等与版本

创建配置、导入 Key 连接、连接检查、创建/重置实验、启动运行、生成 Tips、提交、导出要求 `Idempotency-Key`，8—128 个字母、数字、下划线或连字符。前端为一次用户操作生成一个键，结果不明确时供手动重试沿用，成功后用户重新操作才换键，不自动重发写操作。

后端按 owner + HTTP 方法 + 路径 + key 持久化成功结果及规范化请求体哈希，去重记录不在首版自动过期。相同 key 和请求返回第一次成功响应及原状态码；请求不同返回 409 IDEMPOTENCY_CONFLICT；相同操作尚未完成返回 409 IDEMPOTENCY_IN_PROGRESS。先查已成功的幂等记录，再检查版本或忙碌状态。失败且未发生业务变更的请求允许原键重试；重置等多步变更必须通过事务和操作锁保证最多创建一次资源。单独设置/清除 credential 不使用该缓存。connect 接收 Key，但幂等记录仅保存请求摘要和非敏感响应，不保存原始请求或 Key；重启后重放历史响应不会恢复内存凭据，需 GET 当前配置再重新输入。前端待确认操作也只缓存请求体 SHA-256 指纹。

Attempt.revision 初始为 1，仅配置/材料变化及 superseded 转换使它递增；运行进度、事件和提交不会使它递增。PATCH 使用完整 settings 和 selected_file_ids，加 expected_revision；禁止修改课程、版本、身份和模式。版本不符返回 409 REVISION_CONFLICT。运行中修改设置只影响下一轮，当前运行用冻结快照。

ModelProfile.revision 初始为 1，非敏感配置或内存凭据变更时递增；检查结果更新不递增。模型/地址/凭据变更及重启清空检查，运行时同时检查当前凭据存在且连接检查通过；实现没有独立的 generation 字段，不能仅看 revision 决定是否可运行。

## 2. HTTP 接口清单

以下路径省略 `/api/v1`。详细必填字段和成功状态码见 OpenAPI。

| 方法与路径 | 请求要点 | 返回/用途 |
| --- | --- | --- |
| GET /health | 无 | status、contract_version |
| GET /me | 无 | local-owner、auth_mode、demo_enabled、并发限制 |
| GET /model-profiles | 无 | 非敏感配置列表 |
| POST /model-profiles | name、provider、base_url、model；幂等键 | 201 ModelProfile，不接收 Key |
| POST /model-profiles/connect | provider_id、api_key，name 可选；兼容服务可填 base_url、model_id；幂等键 | 201 KeyConnectionResult：profile 与 catalog，Key 不回传 |
| GET /model-profiles/{profile_id} | 配置 ID | ModelProfile，不返回 Key |
| GET /model-profiles/{profile_id}/models | 配置 ID，要求内存中有 Key | ModelCatalog：服务商模型列表 |
| PUT /model-profiles/{profile_id} | 完整非敏感配置、expected_revision | ModelProfile；只改名保留检查，改模型/地址/适配类型则失效 |
| DELETE /model-profiles/{profile_id} | 查询 expected_revision | 204，同时清除内存凭据 |
| PUT /model-profiles/{profile_id}/credential | api_key、expected_revision | ModelProfile，只返回配置状态 |
| DELETE /model-profiles/{profile_id}/credential | 查询 expected_revision | ModelProfile，credential_status=missing |
| POST /model-profiles/{profile_id}/check | expected_revision；幂等键 | ModelProfile，含文本/工具检查结果 |
| GET /lessons | 无 | 最新版本列表、正式完成状态 |
| GET /lessons/{lesson_id} | 可选 version | LessonDetail，含导读和公开任务定义 |
| POST /attempts | lesson_id、lesson_version、mode；幂等键 | 201 Attempt，不调用模型 |
| GET /attempts | lesson_id、mode、cursor、limit 可选 | 按创建时间倒序查找实训 |
| GET /attempts/{attempt_id} | 实训 ID | Attempt、进度、活跃运行和最近提交 ID |
| PATCH /attempts/{attempt_id} | expected_revision、settings、selected_file_ids | 更新下一轮配置 |
| POST /attempts/{attempt_id}/reset | expected_revision；幂等键 | 201 新 Attempt，旧记录保留 |
| GET /attempts/{attempt_id}/reflection-draft | 实训 ID | ReflectionDraft；未保存 revision=0、draft=null，不调用模型 |
| PUT /attempts/{attempt_id}/reflection-draft | expected_revision、expected_attempt_revision、draft | ReflectionDraft；自动保存，独立 revision，不修改 Attempt |
| GET /attempts/{attempt_id}/files | 实训 ID | 材料和当前产物列表 |
| GET /attempts/{attempt_id}/files/{file_id} | 文件 ID | FilePreview，最多 20000 字符 |
| GET /attempts/{attempt_id}/files/{file_id}/download | 文件 ID | 完整附件下载 |
| POST /runs | attempt_id、expected_attempt_revision、profile_id、input_text；幂等键 | 202 Run |
| GET /attempts/{attempt_id}/runs | cursor、limit 可选 | 运行历史 |
| GET /runs/{run_id} | 运行 ID | 状态、脱敏快照、用量、pending_approval |
| GET /runs/{run_id}/tips | 运行 ID | 已保存的 Tips 或 null，不调用模型 |
| POST /runs/{run_id}/tips | profile_id、expected_profile_revision、幂等键 | 终态运行的模型学习建议；缓存后直接复用 |
| POST /runs/{run_id}/cancel | `{}` | 202 当前 Run，等待终态确认取消完成 |
| GET /runs/{run_id}/event-history | after_seq=0、limit=100，上限 500 | 持久化事件分页 |
| GET /runs/{run_id}/events | after_seq 或 Last-Event-ID | SSE 重放与订阅 |
| GET /approvals/{approval_id} | 授权 ID | Approval |
| POST /approvals/{approval_id}/decision | decision=approve/deny | Approval，不代表工具已写入 |
| POST /submissions | attempt_id、expected_attempt_revision、answers；幂等键 | 201 冻结评分及证据目录 |
| GET /attempts/{attempt_id}/submissions | cursor、limit 可选 | 提交历史 |
| GET /submissions/{submission_id} | 提交 ID | 不可变 Submission |
| GET /submissions/{submission_id}/files/{file_id}/download | 提交中的文件 ID | 不可变快照附件 |
| POST /attempts/{attempt_id}/exports | expected_revision；幂等键 | 201 已冻结 ZIP 的 Export 元数据 |
| GET /exports/{export_id} | 导出 ID | 元数据 |
| GET /exports/{export_id}/download | 导出 ID | application/zip 附件 |

不提供注册、登录、教师管理、任意工具执行或文件上传的占位接口。首版材料由课程包提供，学生选择使用，不从浏览器上传任意本机文件。

## 3. 模型配置与连接检查

ModelProfile.provider 仍固定为 openai-compatible，表示 Chat Completions 适配协议；新增导入请求的 provider_id 表示所选服务商，两者不可混用。base_url 是 API 根地址，后端追加 /models 或 /chat/completions；若兼容服务要求 /v1，须包含在根地址中。禁止 userinfo、query、fragment；仅允许 HTTPS，回环服务可用 HTTP。认证凭据只从专用 Key 字段进入后端内存。

### Key 导入与模型目录

`POST /model-profiles/connect` 的 KeyConnectionCreate 要求 provider_id、api_key（writeOnly），name 可选。provider_id 为 deepseek、openai 或 openai-compatible。DeepSeek 固定 `https://api.deepseek.com`，OpenAI 固定 `https://api.openai.com/v1`；官方选项拒绝同时提供 base_url 或 model_id。兼容接口必须提供合法 base_url，可显式传 model_id 进入手动模式。

普通导入先用 Key 对选定地址请求 GET /models，成功后才事务创建 profile 并存内存凭据，默认选按 ID 排序后的首个模型；失败不创建残留配置。手动模式不获取目录，不能据此认定认证或模型有效。返回 KeyConnectionResult 包含 profile、catalog；catalog.items 为 `{id, name?}`，source 为 provider 或 manual。名称留空时自动生成；Key 不回传。

`GET /model-profiles/{profile_id}/models` 使用该配置当前内存 Key 重新获取目录，返回 source=provider；缺 Key 返回 CREDENTIAL_MISSING。目录不持久化为访问权限证明，不修改已选模型或兼容检查。最多返回 1000 个去重排序模型，过滤空/无效 ID，模型 ID 最长 200 字符；name 可选并截断至 200 字符，凭据回显被过滤或遮盖。拒绝重定向、非预期状态/结构、空目录及超过 2,000,000 字节的响应；请求默认超时 10 秒，不透传服务商原始错误体。

前端按格式提供服务商建议；`sk-proj-`、`sk-svcacct-` 可建议 OpenAI，其他无法区分时要求选择。格式建议不等于验证，不在输入时发请求，不逐家尝试同一个 Key。GET /models 不发起模型生成；获取列表不等于所选模型支持文本、Chat Completions 或工具，仍需主动检查。兼容服务未提供列表时可显式手动填写模型，不能静默伪造可用列表。

配置被活跃 Run、连接检查或该配置模型目录请求占用时，修改、删除和清除 Key 返回 409 PROFILE_BUSY。目录、连接检查与 Run 共用一个全局执行槽，不能并发；忙碌返回 409 RUN_BUSY。检查页面先提示会消耗额度，不在输入变化时自动推理。检查最长 30 秒、最多三次推理请求，取消运行接口不用于取消配置检查。

检查执行结束返回 200 ModelProfile，即使认证、文本或工具不通过也通过 connection_check.status=failed 和 error_code 表达。不存在、缺 Key、版本冲突等尚未发起检查的错误使用 HTTP 错误。通过条件为 text_ok=true 且 tools_ok=true，status=passed；失败或 unchecked 不能启动真实 Run。

提交 Key 后前端清空输入状态，禁止持久化。模型、地址、适配类型、Key 变更及后端重启使检查变为 unchecked；只重命名保留检查结果。用旧幂等键重放的结果可能是历史状态，前端之后 GET 配置获取当前状态；后端启动 Run 必须验证当前配置检查与内存凭据状态。多个 profile 独立持有内存凭据；清除 credential 保留非敏感配置，删除 profile 同时清其凭据，不影响其他配置或历史学习记录。重启后配置仍在，credential_status=missing，需重新输入。

官方 DeepSeek 的连接检查和运行共用 provider options 关闭 thinking，以兼容强制工具选择；该参数仅匹配官方主机，不对任意兼容地址套用。

## 4. 课程、实验与文件

- LessonDetail 只返回公开导读、任务、规则说明、允许的设置/工具以及作答表单，不能返回正确选项、参考事实或私有 rules。课程包虽在源码中可查看，界面仍不直接泄露答案；本地实训不是防作弊考试系统。
- GET lesson 不传 version 取最新版；继续已有 Attempt 必须传其 lesson_version。创建实训显式传版本；所有课件和材料按版本存档。version 保持 1—40 字符：最新版按点分段排序，十进制数字段按数值、文本段按字典顺序，同位置数字高于文本，完全等价的分段按原字符串打破平局。它不是完整 SemVer 比较器；例如 1.0.0 高于 1.0.beta，混合文本不会使课程列表失败。
- 固定 lesson_id：01-task、02-context、03-tools、04-permission。后续课程目录也使用这些 ID；修正原计划中的 02/03 目录命名，使 API 与课程包一致。
- Attempt.mode 在创建时固定为 live 或 demo，后续不可修改。demo 仅在 /me.capabilities.demo_enabled=true 时可建，否则 403 DEMO_DISABLED。Run 模式从 Attempt 派生，前端不能直接指定。
- 同一 Attempt 的多轮 Run 沿用已完成对话及产物；不同 Attempt 隔离。profile_id 在 live 启动时必须非 null，在 demo 时必须为 null，否则 422 MODE_MISMATCH。
- 材料 ID 是该课程版本稳定的逻辑 ID，复制到不同 Attempt 后用相同逻辑 ID，但读取始终检查 Attempt 归属。selected_file_ids 只能包含本实验预置材料。空列表合法，工具读取只限被选材料。第一关（01-task 且 allowed_tools 为空）的固定通知直接从该实验归档课程材料提供给模型，不依赖 selected_file_ids，不伪造工具读取事件；其他关卡不会自动注入文件正文。浏览器材料预览不代表 Agent 已读取。
- 产物 file_id 绑定不可变文件版本；每次保存分配新 ID，当前文件列表只显示最新一组。旧 file_id 在原实验内仍可读取，提交下载绑定提交快照，不能跳转到最新文件。
- Settings 当前只包含 system_instruction（最多 2000 字符，可为空）和 temperature（0—1）。学生仅能修改 settings_policy.editable_fields 列出的字段，其余必须与原值相同，否则 422 VALIDATION_ERROR。后端应用模型参数兼容性检查，不静默忽略不支持参数。
- 重置继承旧 lesson_version 和 mode，恢复课程默认设置/材料选择，清空运行对话和产物；旧 Attempt 转为 superseded，旧记录仍可读和导出，不能再启动运行、修改或提交（409 ATTEMPT_SUPERSEDED）。默认 selected_file_ids 为空。
- 重置先取消旧运行并等到终态，再创建新 Attempt。最多等待 10 秒，未结束返回 503 ATTEMPT_BUSY，不创建新实验。重试原幂等键，禁止绕过仍在取消的任务。
- 文件只接受 ID，不接收路径。只读预览最多 20000 字符，截断标记必须显示；下载读完整内容。工具和文件最大 1 MiB，保存内容同样受限。所有下载 attachment，文件名由服务端产生并安全编码。

## 5. 运行、SSE 与恢复

Run 状态流转：queued → running ↔ awaiting_approval → completed/failed/cancelled/interrupted。queued 也可进入 failed/cancelled/interrupted。终态不能重新激活；全局最多一个非终态 Run，queued 仅表示已接收、等待立即调度，不是持久任务队列。

POST /runs 成功后立即返回 202，即使已开始运行也如此。同一个键返回原 Run，不再调用模型。终态前另起 Run 返回 409 RUN_BUSY。每轮最多 10 次模型请求、120 秒有效执行时间，不包含授权等待；600 秒授权等待超时后失败。模型未返回 token 用量时用 null，不能当作 0。

### SSE 事件字段

每个事件都包含 schema_version、run_id、attempt_id、seq、mode、kind、created_at、payload。seq 从 1 开始、在一个 Run 内严格递增且连续，先持久化再发布。

| kind | payload 的核心字段 |
| --- | --- |
| run.started | status=running |
| message.delta | message_id、delta |
| message.completed | message_id、role=assistant、完整 content |
| tool.requested | call：id、name、arguments；四种工具参数分别校验 |
| approval.requested | approval 完整对象，status=pending |
| approval.decided | approval 完整对象，approved/denied/expired/cancelled |
| tool.completed | result：call_id、name、status、具体类型的 data |
| run.completed | status=completed、usage |
| run.failed | status=failed、统一 error、usage |
| run.cancelled | status=cancelled、reason=user/reset、usage |
| run.interrupted | status=interrupted、reason=process_restart、usage |

线上的 SSE 帧格式：

```text
id: 1
event: run.started
data: {"schema_version":"0.1.0","run_id":"run-example","attempt_id":"attempt-example","seq":1,"mode":"demo","kind":"run.started","created_at":"2026-10-17T08:00:00Z","payload":{"status":"running"}}

```

- UTF-8、Content-Type: text/event-stream；禁止代理缓冲；每 15 秒可发 `: heartbeat` 注释，心跳不计 seq、不持久化。换行留空行结束帧。
- 没有游标时从 0 重放。非空 Last-Event-ID 优先于 after_seq；只接受非负十进制整数。不合法或大于 last_seq 的游标返回 400 CURSOR_INVALID，不能静默跳过事件。
- 服务端原子衔接历史重放与订阅，不能在两者之间漏事件。断线重发允许重复投递，前端按 run_id+seq 去重。
- message.completed 是该消息最终完整文本，用它替换 delta 累积内容，不能追加导致重复。未完成的增量可显示为中断内容，不能当作已完成答案。
- 每个 Run 只产生一个终态事件。终态发生前，未决授权先失效并发 approval.decided。完成后关闭流；客户端收到终态主动 close。终态且请求游标已读完时返回 204，阻止自动重连。
- 终态请求若仍有未读事件，则重放剩余事件后关闭。事件缺失说明服务端数据错误，不伪造事件补齐。
- POST cancel 是“已接收取消请求”，不等于已停止；前端读取 GET Run 或等待终态。对终态取消仍返回 202 原终态，不制造第二个终态事件。运行锁直到真正结束才释放。
- 重启时使所有非终态 Run 进入 interrupted，所有 pending Approval 进入 cancelled；写入恢复事件。不得自动重发模型请求或重放写入。

刷新恢复顺序：GET Attempt → 获取固定版本 Lesson → 分页取 Runs → 为历史 Run 读取 event-history → 根据 pending_approval 恢复授权卡片 → 对活跃 Run 从已读取 seq 继续 SSE。event-history 的 next_after_seq 是本页末尾序号，空页沿用输入；has_more 按响应时的 last_seq 计算。历史读到尾后仍需订阅 SSE，以补上期间新增事件。

## 6. 工具与授权

| 工具 | 参数 | 成功返回 |
| --- | --- | --- |
| list_materials | `{}` | 当前选中且允许读取的 materials |
| read_material | file_id | source_id、content、truncated |
| lookup_course | course_id | course_id、session_date、room |
| save_todos | items：task_id、title、due_date、source_id | 一组 Markdown + JSON 的 FileInfo |

工具名、参数和结果都有结构定义；不提供浏览器直接调用工具的端点，执行必须经过 Agent 的工具网关。返回结果必须与原 call_id、name 对应；一个调用最多执行一次。lookup_course 的 source_id 不混入材料来源；TodoItem.source_id 必须是指定课程材料来源。

只有 save_todos 需要批准。审批对象的 call_id 对应 ToolCall.id，arguments 是不可变参数快照。批准之后仍要检查运行存活、材料和课程工具权限。API 返回 approved 仅表示决定已记录，工具保存成功以 tool.completed.status=ok 和产物为准。

同一决定重复提交返回原 Approval；已决定后改成相反决定返回 409 APPROVAL_ALREADY_DECIDED。expired 返回 409 APPROVAL_EXPIRED，cancelled 返回 409 APPROVAL_INVALIDATED。到 expires_at 即失效，即使后台清理尚未运行也不得执行。

拒绝产生 status=denied 的工具结果，Agent 可继续回答或重新提出请求；新调用必须有新的 call_id 和 approval_id。拒绝不能写文件。过期或取消时不继续执行工具；授权过期产生 run.failed，code=APPROVAL_EXPIRED。

批准、取消和写入通过同一运行锁/执行门控制。取消阻止后续操作，但已经原子提交的文件不能假装撤回；写入若先发生，保留事件和产物。重置必须等待该运行终止。保存 Markdown 和 JSON 作为一组原子发布，不能只成功一半。

## 7. 提交、评分和证据

POST /submissions 只接收 attempt_id、expected_attempt_revision 和 answers（课程版本由 Attempt 推导），客户端不能传分数、通过状态、工具执行记录或 Submission.evidence；ReflectionAnswers.evidence 是待服务端核验的消息引用，不是客户端生成的评分证据。运行/授权/重置未结束时返回 409 ATTEMPT_BUSY，冻结证据与新运行启动共用实验锁。先校验本关答案结构及选项，再创建本次快照；复制中途、评分或记录写入失败时清理本次未发布快照，不清理已有提交目录。

| 关卡 | answers | 后端必要检查 |
| --- | --- | --- |
| 01-task / 1.1.0 | ReflectionAnswers，kind=reflection | 两轮完成及顺序、新增要求、消息原文及码点偏移、版本化变式判断 |
| 01-task / 1.0.0 | question_id、option_id | 保留旧 choice：同一 Attempt 两次不同指令的完成运行，理解题正确 |
| 02-context | facts 列表，每项 task_id、due_date、source_id | 指定资料实际成功读取，必要事实与来源准确 |
| 03-tools | course_id、session_date、room | 目标课程参数查询成功，信息核对准确 |
| 04-permission | `{}` | 拒绝未写入，后续批准写入，清单日期/来源与两项任务正确 |

第四关的有效拒绝必须发生在关联当前产物的成功保存请求之前；先批准后拒绝不能通过。跨 Run 按当前 SQLite 存储的事件追加顺序判断，不比较不同 Run 的局部 seq，也不依赖时间戳唯一；内部顺序不作为额外 API 字段暴露。已冻结的旧提交不重新评分。

各关仅接受该关的答案结构，不能利用 Answers 联合类型提交其他关格式。未知字段、缺字段、重复 task_id 或非法选项 ID 返回 422 VALIDATION_ERROR；合法但答错的值返回 201 Submission，规则 passed=false，而不是 HTTP 错误。

每条规则给出 rule_id、passed、required、message、evidence_refs。必要规则全部满足时 evaluation_passed=true。**passed = (mode == live) AND evaluation_passed**；demo 可以显示“演示检查通过”，但 passed 永远 false，Attempt.progress 不能成为 completed。正式完成状态按同一 lesson_id+lesson_version 的真实通过提交汇总，课程升级后不会自动继承新版完成。

真实成绩只允许同一 Attempt 的真实运行证据；第一关的两次运行必须 completed 且指令去掉首尾空白后不同。规则检查真实读取/查询结果、授权状态及冻结产物，不用 Agent 自述替代执行证据，不以中文字符串完全匹配评分。规则必需项全部通过后，Attempt.progress 保持 completed；后续失败提交不撤回已获得完成状态，但 latest_submission_id 仍更新。

evidence_refs 是本次 Submission.evidence 中的 ID：event 引用已持久化且不可变的 run_id+event_seq；file 引用提交快照的 FileInfo；answer 保存作答；inspection 保存拒绝前后/产物一致性检查。所有引用必须可解析且归属本实训，引用事件和文件禁止原地修改。缺证据时返回规则不通过，不能伪造引用。

导入和程序内发布都校验课程 manifest、非空导读、至少一条必需规则，以及 evaluator 与答案表单/题目选项/事实来源/课程的匹配；无效配置拒绝发布。Markdown 与 JSON 都校验快照哈希和事实；产物顺序/自然表达不作硬失败条件。文件内容被修改后必须重新提交生成新 Submission；旧成绩、规则版本和证据不变。

导出在实训无活跃 Run 时生成冻结 ZIP（否则 409 ATTEMPT_BUSY），包含课件版本、导读、学习记录、提交和产物；learning.json 的 reflection_draft 保存导出时的 ReflectionDraft 对象（未保存时 draft=null），submissions 包含冻结的 answers/evidence；排除所有模型连接配置、凭据和私有运行令牌。返回 ready 的 Export 后再 GET 下载，不构造可访问任意路径的 URL。

## 8. 统一错误

```json
{"error":{"code":"RUN_BUSY","message":"已有任务正在运行，请等待或先停止。","request_id":"request-example","retryable":true,"fields":[]}}
```

| HTTP 状态 | code |
| --- | --- |
| 400 | CURSOR_INVALID |
| 401 | LOCAL_TOKEN_INVALID（代理/启动配置故障，不提示学生登录）、MODEL_AUTH_FAILED（模型目录或 Tips 的认证失败） |
| 403 | ORIGIN_REJECTED、DEMO_DISABLED |
| 404 | NOT_FOUND |
| 409 | PROFILE_BUSY、RUN_BUSY、ATTEMPT_BUSY、ATTEMPT_SUPERSEDED、REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、IDEMPOTENCY_IN_PROGRESS、APPROVAL_ALREADY_DECIDED、APPROVAL_EXPIRED、APPROVAL_INVALIDATED、TIPS_UNCERTAIN |
| 422 | VALIDATION_ERROR、CREDENTIAL_MISSING、MODEL_NOT_READY、MODE_MISMATCH、MODEL_CATALOG_UNSUPPORTED、MODEL_CATALOG_INVALID、TIPS_INVALID |
| 413 | LIMIT_EXCEEDED（请求体超过服务端限制） |
| 500 | INTERNAL_ERROR |
| 503 | ATTEMPT_BUSY（重置等待未结束）、MODEL_UNAVAILABLE（操作尚未接受） |
| 504 | MODEL_TIMEOUT（模型目录或 Tips 请求超时） |

MODEL_AUTH_FAILED、MODEL_TIMEOUT、MODEL_INCOMPATIBLE、MODEL_UNAVAILABLE 可用于 connection_check 或 Run.error；模型目录操作的认证/超时/网络错误直接返回相应 HTTP 错误。目录的上游 404/405/501 映射 MODEL_CATALOG_UNSUPPORTED，429/5xx 映射 MODEL_UNAVAILABLE，重定向或无效/空目录映射 MODEL_CATALOG_INVALID。RUN_TIMEOUT、TOOL_ERROR、EXECUTION_FAILED、LIMIT_EXCEEDED、APPROVAL_EXPIRED 可用于运行失败。SSE 建立前失败返回标准 HTTP 错误；建立后运行故障发 run.failed，不能往事件流中插入普通 JSON 响应。传输断开由客户端按游标重连。

fields.path 使用 JSON Pointer，如 /answers/facts/0/due_date。retryable 表示满足条件后可以重试，不意味着前端自动循环重试或自动再次调用模型。错误文案供用户阅读，前端逻辑只依赖 code。

## 9. 开发交接与验证

前端 A：从 types.d.ts 使用组件类型与 operations，按 examples 编写模拟适配；完成导读、配置、运行、授权、文件、答案表单和反馈页面。界面只显示服务端允许的配置，不自行评分。

后端 B：实现 Pydantic/路由与全局运行锁、事务及各业务规则；运行事件、四种工具和评分证据对齐 schema。内部 AgentRuntime、CredentialStore 等接口继续遵循实施计划，不把它们全部暴露为 HTTP。

当前契约通过 231 项结构检查，合并前通过 193 项后端、18 项前端单元及 52 项浏览器测试；main `af36497` 的前端、后端与契约 CI 均通过。动态行为由后端及浏览器测试覆盖；外部实测和限制见[真实模型记录](../docs/live-model-validation.md)。结构验证命令：

```powershell
cd contracts
npm ci
npm run validate
npm run types
git diff --exit-code -- types.d.ts
```

validate 检查 OpenAPI、所有 JSON Schema、样例、事件副本一致性、端点参数、引用和代表性非法输入。动态竞态/权限/恢复由后端与浏览器测试验证，不能用 schema 校验代替。生成类型提交前需与 OpenAPI 同步；未提交的预期生成差异应审阅，不直接丢弃。

AnswerForm、ToolCall、Evidence 和 StoredEvent 的 discriminator.mapping 显式关联实际 kind/name 常量与对应 schema，不能省略映射后让生成器推断 schema 名作为字段值。独立事件/课程 schema 同步这些映射，前端直接引用生成类型；新增联合成员须通过映射一致性和生成类型回归。该修复见[接口更新](../docs/interface-update-2026-10-26.md)。

字段、状态、事件名和语义变更必须同步说明、样例、生成类型并评估版本，同一个 PR 由双方审阅；Key 导入/模型目录、Tips 及复盘草稿均为增量补充，health.contract_version 仍为 0.1.0；第一关课件版本独立升级为 1.1.0。实现中遇到新需要先改契约，再改消费方；不得静默更名或用旧客户端假定所有未来字段兼容。

格式依据：[OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) 用于 HTTP 定义；SSE 的帧、id 和 Last-Event-ID 遵循 [WHATWG Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)。

## 10. 按需模型 Tips

- GET `/runs/{run_id}/tips`：返回 `{tips: null}` 或已保存的 RunTips，不请求服务商。
- POST 同路径：必需 Idempotency-Key，body 为 `{profile_id, expected_profile_revision}`；返回 200 RunTips。仅终态运行可生成；配置须已检查且有内存 Key。当前选择的配置可不同于原运行配置。
- 一次无工具的 Chat Completions 请求，45 秒总超时，无自动重试或跳转；输入最多约 60000 字符，HTTP 响应最多 256000 字节。范围为同实训截至指定运行的公开课程目标和真实事件，截断会标记 context_truncated；不发送私有评分参数或 Key 字段。
- 按 run_id 唯一保存、校验并脱敏；缓存优先于配置检查，删除配置/重启后仍可读。不同幂等键并发也受全局执行槽保护，不会重复请求。生成期间配置不可变更。
- TIPS_INVALID / 422：服务商未返回约定 JSON，未保存，可手动重试。MODEL_AUTH_FAILED / 401、MODEL_TIMEOUT / 504、MODEL_UNAVAILABLE / 503 为净化错误。重试可能再次产生费用。
- TIPS_UNCERTAIN / 409：持久待处理标记因进程中断未结束，为避免重复扣费不自动再次生成；已有成功结果始终可读。
- Tips 是模型建议，不参与正式验收，不修改运行、授权、提交或历史。其用量在 RunTips.usage 单列，不计入执行运行的 Usage；不代表账户完整账单。

2026-10-23 补充：Tips 界面不显示单独的依据段落。新生成仅要求 assessment、gaps、next_steps；为兼容既有 RunTips 响应，evidence 字段保留，新结果固定为空数组。服务商额外返回的依据会丢弃，旧缓存仍可读但不显示该部分。

内部整理不删除对外兼容接口或旧数据字段。路由与分发操作的一致性由 `apps/api/tests/test_contract_wiring.py` 验证；TypeScript 类型仍由 `npm run types` 生成。当前核对结果见[清理记录](../docs/cleanup-2026-10-23.md)。

## 11. 第一关新版复盘

第一关 1.1.0 的 answer_form.kind=reflection，包含公开 challenge 的 id/title/notice/items；正确判断只存在课程私有 rules 中。旧版 1.0.0 仍可通过原 choice 字段提交，成绩不重算。当前功能已合并 main，完整范围见[统一交付](../docs/unified-practice-delivery.md)。

POST /submissions 的 answers 新增 ReflectionAnswers：kind=reflection；baseline_run_id/revised_run_id；change.category=goal|constraint|output 和 quote；evidence.before/after 分别含 message_id、event_seq、quote、start_offset；judgment=satisfied|partial|unsatisfied；explanation、next_instruction；challenge.challenge_id、judgments[item_id,decision=known|confirm] 和 instruction。完整必填与长度以 OpenAPI 为准。start_offset 为原始正文 Unicode 码点偏移，换行、空格和重复句均按原文核对，不按 HTML 或 UTF-16 单元计算。

后端先检查运行归属、指定消息/事件和变式 ID；不合法引用返回 422。随后按课程规则核对完成状态及持久创建顺序、改动引用、原文偏移和变式答案；结构合法但不满足规则时返回 201 Submission，逐项标记不通过。引用真实不等于自由解释质量已判定，explanation 和 challenge.instruction 必须含非空白内容（最多 6000 字符），这是输入完整性约束，不按字数、关键词或模型评价对解释质量评分。partial/unsatisfied 允许通过，须写后续指令。演示不计正式完成。

GET /attempts/{attempt_id}/reflection-draft 未保存时返回 revision=0、draft=null、updated_at=null。PUT 携当前草稿 expected_revision 及 expected_attempt_revision，成功只使草稿 revision+1。所有草稿字段允许未完成值，但固定字段、长度和数量有上限；私有 Key 经现有 HTTP 边界脱敏。仅 active reflection 实验可写，历史草稿可读。冲突返回 409 REVISION_CONFLICT，前端保留当前编辑内容并让学生主动处理，不自动覆盖。该 PUT 不要求 Idempotency-Key；响应丢失后先 GET，不能盲目重试写入。

正式提交冻结答案、规则和引用，草稿的后续修改不改变历史结果。ZIP 中包含草稿以及不可变提交，课程与引用均绑定原版本，排除凭据、连接参数和内部令牌。


### 草稿字段与提交映射

GET /attempts/{attempt_id}/reflection-draft 对归属正确的实验均可读取；没有记录时返回空草稿，包括旧版或其他关卡。PUT 仅允许 active 且 answer_form.kind=reflection 的实验。草稿是完整替换而不是 PATCH；下列字段全部必填，不能直接把 draft 作为正式 answers 提交。

| ReflectionDraftData 字段 | 类型与未完成值 | 正式 ReflectionAnswers 映射 |
| --- | --- | --- |
| step | 整数 0—3 | 仅界面进度，不提交 |
| beforeId / afterId | 字符串，可空 | baseline_run_id / revised_run_id |
| beforeMessageId / afterMessageId | 字符串，可空 | evidence.before/after.message_id |
| beforeEventSeq / afterEventSeq | 非负整数，初始 0 | evidence.before/after.event_seq，正式值至少 1 |
| beforeStartOffset / afterStartOffset | 非负整数，初始 0 | evidence.before/after.start_offset |
| changeKind / requirement | 字符串，可空 | change.category / change.quote；正式 category 为 goal/constraint/output |
| beforeQuote / afterQuote | 字符串，可空 | evidence.before/after.quote |
| judgment / explanation / nextInstruction | 字符串，可空 | judgment / explanation / next_instruction |
| facts | 对象，初始 {} | challenge.judgments 转为 item_id/decision 数组 |
| instruction | 字符串，可空 | challenge.instruction；challenge_id 取固定版本的公开表单 |

草稿文本每项最多 6000 字符；facts 最多 20 项、值最多 40 字符，键须属于本课变式。整数上限 2147483647。非空运行 ID 须属于同一实验同一模式，已选完整消息须存在；保存草稿不检查是否已完成正式评分条件，也不代表通过。

加载顺序：GET Attempt → 按 lesson_version 取课件 → GET reflection-draft。首次保存 expected_revision=0；之后用上次成功响应 revision。expected_attempt_revision 始终来自当前 Attempt；保存草稿只递增草稿 revision。任一版本不匹配均返回 409 REVISION_CONFLICT，需同时重读实验和草稿并让用户处理差异。重置后的旧实验写入返回 409 ATTEMPT_SUPERSEDED，新实验草稿从 0 开始。非复盘实验写入、草稿引用/字段不合法返回 422 VALIDATION_ERROR；不存在的资源返回 404 NOT_FOUND。

PUT 不使用 Idempotency-Key，不进入创建类请求缓存；响应丢失先 GET 核对保存状态，不能自动重放。前端先加载再以 500ms 防抖串行保存，失败或冲突停止队列，保留编辑内容并提供下载/重读入口。正式提交以点击时的表单构造 answers，不由服务端自动把草稿转换为提交。

### 原文引用与恢复

ReflectionCitation.start_offset 是 message.completed.payload.content 中从 0 开始的 Unicode 码点位置。不要使用渲染后的 Markdown、trim 后正文或 JavaScript UTF-16 长度定位；可用 Array.from(rawText) 处理码点。重复引用必须保留所选出现位置。before/after 的运行 ID 由 baseline_run_id/revised_run_id 指定，消息和事件必须与对应运行一致。

先后顺序由服务端持久创建顺序核验，不用分页排序、ID 字典序或跨运行的 event_seq 推断。新增要求 quote 必须逐字存在于第二轮 input_text，且不在第一轮 input_text 中；两个运行必须 completed 并有完整非空回答和完成事件。

### Tips 与复盘的关联

新生成 Tips 可包含目标改进轮对应的已保存草稿（afterId 等于目标运行，beforeId 在上下文中）、公开变式及符合范围的已提交复盘答案。草稿最多占 16000 字符，整体上下文受 60000 字符限制；裁掉基准运行时也移除草稿。不会发送私有评分答案；模型点评不改变 Submission.passed。

Tips 缓存保留生成时快照：后续编辑草稿或再次提交不自动刷新缓存，也不自动计费。GET 返回 {tips: null} 或 {tips: RunTips}；POST 成功直接返回 RunTips，客户端应区分两个响应结构。

可校验答案/响应样例见 [examples/http.json](examples/http.json) 中 reflection-answer 和 empty-reflection-draft；示例 ID 和 challenge_id 必须替换成实际实验、事件及固定版本表单中的 ID，结构合法不等于实际验收通过。

首次保存未完成草稿的 PUT 请求示例（两个 revision 必须取当前 GET 结果）：

```json
{
  "expected_revision": 0,
  "expected_attempt_revision": 1,
  "draft": {
    "step": 0,
    "beforeId": "",
    "afterId": "",
    "beforeMessageId": "",
    "afterMessageId": "",
    "beforeEventSeq": 0,
    "afterEventSeq": 0,
    "beforeStartOffset": 0,
    "afterStartOffset": 0,
    "changeKind": "",
    "requirement": "",
    "beforeQuote": "",
    "afterQuote": "",
    "judgment": "",
    "explanation": "",
    "nextInstruction": "",
    "facts": {},
    "instruction": ""
  }
}
```

成功响应为 200 ReflectionDraft，其中 attempt_id 是路径中的实验 ID，revision=1，draft 为已保存快照，updated_at 为服务端时间。重复发送这个旧请求会产生版本冲突，不会自动成为幂等重放。
