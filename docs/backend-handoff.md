# Agent Practice Lab：前端向后端开发者交接

交接日期：2026-10-18。接收对象：负责 `apps/api/`、`contracts/`、评分与启动器的开发者。

## 1. 当前交付状态

四关浏览器学习流程已接入现有后端，包含课程列表、版本化导读、模型配置、对话与工具过程、保存审批、产物、提交反馈、历史与学习记录导出。前端位于 `apps/web/`，浏览器用例位于 `tests/e2e/`。

| 项目 | 当前状态与入口 |
| --- | --- |
| 前端 PR | [#3：四关实训与可恢复浏览器学习流程](https://github.com/2791243700-hue/agent-practice-lab/pull/3)，开放待审阅，基分支 `feat/backend` |
| 前端分支 | `feat/web-learning-experience` |
| 对接后端基线 | `d908e012e1b56e417c4cd5a02bd2b449f4aa565d` |
| 已验证代码提交 | `dcad9750b435355b68eff5cca6a912297a857e88`；本交接文档后续提交仅更新文档 |
| 契约 | v0.1.0；字段结构遵循 `contracts/openapi.json`，前端复用 `contracts/types.d.ts` |
| 已确认的后端改动 | 一个 SDK 文本结束事件适配修复，用户已明确同意，保留独立提交，见第 4 节 |
| 未改动 | JSON 接口契约、课程内容/版本、评分规则、数据库迁移及原启动脚本 |
| 产品范围 | 本地单用户、学生自备 Key；身份通过 `/me` 预留扩展，登录与线上部署暂未实现 |

完整实现和验证记录见[前端验证报告](frontend-validation.md)，截图在 [screenshots/](screenshots/)，学生操作步骤见[新手说明](user-guide.md)。

## 2. 接收代码与合并顺序

当前依赖链为：

```text
PR #1 feat/api-contract-v1 → main
  └─ PR #2 feat/backend → feat/api-contract-v1
       └─ PR #3 feat/web-learning-experience → feat/backend
```

建议由维护者先合并 [#1](https://github.com/2791243700-hue/agent-practice-lab/pull/1)，将 [#2](https://github.com/2791243700-hue/agent-practice-lab/pull/2) 的基分支调整到 main，完成后端合并后，再同步前端分支并将 #3 调整到 main。每次调整后重新检查差异和 CI，确认前端 PR 未重复包含已经合并的后端实现。若依赖 PR 使用 squash/rebase 合并，应按新历史整理分支后再核对差异。

现在即可检出完整联调版本：

```powershell
git fetch origin
git switch --track origin/feat/web-learning-experience
# 若该本地分支已存在，改用 git switch feat/web-learning-experience
```

前端 PR 中的独立修复提交为 [`c705174`](https://github.com/2791243700-hue/agent-practice-lab/commit/c705174)。如果后端分支先单独接收这个提交，请同步告知前端维护者，在后续合并时核对修复与测试均保留，避免重复处理或覆盖。

## 3. 本地启动与联调入口

需要 Node.js 22+、Python 3.11/3.12 和 uv。在仓库根目录运行：

```powershell
uv sync --project apps/api --locked
npm --prefix apps/web ci
.\scripts\start.ps1
# 浏览器：http://127.0.0.1:3000
# 停止：.\scripts\stop.ps1
```

`scripts/start.ps1 -Demo` 开启无 Key 演示。默认模式用于学生自备 Key 的正式实训。可用 `-WebPort`、`-ApiPort` 和 `-DataDir` 配置独立实例；启动和停止须使用同一数据目录。

启动器已能同时启动 Next.js 与 API，并通过进程环境传递同一个私有令牌。学生从启动器显示的前端地址访问；默认地址中的 `127.0.0.1` 与 `localhost` 不能随意替换，否则来源检查会失败。直接打开 API 的 8000 端口会遇到内部令牌校验。

### 服务端环境变量

| 变量 | 默认/用途 | 后端维护注意点 |
| --- | --- | --- |
| `AGENT_SCHOOL_API_ORIGIN` | `http://127.0.0.1:8000`，Next.js 上游 | 代理限定回环地址，不支持改成任意远程 API |
| `AGENT_SCHOOL_FRONTEND_ORIGIN` | `http://127.0.0.1:3000` | 与实际前端 Host、浏览器写请求 Origin 一致 |
| `AGENT_SCHOOL_LOCAL_TOKEN` | 启动器生成并传给前后端 | 仅服务端使用，不加入 `NEXT_PUBLIC_`、URL、页面或日志 |
| `AGENT_SCHOOL_DATA` | 本地数据目录 | 数据库、产物和日志保持在源码之外 |
| `AGENT_SCHOOL_DEMO` | 是否允许演示 | 前端通过 `/me.capabilities.demo_enabled` 决定入口，不能只靠页面限制 |

### 同源代理的实际行为

入口为 `apps/web/src/app/api/v1/[...path]/route.ts`，实现为 `apps/web/src/lib/proxy.ts`。浏览器只访问 `/api/v1`，代理校验实际 Host 与写请求 Origin，覆盖浏览器提供的 `X-Local-Token`，保留幂等键和 `Last-Event-ID`，透传状态码、内容类型及附件头，并禁用业务缓存。

Next.js 可能在内部用 localhost 合成 `request.url`，来源判断采用实际 Host 头和浏览器 Origin；升级时不要仅凭这个内部 URL 拒绝正常请求。SSE 按块转发，不收集完整响应后再返回。后端重启导致流断开时，代理结束该次传输，让客户端按事件序号恢复，不伪造终态或重新发起运行。

当前代理请求体上限 1 MiB；文件预览最多 20000 字符并显示截断提示，完整文件走下载接口。后端文件、导出大小与权限限制仍需独立执行。

## 4. 已协调并修复的后端问题：完整回答被清空

### 现象与原因

真实 SDK + 本地 HTTP 提供商联调时，`message.delta` 含有正文，随后 `message.completed.payload.content` 却为空。前端按照契约用完整消息替换增量，导致运行完成后回答消失，后续对话历史也缺少助手正文。

原因位于 `apps/api/src/agent_school/runtime/agentscope_runtime.py`：AgentScope 2.0.10 的普通 `TextBlockEndEvent.text` 默认是 `None`，表示正文应来自先前增量；原适配 `event.text or ""` 将其转成空字符串。

### 本次修复

- 按 `block_id` 累积文本增量。
- 结束时只有 `event.text is None` 才使用累积值；明确传入的文本（包括空字符串）仍被尊重。
- 最终正文经现有脱敏函数处理，再发布相同格式的 `message.completed`。
- 失败或取消时不补造完成消息。

修改仅涉及该运行适配文件及 `apps/api/tests/test_http_provider.py` 的完整正文断言，没有调整评分或接口。用户于 2026-10-18 明确同意该最小修复；请在后端合并和后续 SDK 升级时保留此行为。

验证顺序为：浏览器正文断言复现失败 → 修复 → 41 项后端回归通过 → 7 项浏览器回归通过并重拍截图。详情见[协调记录](backend-coordination.md)。

## 5. 前端依赖的关键接口语义

完整请求字段与错误码以[契约说明](../contracts/README.md)为准。以下是变更后容易影响学生流程的依赖点。

| 流程 | 主要接口 | 前端当前依赖 |
| --- | --- | --- |
| 读取课程 | `GET /lessons`、`GET /lessons/{id}?version=…` | 无 Key 可读；继续实验必须读取 `Attempt.lesson_version` 对应课件 |
| 连接模型 | 创建/更新 profile → credential → check | Key 专用接口提交后清空输入框；配置响应不返回 Key；检查失败也可能是 HTTP 200，需看 `connection_check.status/error_code` |
| 创建与配置实训 | 创建/读取/PATCH attempts | 模式和课件版本固定；更新携带 `expected_revision`，只影响下一轮 |
| 发起一轮 | `POST /runs` | live 使用非空 profile_id，demo 使用 null；返回接受不等于运行完成 |
| 事件恢复 | 运行列表、event-history、events | 历史按序号读取到尾后续接 SSE；游标错误应明确报错，不静默跳过事件 |
| 保存审批 | approvals decision | 决定绑定本次调用与参数；approved 只是批准，实际保存成功须有匹配 call_id 的 `tool.completed` 且 `payload.result.status == "ok"` |
| 提交验收 | 创建/读取 submissions、提交历史 | 正式通过只看 `Submission.passed`；`evaluation_passed` 不能使演示正式完成；旧提交和文件是冻结快照 |
| 重置与导出 | reset、exports 与 download | 重置等待旧运行终止后创建新实验；旧记录可读；导出包含学习记录和产物，排除连接配置、Key 与令牌 |

### SSE 与刷新恢复

前端先读取 Attempt 和固定版本课件，再分页读取运行及各运行的事件历史，恢复未决批准，最后对活跃运行订阅 SSE。游标采用已实际读到的事件末序号，同时传 `after_seq` 和 `Last-Event-ID`。

- 按 `run_id + seq` 去重；连续性不满足时不拼造缺失事件。
- `message.completed` 替换对应消息增量，后端须提供最终完整正文。
- 收到终态后结束订阅；HTTP 204 表示已读完，不再重连。
- 短暂断线按末序号退避续接，刷新恢复不 POST 新运行。
- 重启后读取 `interrupted`、失效批准和清除后的凭据状态，不自动重做有副作用的操作。
- 停止接口表示请求已接收，前端等待终态；重置与提交不能绕过后端运行锁。

恢复相关代码为 `apps/web/src/lib/events.ts` 和 `apps/web/src/app/practice/[id]/page.tsx`。

### 幂等、版本与错误

创建配置、连接检查、创建/重置实验、启动运行、提交和导出会发送 `Idempotency-Key`。当前前端在页面内存中保留传输结果不明确时的键；刷新会丢失这份客户端缓存，因此刷新后先读取后端状态，不自动补发写操作。服务端成功结果去重仍是必要保障。

版本冲突、忙碌、批准过期/失效与幂等进行中均展示明确反馈，不自动循环重试可能消耗额度的动作。保留结构化 `error.code`、`fields` 和 `request_id`；不能只变文案却改掉错误语义。内部令牌错误属于本地服务接入故障，页面不会引导学生登录。

### 四关作答与评分归属

| 关卡 | 前端提交的 answers 形状 | 后端验收职责 |
| --- | --- | --- |
| 01-task | `question_id`、`option_id` | 同实验内两次不同指令的完成运行与理解题；正式通过须使用真实模式证据 |
| 02-context | `facts[]: task_id, due_date, source_id` | 必要资料实际读取成功，事实与来源正确 |
| 03-tools | `course_id`、`session_date`、`room` | 指定工具和参数执行成功，并核对返回信息 |
| 04-permission | `{}` | 拒绝未写入、批准实际保存、冻结产物满足规则 |

前端只渲染服务端公开的作答表单与规则反馈，不自行计算成绩，不从材料文件是否被勾选或 Agent 自述判断操作完成。课件 API 继续避免返回正确选项和私有评分答案。

## 6. 后端后续待办与验收标准

| 时机 | 待办 | 交付标准 |
| --- | --- | --- |
| 合并时 | 审阅并保留第 4 节 SDK 正文修复 | 完整回答与后续历史均有正文；流式与最终文本脱敏测试通过 |
| 下一轮契约维护 | 修正生成类型的 discriminator | 生成的 `kind/name` 与 JSON 线上常量一致；不手工修改生成文件；前后端共同验证后移除前端适配 |
| 下一轮启动体验 | 等待前端 HTTP 就绪后再提示可用 | 不能仅以 API 健康代表页面就绪；失败时说明前端启动错误，清理仅限本项目进程 |
| 真实提供商联合验收 | 使用本地自备 Key 完成四关 | 连接检查、读取/查询、拒绝/批准、实际产物与正式提交均有实测记录，不含凭据 |
| 合并后文档同步 | 更新旧后端文档中的阶段描述 | `docs/backend.md` 中“尚无前端浏览器端到端验收”等旧状态与本次交付一致 |

### 类型生成问题的具体范围

现有 `contracts/types.d.ts` 将部分联合 discriminator 生成为 schema 名称，例如 `ChoiceForm`、`RunStartedEvent`，实际线上值为 `choice`、`run.started`；工具调用的 name 也有类似差异。

前端 `apps/web/src/lib/types.ts` 目前只替换这些字面量，payload 仍复用契约类型，未改 JSON 契约或后端数据。后端维护者可评估补齐 discriminator mapping 或调整生成器配置；具体方案需双方确认。验收应包含重新生成类型、验证样例，以及前端类型检查、事件/表单和浏览器回归。不要通过改线上事件名去迎合错误生成结果。

### 真实模型验证的边界

外部提供商实测尚未执行。本地脚本 HTTP 提供商虽然走真实 SDK、且第一关使用 `mode=live` 验证正式评分分支，也不能证明外部服务兼容。演示结果同样不能算正式通过。请将真实服务商、模型 ID、结果、失败原因和实际显示的用量补入[独立实测记录](live-model-validation.md)，Key 只在本地页面输入，不进入聊天、截图、PR 或仓库。

## 7. 验证结果与复现

以下结果对应上述已验证代码提交，均已完成；本交接文档本身不改变应用行为。

| 检查 | 结果 |
| --- | --- |
| 前端类型检查、生产构建、格式 | 通过 |
| 前端测试 | 5/5 通过，含消息替换、去重、续接、批准与实际保存区分、代理校验与流式/附件 |
| Chromium 浏览器 | 7/7 通过，含四关、完整回答、认证失败、刷新、审批、快照下载、导出、重置、重启及演示转正式 |
| 后端回归与 Ruff | 41/41 通过；检查与格式通过 |
| 原 Windows 启停联动 | 通过；Next dev + 私有令牌代理可读取四关，首页 HTTP 200；测试进程已停止 |
| 云端前端 CI | [通过](https://github.com/2791243700-hue/agent-practice-lab/actions/runs/39100790005) |
| 云端后端 CI | [通过](https://github.com/2791243700-hue/agent-practice-lab/actions/runs/39100790034)，Windows/Ubuntu × Python 3.11/3.12 |
| 云端契约 CI | [通过](https://github.com/2791243700-hue/agent-practice-lab/actions/runs/39100790062) |

仓库根目录执行后端检查：

```powershell
uv sync --project apps/api --locked
uv run --project apps/api pytest apps/api/tests -q
uv run --project apps/api ruff check --config apps/api/pyproject.toml apps/api/src apps/api/tests
uv run --project apps/api ruff format --check --config apps/api/pyproject.toml apps/api/src apps/api/tests apps/api/alembic
```

前端与浏览器检查：

```powershell
cd apps/web
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Windows 上可另外执行：
npm run test:launcher
```

按顺序执行 typecheck、build 和 dev，避免争用 Next.js 生成目录。浏览器测试由 `apps/web/tests/serve.mjs` 启动隔离 API、真实 SDK 和本地脚本模型，使用临时数据目录及 3100/8100/8101 端口；不会读取学生 Key 或日常学习数据库。测试用模型服务中的重启控制入口仅属于测试进程，不是产品 API。

Windows 启动器冒烟另用 3200/8200 与隔离数据目录。机器 HTTP 代理不应接管回环测试请求；浏览器测试服务已清空其子进程的代理变量并配置回环 NO_PROXY。

## 8. 文件索引与后续协作

| 文件 | 后端开发者关注点 |
| --- | --- |
| `contracts/README.md`、`openapi.json`、`types.d.ts` | HTTP、错误、并发、版本和事件契约 |
| `apps/api/src/agent_school/runtime/agentscope_runtime.py` | SDK 事件与外部工具网关适配、本次正文修复 |
| `apps/api/tests/test_http_provider.py` | 真实 SDK + 本地 HTTP 模型与最终正文回归 |
| `apps/api/tests/test_redaction.py` | 流式密钥、失败/取消和批准参数遮盖 |
| `apps/web/src/lib/proxy.ts` | 同源、内部令牌、SSE 与附件转发 |
| `apps/web/src/lib/types.ts` | 待生成器修正后清理的 discriminator 适配 |
| `apps/web/src/lib/events.ts` | 序号、去重、消息替换与事件连接恢复 |
| `apps/web/src/components/run-view.tsx` | 工具执行、批准与实际保存的展示 |
| `apps/web/src/components/feedback.tsx` | 四关表单、逐项反馈、证据与旧提交快照下载 |
| `tests/e2e/learning.spec.ts` | 浏览器回归与截图生成 |
| `docs/backend-coordination.md` | 已协调修复与待协调事项的简要记录 |

后续修改 API、事件、错误语义或评分前，先约定契约与前端影响；课程内容修改需发布新版本，并保留旧实验对应版本。问题交接请附提交/课件版本、mode、attempt_id/run_id、相关事件序号、错误码和最短复现步骤；日志和截图先检查凭据遮盖。联调完成后同步更新对应测试与记录。
