# 接口确定结果：v0.1.0

首次确定：2026-10-17；同步：2026-10-26。更新：2026-10-26。统一实训已通过 [PR #9](https://github.com/2791243700-hue/agent-practice-lab/pull/9) 合并到 main `af36497`，包含第一关 1.1.0 正式复盘、草稿恢复、Tips 和提交弹窗。当前契约 v0.1.0：41 个 HTTP 操作、102 个 schema、11 类 SSE 事件。

完整说明见 [contracts/README.md](../contracts/README.md)。机器可读文件包括 [OpenAPI](../contracts/openapi.json)、[事件 Schema](../contracts/events.schema.json)、[课程模板 Schema](../contracts/lesson.schema.json) 和 [TypeScript 类型](../contracts/types.d.ts)。

| 模块 | 本次确定的内容 |
| --- | --- |
| 身份与配置 | local-owner；Key 仅进后端内存，多个连接可切换、重命名、清除或删除；非敏感配置持久化 |
| 模型发现 | connectProfile、listProfileModels；DeepSeek/OpenAI 官方地址和兼容服务手动入口；列表不代表工具检查通过 |
| 课程与实训 | 每关导读、固定课件版本、独立实训、材料选择和恢复 |
| Agent 运行 | 单运行槽、幂等启动、设置快照、取消和中断 |
| 模型 Tips | GET/POST `/runs/{run_id}/tips`；主动确认后生成，按运行缓存，不参与正式评分 |
| 过程事件 | 11 类 SSE 事件，按序号重放并去重 |
| 工具授权 | 明确的保存参数、逐次批准/拒绝、过期和取消失效 |
| 复盘草稿 | GET/PUT reflection-draft；独立 revision + expected_attempt_revision，保存不等于提交 |
| 验收 | 新版 ReflectionAnswers 和旧 choice/facts/course/artifact，服务端规则、证据引用和不可变提交 |
| 文件与导出 | 按 ID 获取预览/附件；提交下载读取冻结快照 |

41 个 HTTP 操作、102 个 schema，统一使用 /api/v1，11 类事件不变。前端不执行评分，不提交身份和证据，不接触后端的私有运行令牌。真实/演示模式在创建实训时确定，演示即使规则通过也不能获得正式完成状态。

Tips 与正式复盘已通过 [PR #9](https://github.com/2791243700-hue/agent-practice-lab/pull/9) 合并 main。重置保留内存 Key 与所选模型，提交后的弹窗和下一关跳转属于前端交互，不新增 HTTP 操作。Tips 的 evidence 字段仅保留旧数据兼容，新生成结果为空，界面不展示。

两端使用同一 JSON 契约：HTTP 边界与 School 共用一个 Contracts 实例，路由边界校验，内部使用 Pydantic，尚未全量切换模型导出。TypeScript 类型由 OpenAPI 生成，四组 discriminator 已显式映射到实际字段值，前端直接复用；不手改生成文件。接口更新见[接口更新](../docs/interface-update-2026-10-26.md)。变更联动接口、事件副本、实现、测试和文档。

当前契约：231 项结构检查，覆盖 41 操作、102 schema、25 个 HTTP 样例和 6 个事件场景；合并前 193 后端/18 前端/52 浏览器测试通过，main af36497 三类 CI 通过。测试使用本地模型服务，外部模型历史实测见[独立记录](../docs/live-model-validation.md)，不将结构校验作为真实服务商验证。

新版 1.1.0 复盘复用 /submissions；旧 1.0.0 不变。详细调用顺序、字段映射、引用码点和冲突恢复见[复盘接入说明](../docs/reflection-assessment-backend-handoff.md)。完整端点、状态码、幂等和所有字段约束统一维护于[契约说明](../contracts/README.md)，不要继续使用旧预览文档中的拟议字段。
