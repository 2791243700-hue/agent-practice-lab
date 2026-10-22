# Agent Practice Lab：前后端开发交接

更新：2026-10-22。适用于接手前端、后端、契约与课程的开发者。已合并主分支状态与验证边界详见[版本状态](project-status.md)。

## 当前代码与接收方式

PR #1 契约、#2 后端、#3 前端、#4 DeepSeek/权限适配、#5 预览修复均已合并到 main，历史基线为 `3214d75`；当前 main 已纳入下述 #6、#7，代码基线为 `a8f7438`。原前端依赖 feat/backend 的合并顺序已执行完成，无需再次 retarget 或 cherry-pick 旧修复。

PR #6 已将 Key 管理、界面、审查修复与文档更新合并到 main（`e5a3458`）。接手时直接获取 main。通过 PR 查看差异和对应 CI；数据目录、凭据、日志及 Next.js 的开发生成路径不进入提交。

前端体验增量已通过 PR #7 合并到 main（`a8f7438`），原开发基线为 `b56182f`。包含侧栏与板块折叠、紧凑顶部、生活情境示例、准备提醒，以及问题即时显示和流式滚动。后端接口及课件包未更改；启动、6 张截图与 8 项前端/26 项浏览器验证见[增量交付说明](practice-workspace-delivery.md)。两个 PR 的依赖合并已经完成，无需再 retarget 或 cherry-pick。

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

完整命令与最新证据见[后端说明](backend.md)、[后端验证](runtime-validation.md)、[前端验证](frontend-validation.md)。最近本地结果为 197 项契约、91 项后端、8 项前端、26 项浏览器测试通过，Ruff/格式/类型/生产构建通过；功能分支 CI 以对应 PR 实际结果为准。2026-10-19 DeepSeek 实测仅覆盖后端，第四关额外提供 ID 映射，见[独立记录](live-model-validation.md)。

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
- 提交由后端依据事件、答案和冻结文件评分，前端不传分数/证据；正式通过只看 passed，demo 即使 evaluation_passed 也不计通关。日期列使用开始时间和上海时区，状态有图标文字。
- 重置先终止旧运行，再创建同版本同模式的新实验；旧记录保留只读及历史成绩。导出排除模型配置、Key 和私有令牌。
- 提交答案先按本关校验，再复制快照；失败仅清理本次创建目录，保留历史快照。课件发布统一核对必需规则及表单匹配，混合数字/文本版本采用确定的排序。

IdentityProvider/LocalIdentityProvider 目前只保留声明，服务、存储和幂等链路仍固定 local-owner；未来接入账号时需贯穿调用，不能把替换 `/me` 当作完成登录支持。

四关答案依次为 question_id/option_id、facts[]、course_id/session_date/room、空对象；详见[契约](../contracts/README.md)。内部版本继续保存，页面精简小字不影响版本锁定和评分。

## 待办与维护边界

1. 第四关发布新版本说明必要 task_id；再做零经验用户独立验收。不要把已有后端实测说成新手体验已完成。
2. 修复生成类型 discriminator，验证后去除前端 lib/types.ts 适配。
3. 启动器增加前端 HTTP 就绪等待；当前首次访问可能需稍等刷新。
4. 用真实服务商在新设置页验证导入、模型选择、兼容检查及浏览器四关闭环；目前新功能只有本地自动化。
5. 后续变更按具体提交核验 CI；PR #6、#7 已依次合并，main `8bbf7dd` 的 6 项检查现已全部通过，详见[版本状态](project-status.md)。无登录、班级或线上部署实现，不能仅改监听地址就上线。

## 主要维护文件

| 文件/目录 | 责任 |
| --- | --- |
| contracts/openapi.json、events.schema.json、types.d.ts | 接口、事件与生成类型，变更联动校验 |
| apps/api/src/agent_school/model_profiles.py、runtime/model_connector.py | 官方/兼容导入、模型目录、凭据与检查 |
| apps/api/src/agent_school/runtime/agentscope_runtime.py、provider_options.py | SDK 事件/权限和提供商参数 |
| apps/web/src/components/key-manager.tsx、learning-status.tsx | Key 管理与日期/通关展示 |
| apps/web/src/lib/api.ts、proxy.ts、events.ts、types.ts | 幂等、代理、恢复与类型适配 |
| apps/api/tests/test_model_catalog.py、test_http_provider.py、test_redaction.py、test_submission_cleanup.py | 目录、真实 SDK、本地 HTTP、脱敏与提交失败清理回归 |
| tests/e2e/learning.spec.ts、keys.spec.ts、preview.spec.ts、records.spec.ts、review.spec.ts | 学习、Key、预览、布局和历史只读回归 |
| content/lessons/、scripts/ | 版本化课程和本地启停 |

跨端更改先同步契约，课件变更发布新版本。问题交接附提交/课程版本、mode、资源 ID、事件序号、错误码和最短复现，先检查日志与截图无凭据。
