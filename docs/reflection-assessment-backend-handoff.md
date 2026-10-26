# 复盘验收接口与联调

更新：2026-10-26。现行功能包括统一实训、第一关正式复盘、接口映射与通知上下文修复；当前契约为 41 个 HTTP 操作、102 个 schema、11 类 SSE 事件。最新合并版本与分轮验证见[版本索引](project-status.md)，协议以[契约说明](../contracts/README.md)为准。

## 版本与职责

第一关 1.1.0 的 answer_form.kind=reflection；公开表单包含 prompt 和 challenge.id/title/notice/items，不包含私有正确判断。旧 1.0.0 继续 choice，旧成绩不重算。前端按实验固定课程版本选择表单，不能把已有实验自动升级。

前端负责输入、选择真实运行和精确引用；后端负责归属、顺序、版本、规则结果及不可变提交。解释和改写要求非空白输入，正式评分不评价它们的语义质量，不以关键词或最低字数判定理解。部分满足/未满足同样可以通过结构化验收，须提供 next_instruction。模型点评由 Tips 单独提供。

## 调用顺序

以下路径均省略同源 /api/v1。浏览器不传 owner 或内部令牌。

| 步骤 | 接口 | 必须处理 |
| --- | --- | --- |
| 恢复实验 | GET /attempts/{attempt_id}；GET /lessons/{lesson_id}?version=... | mode、lesson_version、revision、active/superseded |
| 恢复对话 | GET /attempts/{attempt_id}/runs；GET /runs/{run_id}/event-history | 分页读取，保留完整 message.completed 原文和 seq |
| 读取草稿 | GET /attempts/{attempt_id}/reflection-draft | 200 ReflectionDraft；没有草稿时 revision=0、draft=null、updated_at=null |
| 保存草稿 | PUT /attempts/{attempt_id}/reflection-draft | expected_revision、expected_attempt_revision、完整 draft；200 ReflectionDraft；不使用幂等键 |
| 正式提交 | POST /submissions | attempt_id、expected_attempt_revision、answers；Idempotency-Key；201 Submission |
| 查看历史 | GET /attempts/{attempt_id}/submissions；GET /submissions/{submission_id} | 冻结答案、逐项结果及 evidence_refs；演示不计正式通过 |
| 查看建议 | GET /runs/{run_id}/tips | 200 {tips:null} 或 {tips:RunTips}，不调用模型 |
| 生成建议 | POST /runs/{run_id}/tips | 主动同意后传 profile_id、expected_profile_revision、幂等键；200 RunTips |
| 导出 | POST /attempts/{attempt_id}/exports；GET /exports/{export_id}/download | expected_revision + 幂等键，201 Export 后下载冻结 ZIP |

所有写操作都经同源校验。正式提交的成功 HTTP 状态不等于通过，必须读取 Submission.passed；demo 仅看 evaluation_passed 展示演示结果，passed 始终 false。

## 草稿保存与恢复

ReflectionDraft = {attempt_id, revision, draft, updated_at}。PUT 请求是 {expected_revision, expected_attempt_revision, draft}。draft 的 18 个字段全部必填，允许未完成空值；camelCase 字段保留原名，完整映射表见契约说明第 11 节。

保存只递增草稿 revision，不修改 Attempt.revision、不触发模型、不产生提交。前端必须先 GET 再保存，同一实验以 500ms 防抖串行发送，每次沿用最近成功响应的 revision。任一版本冲突都返回 409 REVISION_CONFLICT；停止自动写，保留本地编辑并允许下载备份、主动重读实验和草稿。丢失响应后先 GET，不盲目重试 PUT。

GET 可读取归属正确的旧实验；PUT 仅允许 active reflection 实验。草稿引用的非空运行须属于同一实验/模式，消息须存在；草稿保存不证明运行已完成或答案正确。非复盘实验写入返回 422；旧实验被重置后写入返回 409 ATTEMPT_SUPERSEDED。

