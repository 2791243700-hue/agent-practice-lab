# Agent Practice Lab：前后端开发交接

更新：2026-10-26。统一实训已通过 [PR #9](https://github.com/2791243700-hue/agent-practice-lab/pull/9) 合并到 main `af36497`，包含第一关 1.1.0 正式复盘、草稿恢复、Tips 和提交弹窗。当前契约 v0.1.0：41 个 HTTP 操作、102 个 schema、11 类 SSE 事件。 接口以[契约说明](../contracts/README.md)为准，功能与验证见[统一交付](unified-practice-delivery.md)。

## 当前代码与接收方式

从 main 接手。PR #10 的前端预览已经由 PR #9 完成正式接入，合并提交 af36497；不再需要合并旧功能分支或另做一套复盘接口。第一关 1.1.0 使用 ReflectionForm/ReflectionAnswers，旧 1.0.0 保留 choice；第二至四关验收不变。

主要接入入口：[完整契约](../contracts/README.md)、[复盘字段与联调](reflection-assessment-backend-handoff.md)、[OpenAPI](../contracts/openapi.json)。接口版本保持 v0.1.0，课程版本单独归档。历史预览记录见[预览交付](reflection-assessment-delivery.md)。

## 启动与测试入口

需要 Node.js 22+、Python 3.11/3.12、uv。根目录执行：

```powershell
uv sync --project apps/api --locked
npm --prefix apps/web ci
.\scripts\start.ps1
# http://127.0.0.1:3000
# 停止：.\scripts\stop.ps1
```

可用 `-Demo` 开演示，或 `-WebPort`、`-ApiPort`、`-DataDir` 创建独立实例；停止须使用相同数据目录。启动器传递私有的 AGENT_SCHOOL_API_ORIGIN、AGENT_SCHOOL_FRONTEND_ORIGIN、AGENT_SCHOOL_LOCAL_TOKEN；令牌不进入 NEXT_PUBLIC、浏览器、URL 或持久化配置。浏览器只访问同源 `/api/v1`，不要将启动地址的 127.0.0.1 随意换成 localhost。

完整命令与证据见[后端说明](backend.md)、[统一交付](unified-practice-delivery.md)。合并前 193 项后端、18 项前端、52 项浏览器与 231 项契约结构检查通过；main af36497 的三类 CI 全部通过。测试使用本地脚本模型，不代表新增功能已完成真实服务商或零经验学生验收。

## 新模型设置的契约

| 流程 | 调用与边界 |
| --- | --- |
| 添加 Key | `POST /model-profiles/connect`，携 Idempotency-Key；先向选定服务商获取列表，成功后创建非敏感 profile 并将 Key 存内存，返回 profile/catalog |
| 服务商 | provider_id 为 deepseek/openai/openai-compatible；前两者固定官方 URL，兼容服务要求根地址，可显式指定 model_id 回退手动模式；profile.provider 仍为 openai-compatible |
| 刷新目录 | `GET /model-profiles/{profile_id}/models`，使用该连接的内存 Key；不自动推理，不跟重定向；占用全局执行槽 |
| 选模型与改名 | 现有 updateProfile 携完整非敏感字段和 expected_revision；改模型/地址使检查失效，仅改名保留检查 |
| 补充/清除凭据 | 现有 credential PUT/DELETE；清除仅保留连接元数据，输入后立即清空页面值，不能读回 |
| 删除连接 | 现有 profile DELETE 加 expected_revision，同时清内存凭据，不影响其他连接及历史实训 |
| 兼容检查 | 明确同意额度后 POST check；最多三次推理。列表中出现模型不等于支持文本和工具，live 仍要求当前检查通过 |

创建失败不留残配置；错误体和元数据不回显 Key。新导入的幂等结果只保存非敏感响应和请求摘要，Key 不落库；后端重启后历史幂等重放不会恢复凭据，需查询当前状态并重新输入。前端操作缓存只存请求体 SHA-256 指纹；写操作不自动重试。

## 学习流程的稳定语义

- 无 Key 可读导读；创建实验锁定 mode 和 lesson_version。继续实验须按该版本取课件，不能套最新版本。
- 材料勾选只允许读取；必须有成功工具事件才算读取。第一关不调用工具，通知在任务正文中。
- 设置 PATCH 携 expected_revision，修改只影响下一轮；当前 Run 使用冻结快照。
- 启动返回 202 只代表接收；mode=live 使用 profile_id，demo 用 null。单全局槽也约束目录/连接检查。
- 刷新先读实验、固定课件、分页运行/事件，再从末序号订阅；按 run_id+seq 去重。最终正文替换增量，临时故障按游标续接，恢复不 POST 新运行。
- approval 的 approved 只代表决定；保存成功看匹配 call_id 的 tool.completed 且 result.status=ok 及实际文件。拒绝无写入，新调用需新批准。第四关验收要求有效拒绝在成功保存请求之前，跨 Run 使用持久化追加顺序，不比较局部 seq；旧提交不重算。
- 提交由后端依据事件、答案和冻结文件评分，前端不传分数或 Submission.evidence；复盘答案内的 evidence 仅为待核验引用。正式通过只看 passed，demo 即使 evaluation_passed 也不计通关。日期列使用开始时间和上海时区，状态有图标文字。
- 重置先终止旧运行，再创建同版本同模式的新实验；旧记录保留只读及历史成绩。导出排除模型配置、Key 和私有令牌。
- 提交答案先按本关校验，再复制快照；失败仅清理本次创建目录，保留历史快照。课件发布统一核对必需规则及表单匹配，混合数字/文本版本采用确定的排序。

IdentityProvider/LocalIdentityProvider 目前只保留声明，服务、存储和幂等链路仍固定 local-owner；未来接入账号时需贯穿调用，不能把替换 `/me` 当作完成登录支持。

当前 v0.1.0 同时支持新版 ReflectionAnswers、旧 question_id/option_id、facts[]、course_id/session_date/room 和空对象；根据实验固定版本的 answer_form 选择，不按关卡 ID 强行替换所有旧实验。复盘引用由客户端提交，服务端核验后生成正式证据。草稿仅保存表单，不表示提交或通关。

## 待办与维护边界

复盘持久化、结构化评分、历史与导出已经交付。自由解释须填写，但质量不按字数、关键词或单次模型评价决定正式成绩；可通过独立 Tips 获得建议。

1. 第四关发布新版本说明必要 task_id；再做零经验用户独立验收。不要把已有后端实测说成新手体验已完成。
2. discriminator 映射已在本地修复，前端适配已删除；后续新增联合类型同步显式映射和生成类型，见[接口更新](interface-update-2026-10-26.md)。
3. 启动器增加前端 HTTP 就绪等待；当前首次访问可能需稍等刷新。
4. 用真实服务商在新设置页验证导入、模型选择、兼容检查及浏览器四关闭环；目前新功能只有本地自动化。
5. 后续变更按具体提交核验 CI；当前 main `af36497` 的三类 CI 已全部通过，详见[版本状态](project-status.md)。无登录、班级或线上部署实现，不能仅改监听地址就上线。

## 主要维护文件

| 文件/目录 | 责任 |
| --- | --- |
| contracts/openapi.json、events.schema.json、types.d.ts | 接口、事件与生成类型，变更联动校验 |
| apps/api/src/agent_school/model_profiles.py、runtime/model_connector.py | 官方/兼容导入、模型目录、凭据与检查 |
| apps/api/src/agent_school/runtime/agentscope_runtime.py、provider_options.py | SDK 事件/权限和提供商参数 |
| apps/web/src/components/key-manager.tsx、learning-status.tsx | Key 管理与日期/通关展示 |
| apps/web/src/lib/api.ts、proxy.ts、events.ts、types.ts | 幂等、代理、恢复与共享生成类型 |
| apps/api/tests/test_model_catalog.py、test_http_provider.py、test_redaction.py、test_submission_cleanup.py | 目录、真实 SDK、本地 HTTP、脱敏与提交失败清理回归 |
| tests/e2e/learning.spec.ts、keys.spec.ts、preview.spec.ts、records.spec.ts、review.spec.ts | 学习、Key、预览、布局和历史只读回归 |
| apps/api/src/agent_school/reflection.py、grading.py、exports.py、tips.py | 草稿、正式验收、导出与独立模型反馈 |
| apps/web/src/components/conversation-review.tsx、lib/use-reflection-draft.ts、lib/reflection.ts | 四步表单、自动保存、冲突和引用映射 |
| content/lessons/、scripts/ | 版本化课程和本地启停 |

跨端更改先同步契约，课件变更发布新版本。问题交接附提交/课程版本、mode、资源 ID、事件序号、错误码和最短复现，先检查日志与截图无凭据。
