# Agent Practice Lab Web

> 2026-10-27 本版本接入正式模型验收：第一关 1.2.0、第二至四关 1.1.0，41 操作 / 109 schema。新增提交字段、费用确认、判定和失败处理以[模型验收说明](../../docs/model-assessment-2026-10-27.md)为准；旧版本行为与历史验证按各自日期保留。

当前功能与最近合并版本见[版本索引](../../docs/project-status.md)。第一关按课程版本使用正式复盘或旧版 choice，草稿后端恢复；固定通知直接进入 Agent 上下文，并在材料区默认展示；四步复盘按完成条件顺序解锁。Tips、重置、结果弹窗和其余三关保留。最新课件为第一关 1.2.0、其余三关 1.1.0，正式验收需客观证据及模型内容评分均合格；当前接口为 41 操作、109 schema。

Next.js App Router + TypeScript。课程、评分和身份通过现有后端获取，页面不复制正式评分逻辑，不修改已发布课程。

第一关按 ReflectionForm 渲染并接入 GET/PUT reflection-draft，正式提交发送 ReflectionAnswers。草稿 camelCase 字段与正式 snake_case 答案须显式映射；保存冲突保留本地编辑，不静默覆盖。调用顺序、消息码点定位和新旧版本兼容见[复盘接入说明](../../docs/reflection-assessment-backend-handoff.md)。

从仓库根目录安装：`npm --prefix apps/web ci`。使用 `scripts/start.ps1` 一起启动前后端；原启动器已支持本目录的 `npm run dev -- --hostname … --port …`。

```powershell
cd apps/web
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

浏览器测试要求先 `uv sync --project apps/api --locked` 创建后端环境，使用 3100（Web）、8100（API）、8101（本地脚本模型）端口及新建的临时数据目录。测试进程结束时仅停止其创建的子进程；不会读取学生 Key 或修改日常学习数据库。可通过 `AGENT_SCHOOL_TEST_PYTHON` 指定项目 Python。

私有服务端变量由启动器提供：`AGENT_SCHOOL_API_ORIGIN`、`AGENT_SCHOOL_FRONTEND_ORIGIN`、`AGENT_SCHOOL_LOCAL_TOKEN`。绝不添加 `NEXT_PUBLIC_` 前缀，也不把令牌写进 .env 或 URL。代理校验实际 Host 与写请求 Origin，覆盖浏览器的同名内部令牌头，并流式透传 SSE 与附件响应。

`src/lib/types.ts` 直接复用生成类型。OpenAPI 的 AnswerForm、ToolCall、Evidence、StoredEvent 已补齐显式 discriminator.mapping，覆盖 24 种实际 kind/name 值，不再维护前端补丁。本次更新见[接口记录](../../docs/interface-update-2026-10-26.md)。新接口在契约中定义并重新生成 `contracts/types.d.ts`，不手改生成类型。服务端仍决定权限、状态和 `Submission.passed`。

`components/key-manager.tsx` 管理 Key 与模型；`components/learning-status.tsx` 统一日期和通关展示；`lib/api.ts` 保留结果不明确时的幂等键，操作体缓存只保留 SHA-256 指纹，不保留 Key 明文。Key 不写入 localStorage/sessionStorage。服务商建议不等于认证成功；模型列表不等于文本和工具兼容检查通过。

当前测试与 CI 证据统一记录在[版本索引](../../docs/project-status.md)，本次冗余样式清理见[清理记录](../../docs/cleanup-2026-10-26.md)。浏览器测试使用脚本模型和虚构凭据；Ubuntu CI 使用运行器预装 Chrome，本地默认使用 Playwright Chromium，也可设 `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`。不要在日常 dev 使用的同一 .next 中执行 build。

## 当前交互与验收

DeepSeek 申领提示按当前模型连接检查显隐。导读与主任务对齐；Ctrl+Enter 复用发送校验，首次使用后只保留键位标记；Tips 卡片按需展开，确认后才生成。下一步和提交在缺失输入时列出具体问题、标记字段并聚焦，补齐后自动清除；运行/只读状态仍禁用操作，校验失败不调用验收。

新正式课程提交 assessment（已检查 profile、revision、consent=true），第二至四关另填 learning_reflection。展示 model_assessment 与逐项必要规则，模型不可用不能通关。旧课件和历史记录兼容；浏览器不自行决定通过。见[模型验收](../../docs/model-assessment-2026-10-27.md)与[缺失项交付](../../docs/form-validation-2026-10-27.md)。
