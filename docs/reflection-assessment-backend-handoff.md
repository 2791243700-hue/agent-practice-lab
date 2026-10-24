# 复盘验收：后端接入任务与联调清单

日期：2026-10-24。面向后端、契约及课程维护者。当前交付是前端预览，以下新字段、接口与评分方案是待协商的接入要求，不是已经发布的 API。请从合并后的 main 接手，先核对[版本状态](project-status.md)和[本次前端交付](reflection-assessment-delivery.md)。

## 1. 当前已经做了什么

| 范围 | 当前实现 | 后端是否已接入 |
| --- | --- | --- |
| 第一关 | 用“选择两轮 → 标出改动 → 核对回答 → 换个情境”替换旧单选题及旧提交入口 | 否。只在浏览器中核对引用和小练习，解释及改写质量未评分，不生成新的正式成绩 |
| 第二关 | 保留实际读取、日期和来源核对 | 是，沿用现有 read_and_check_facts |
| 第三关 | 保留真实查询、课程日期和教室核对 | 是，沿用现有 lookup_and_check_course |
| 第四关 | 保留拒绝未写入、后续批准、实际保存及产物检查 | 是，沿用现有 denied_without_write / approved_todos_artifact |
| 历史成绩 | 第一关原版本成绩仍可查看，并明确标为历史结果 | 现有 Submission 与不可变证据保留，不重算 |
| 首页 Key 提示 | 至少一项 credential_status=configured 时隐藏准备提示；所有凭据缺失时恢复 | 复用 GET /model-profiles，不新增接口、不读取 Key 明文 |

当前正式契约仍为 v0.1.0，共 37 个 HTTP 操作、89 个 schema，课件仍为 1.0.0。旧第一关 choice_answer 的 API 兼容能力仍在后端；当前前端不再用它产生新成绩，也不代选 clear-goal 来伪装复盘提交。

## 2. 先共同确认的事项（P0）

1. **评分标准先于实现。** 先确定第一关新版要证明的能力和正反例：真实完成两次相关尝试；能指出新增要求；能把回答与要求关联；能在新情境区分已知和待确认信息。仅引用存在、字数足够或表单填满，都不能证明理解。
2. **新课件版本与验收类型。** 选择新的第一关课程版本号，设计 reflection 类型的 answer_form 与 evaluator。变式题必须进入版本化课程包，不能继续从前端常量取评分依据。不要原地覆盖已发布 1.0.0 或修改旧成绩。
3. **旧实验继续方式。** 对旧版未完成实训明确约定：继续按旧规则的兼容入口，或由学生主动另开新版本。当前前端隐藏旧单选入口；接入时必须补齐旧版继续/新开引导，不能悄悄更改 Attempt.lesson_version。
4. **提交与草稿的边界。** 正式答案至少要能提交、冻结、回看和导出。是否支持跨刷新草稿恢复、何时自动保存、并发 revision 与离开提醒，另行明确；不要把仅有正式提交说成已经支持草稿恢复。
5. **解释质量如何评价。** 优先把能力要求设计为可重复检查的结构化任务和情境判断。自由解释可先用于反馈；如果引入模型辅助点评，先约定额度、失败/超时与重试语义，不能让一次模型评价独自决定 Submission.passed，也不能用关键词或最低字数替代能力判断。

## 3. 当前前端草稿与拟议提交字段

当前草稿只存在 ConversationReview 的 React state，不写 localStorage/sessionStorage，不调用提交或草稿 API。刷新/离开会清空，可下载 Markdown。Markdown 不是现有 POST /submissions 接受的请求体，也不在原有 ZIP 导出中。

| 当前草稿字段 | 含义 | 正式接入要求 |
| --- | --- | --- |
| beforeId / afterId | 比较的两轮运行 ID | 必须属于请求者、同一 Attempt、相同 mode 与课程版本；运行已完成且有完整回答，改进轮须在之后，输入内容不能只是同一指令 |
| changeKind | 明确目标 / 补充限制 / 规定输出方式 | 与课程约定稳定枚举 ID，中文标签只用于显示 |
| requirement | 第二轮中新增或改写要求的原文 | 服务端核对原始 input_text；不允许引用不存在的内容或将两轮完全相同的片段算作新增 |
| beforeQuote / afterQuote | 两次完整回答的引用 | 正式字段需带 run_id、message_id、message.completed 事件序号及引用定位，服务端从持久化事件核验 |
| judgment | 满足要求 / 部分满足 / 没有满足 | 允许后两种判断，不以“第二次一定更好”为通过条件；与所引证据的评价规则须明确 |
| explanation | 判断理由 | 保存原文并按已约定规则反馈，不能以非空或长度直接评分 |
| nextInstruction | 未满足时准备修改的指令 | 部分/未满足时需要；是否计分由课程规则决定 |
| facts | start、place、end、signup 的已知/待确认判断 | 当前只是前端虚构练习。正式版应绑定 challenge_id 与课程版本，由后端加载正确依据 |
| instruction | 给变式任务补充的要求 | 保存并反馈；不能把填写任意文字当作掌握处理缺失信息的方法 |

建议继续使用 POST /submissions、GET /submissions/{id} 与列表/下载能力，扩展具名答案类型；是否新增草稿资源需另行协商。不需要为了表单变化另造一套平行的正式评分接口。

可供契约讨论的答案结构如下，**字段名和枚举尚未定稿**：