刷新恢复最近成功保存的后端草稿。同一页面进程内 SPA 后退/前进可恢复未保存备份并暂停自动保存；不是跨浏览器或完整刷新持久化。重置建立同版本同模式的新实验，新草稿为空，旧草稿保留；模型选择、内存 Key 和检查状态保留。完整服务重启才清 Key。

## 正式答案与服务端校验

ReflectionAnswers 包含 kind=reflection、baseline_run_id、revised_run_id、change、evidence.before/after、judgment、explanation、next_instruction、challenge。不要直接发送 ReflectionDraftData，也不要提交客户端通过标志。

- change.category 为 goal/constraint/output；change.quote 必须逐字存在于第二轮原始 input_text 且不在第一轮 input_text。
- evidence.before/after 分别含 message_id、event_seq、quote、start_offset，对应两轮实际 message.completed。start_offset 是原始正文从 0 开始的 Unicode 码点位置，不是 UTF-16 单元或渲染后字符位置；重复引用保存选定的出现位置。
- 两轮归属同一实验同一模式，必须 completed、有非空完整回答及完成事件；先后由服务端持久创建顺序判断，不依赖 ID、分页排序或不同运行的 seq。
- judgment 为 satisfied/partial/unsatisfied。explanation 与 challenge.instruction 须含非空白内容，最多 6000 字符；next_instruction 字段始终必填，satisfied 可传空，其余判断须含非空白内容。
- challenge.challenge_id 与 judgments 的 item_id 取该版本公开表单，decision 为 known/confirm；正确判断由服务端私有规则决定，客户端不得传正确答案或分数。

非法结构、越界运行、伪造完整消息/事件和变式 ID 在冻结前拒绝，返回 422 VALIDATION_ERROR。结构合法但顺序、引用原文、改动或变式判断不满足规则，则创建 201 Submission 并在必要项中标记失败。运行/授权/重置尚未结束返回 409 ATTEMPT_BUSY；过期实验版本号返回 409 REVISION_CONFLICT。其他通用状态见契约错误表。

正式提交冻结点击时发送的答案、规则结果及证据；不自动读取草稿代填答案，之后修改草稿不改变旧提交。Submission.evidence 由服务端生成，答案中的 evidence 只是引用请求，两者不可混淆。

## Tips、历史与导出

新生成 Tips 可以点评目标改进轮对应的已保存草稿和符合范围的已提交答案；不发送私有规则/正确答案。模型建议不改变正式成绩。按 run_id 缓存，编辑后不自动重评；GET 无需 Key，POST 首次生成需有效 Key 和已通过检查的配置。TIPS_INVALID 可由用户明确重试，TIPS_UNCERTAIN 表示中断后调用结果不明确，禁止自动重复请求。

历史详情显示冻结 ReflectionAnswers 和规则证据，引用定位到对应运行事件；旧版 choice 结果按旧格式查看。ZIP learning.json 包含 reflection_draft 整个对象和 submissions 的不可变答案/证据，排除连接配置、Key 和内部令牌。保存草稿、提交和导出是三个独立动作，互不替代。

## 验证与维护入口

当前验证与 CI 证据见[版本索引](project-status.md)。现有回归覆盖双版本、精确重复引用/emoji、反向顺序、草稿冲突/失败恢复、正式与演示、历史/导出及第二至四关。通知上下文与步骤解锁的后续验证见[实训修复记录](practice-fixes-2026-10-26.md)。使用本地脚本模型，未新增真实服务商验收。

后端维护 reflection.py、grading.py、submissions.py、lessons.py、exports.py、tips.py；前端维护 conversation-review.tsx、use-reflection-draft.ts、reflection.ts、feedback.tsx。课件为 content/lessons/01-task-v1.1/，旧 content/lessons/01-task/ 不原地改写。契约变更同步 OpenAPI、样例和生成类型，不能手改 types.d.ts。生成类型已补齐显式映射并移除适配；第四关指导和启动器就绪检查仍见[协调记录](backend-coordination.md)。
