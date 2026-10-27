# 接口确定结果：v0.1.0

首次确定：2026-10-17；同步：2026-10-27。现行契约为 **41 个 HTTP 操作、109 个 schema、11 类 SSE 事件**，通过同源 `/api/v1` 访问。完整规范为 [contracts/README.md](../contracts/README.md)，机器可读文件为 [OpenAPI](../contracts/openapi.json)、[事件 Schema](../contracts/events.schema.json)、[课程 Schema](../contracts/lesson.schema.json)和[生成类型](../contracts/types.d.ts)。

| 模块 | 现行约定 |
| --- | --- |
| 身份与模型 | local-owner；多个模型连接；Key 仅存后端内存，重启需重新输入 |
| 模型发现与检查 | connectProfile、listProfileModels；服务商目录不替代文本/工具连接检查 |
| 课程与实训 | 固定 Attempt.lesson_version；最新第一关 1.2.0，其余三关 1.1.0，旧实验保持原规则 |
| 运行与过程 | 单模型槽、设置快照、幂等启动、取消；SSE 按 seq 恢复，不重发运行 |
| 授权与文件 | 逐次批准/拒绝；实际 tool.completed 成功后才显示已保存，提交冻结文件 |
| 复盘草稿 | GET/PUT reflection-draft；独立 revision，保存不等于提交或调用模型 |
| 正式验收 | 复用 POST /submissions；新正式课程需 assessment 同意及选定模型，其余三关另填 learning_reflection；客观项和模型项共同决定通过 |
| 模型反馈 | Submission.model_assessment 保存状态、逐项结论、引用、建议、模型及用量；无效/不可用结果不能通关 |
| 模型 Tips | GET/POST /runs/{run_id}/tips，主动确认、按轮缓存，只给建议、不改成绩 |
| 历史与导出 | 读取不可变提交、快照文件和 ZIP；不导出连接配置、Key 或内部令牌 |

本次没有新增 HTTP 路径或 SSE 种类；SubmissionCreate、Submission、LessonDetail 通过可选字段兼容扩展，是否强制模型验收由固定课程版本的 assessment_policy 决定。客户端不得提交 passed、评分报告或身份，正式通关始终读取服务器 Submission.passed；demo 始终不计正式通过。

模型验收在长数据库事务之外等待；客观证据不合格不调用模型；相同幂等键不重复计费。结果不明确时保留 pending、阻止原键重发。详见[正式模型验收与错误处理](../docs/model-assessment-2026-10-27.md)。草稿、正式答案、Unicode 引用偏移、历史兼容见[复盘接入](../docs/reflection-assessment-backend-handoff.md)。

OpenAPI、事件副本和课件 Schema 结构由验证脚本核对，TypeScript 自动生成。2026-10-27 本地结构验证为 244 项、27 个 HTTP 示例、6 个事件场景；动态测试与云端检查分开记录于[版本索引](../docs/project-status.md)。脚本结果不能代替真实服务商判断质量验证，历史外部测试见[独立记录](../docs/live-model-validation.md)。