```json
{
  "kind": "reflection",
  "baseline_run_id": "run-before-example",
  "revised_run_id": "run-after-example",
  "change": { "category": "constraint", "quote": "未说明的信息先向我确认。" },
  "evidence": {
    "before": { "message_id": "message-before", "event_seq": 2, "quote": "示例原文" },
    "after": { "message_id": "message-after", "event_seq": 2, "quote": "另一段示例原文" }
  },
  "judgment": "partial",
  "explanation": "指出证据与要求之间的对应或不足。",
  "next_instruction": "为每个日期注明来源。",
  "challenge": {
    "challenge_id": "missing-information-example",
    "judgments": [{ "item_id": "end", "decision": "confirm" }],
    "instruction": "未知事项先确认，不补全。"
  }
}
```

示例只展示结构，不表示完整合法答案。服务端应从 Attempt 推导 owner、mode、lesson_version；禁止相信客户端传来的 passed、分数、correct 或“已做过实验”标记。

## 4. 服务端验证与评分（P1）

- 从数据库读取 Run 和事件，核对归属、状态及课程；拒绝其他实训、其他模式、未完成、失败或只有增量没有完整回答的运行。
- 使用可靠的持久化顺序确定前后关系，同时间戳也要有明确规则；不要比较不同 Run 的局部 seq 来决定先后。
- 校验引用确实存在于指定指令或指定 message.completed 的原始正文。明确 trim、换行和引用定位约定，不根据渲染后的 HTML 或任意拼接后的文本评分。重复语句必须能定位到所选消息；当前前端下载时只寻找第一个匹配事件，正式版需补齐明确消息选择。
- 引用真实只说明证据有效，不能单独说明判断正确。按 P0 确定的能力规则、正反例及版本化变式执行验收，分别给出必要项、反馈和 evidence_refs。
- 保留现有 formal/live 与 demo 隔离：正式完成仅由服务端 Submission.passed 决定，demo 通过不计通关；失败的尝试仍可被学生正确分析，不因回答质量不佳直接判学生不理解。
- 不可变提交需冻结答案、所用课程/变式版本及证据。保留已有幂等、expected_attempt_revision、运行忙碌/历史只读校验和失败快照清理，不引入重复计费或重放运行。
- GET 详情/历史能回看新答案与逐项反馈；ZIP 导出包含复盘答案、版本和证据定位，继续排除 Key、连接配置和内部令牌。旧提交保持旧格式和原成绩。

## 5. 契约与前端联动（P1）

1. 同一 PR 更新 contracts/openapi.json、lesson.schema.json、示例与必要的事件/错误说明；变式答案与评分数据只能留在服务端课程定义，公开接口不给正确答案。
2. 重新生成 contracts/types.d.ts 并通过结构校验；现有 discriminator 生成问题仍需注意，不能手改生成类型或修改线上值迎合生成器。
3. 更新 lessons.py 的发布语义检查、Grader 的答案验证/评分分支、提交存储和导出。现有 choice/facts/course/artifact 的兼容路径继续测试。
4. 前端改为根据新版课件的验收类型和版本选择模板。当前条件为 lesson.id === "01-task" && answer_form.kind === "choice"，只是预览接法；不要单独上线后端 reflection 类型而让前端退到未知表单。
5. 将本页草稿映射到已确认字段、补明确的消息/引用选择，接入真正的保存、提交与回看。正式接通并验收后，才移除“不生成正式成绩”的预览提示。

## 6. 必须交付的验证证据（P2）

| 测试方向 | 至少包含 |
| --- | --- |
| 正常及合理批判 | 有效两轮、真实引用、正确变式；允许“部分满足/没有满足”且有合理改进，而不是固定选正面判断 |
| 伪造与越界 | 其他 Attempt/owner/mode、失败或缺完整回答、相同指令、先后颠倒、伪造消息/事件/引用、重复语句定位、客户端传分数 |
| 版本与兼容 | 新旧课程并存，旧成绩不重算，旧活动实训有明确继续入口，新题目不套用旧答案，课件变式版本固定 |
| 提交可靠性 | 幂等重试、revision 冲突、运行中提交、事务/导出/响应失败后无半份快照，重启不会自动重跑或重新计费 |
| 记录与隐私 | 新答案可回看、导出与恢复行为符合已确认协议；无 Key、内部令牌、服务商敏感响应进入持久化或截图 |
| 浏览器联调 | 正常完整闭环、失败逐项反馈、刷新、历史只读、390px、正式与演示隔离；保留第二至四关的原有回归 |

完成后提供：最终契约及示例、新课程版本和发布说明、评分规则与正反例、后端测试结果、前端浏览器联调结果、必要截图，以及外部模型实测是否执行的单独记录。当前前端的 30 项浏览器测试通过不等于新的后端评分已经完成。

## 7. 维护入口与范围

- 前端：apps/web/src/components/conversation-review.tsx、feedback.tsx、app/practice/[id]/page.tsx；tests/e2e/conversation-review.spec.ts、learning.spec.ts。
- 后端：apps/api/src/agent_school/grading.py、submissions.py、lessons.py、exports.py；新回归放 apps/api/tests/。
- 契约/课件：contracts/、content/lessons/01-task/；第四关 task_id 指导仍是另一项待发布新版本的任务。
- 仓库存在并行的实训提示/弹窗工作（PR #9）。请基于最新 main 协调重叠的实训页及验收 UI，不能用整文件覆盖的方式丢弃任一方功能；该 PR 不属于本次要求合并的改动。

先完成 P0 对齐，再执行 P1 与 P2。新增登录、线上部署、任意工具或模型自动打分均不在本次已实现范围内。
