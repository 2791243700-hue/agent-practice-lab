# 接口确定结果：v0.1.0

首次确定：2026-10-17；同步：2026-10-22。范围：本地单用户 Agent 教学平台的 v0.1.0 接口。前后端已实现，新增 Key 导入/目录功能已通过 PR #6 合并到 main，前端体验增量随 PR #7 合并，详见[版本状态](../docs/project-status.md)。

完整说明见 [contracts/README.md](../contracts/README.md)。机器可读文件包括 [OpenAPI](../contracts/openapi.json)、[事件 Schema](../contracts/events.schema.json)、[课程模板 Schema](../contracts/lesson.schema.json) 和 [TypeScript 类型](../contracts/types.d.ts)。

| 模块 | 本次确定的内容 |
| --- | --- |
| 身份与配置 | local-owner；Key 仅进后端内存，多个连接可切换、重命名、清除或删除；非敏感配置持久化 |
| 模型发现 | connectProfile、listProfileModels；DeepSeek/OpenAI 官方地址和兼容服务手动入口；列表不代表工具检查通过 |
| 课程与实训 | 每关导读、固定课件版本、独立实训、材料选择和恢复 |
| Agent 运行 | 单运行槽、幂等启动、设置快照、取消和中断 |
| 过程事件 | 11 类 SSE 事件，按序号重放并去重 |
| 工具授权 | 明确的保存参数、逐次批准/拒绝、过期和取消失效 |
| 验收 | 每关答案结构、规则结果、证据引用和不可变提交 |
| 文件与导出 | 按 ID 获取预览/附件；提交下载读取冻结快照 |

37 个 HTTP 操作、89 个 schema，统一使用 /api/v1，11 类事件不变。前端不执行评分，不提交身份和证据，不接触后端的私有运行令牌。真实/演示模式在创建实训时确定，演示即使规则通过也不能获得正式完成状态。

两端使用同一 JSON 契约：路由边界校验，内部使用 Pydantic，尚未全量切换模型导出。TypeScript 类型重新生成，discriminator 差异暂由前端边界适配；不手改生成文件。变更联动接口、事件副本、实现、测试和文档。

2026-10-22 已通过 197 项 OpenAPI/JSON Schema、样例、非法输入及生成类型结构检查；动态行为另有 91 项后端、8 项前端及 26 项浏览器测试。外部 DeepSeek 后端实测及第四关限制见[独立记录](../docs/live-model-validation.md)，不以结构校验代替运行实测。契约复现命令见完整说明。
