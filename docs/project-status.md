# 当前版本与文档索引

同步日期：2026-10-22。本文区分远程已合并基线与当前本地工作目录，其他文档的“当前”均以此范围为准。

## 代码交付状态

本次交付分支：[`feat/key-manager-review-fixes`](https://github.com/2791243700-hue/agent-practice-lab/tree/feat/key-manager-review-fixes)；当前尚未合并到 main，PR 和云端 CI 以 GitHub 实际状态为准。

后续前端体验增量分支：`feat/practice-workspace-interactions`，基于 PR #6 的 `b56182f`，目标为上述基础分支。包含生活情境示例、输入区准备提醒、左侧可收起工作区、紧凑顶部及实训信息、立即显示问题与流式跟随。完整说明及截图见[实训工作区交付](practice-workspace-delivery.md)。本轮未改动后端、接口、课件包或评分。

公开仓库：[2791243700-hue/agent-practice-lab](https://github.com/2791243700-hue/agent-practice-lab)。契约、后端、前端、DeepSeek 适配和预览修复已通过 PR [#1](https://github.com/2791243700-hue/agent-practice-lab/pull/1)、[#2](https://github.com/2791243700-hue/agent-practice-lab/pull/2)、[#3](https://github.com/2791243700-hue/agent-practice-lab/pull/3)、[#4](https://github.com/2791243700-hue/agent-practice-lab/pull/4)、[#5](https://github.com/2791243700-hue/agent-practice-lab/pull/5) 合并。已核验的 main 基线为 `3214d75913f5a3a8276adfa6ad8bf6dfbe20721a`。

当前本地工作目录在该基线上新增以下功能，通过 `feat/key-manager-review-fixes` 分支交付、尚未合并到 main；不能用 main 的旧 CI 结果代表这些改动：

- 模型设置以输入 Key 开始，支持 DeepSeek、OpenAI 和其他兼容接口，获取服务商模型列表后下拉选择。
- 多个 Key 可添加、切换、重命名、重新输入、清除或删除；凭据仍仅在后端内存保存。
- 新增 `POST /model-profiles/connect`、`GET /model-profiles/{profile_id}/models`；契约仍为 v0.1.0，共 37 个 HTTP 操作、89 个 schema、11 类事件。
- 学习记录和实训页显示开始日期及绿色“已通关”或红色“未通关”；右上角仅保留问号和“帮助”。移除原本地运行、头像、侧栏底部标记及混合版本/日期/进度小字，内部课程版本归档不变。
- 整体审查的问题已在本地修复：验收顺序、失败快照清理、课件语义/版本排序、历史原文预览及手动模型恢复，并清理确认无用的样式和代码；见[逐项关闭与复审](code-review-2026-10-22.md)。

## 验证状态

| 范围 | 最近完成的结果 | 边界 |
| --- | --- | --- |
| PR #6 基线本地自动化 | 197 项契约结构检查、91 项后端测试、8 项前端测试、15 项浏览器测试通过；Ruff、格式、类型和生产构建通过 | 模型使用 MockTransport 或本地脚本服务，无私人 Key；浏览器回归使用本机 Chrome，构建在隔离目录执行 |
| 本轮前端体验增量 | 8 项前端、26 项浏览器测试、Web 格式、类型和生产构建通过 | Playwright Chromium、临时数据和本地分段模型；没有私人 Key 实测，未重跑后端测试 |
| 已合并 PR #1—#5 | 合并时对应检查通过 | 属于各自提交；新增功能的云端 CI 以本次 PR 对应提交为准 |
| 2026-10-19 外部模型 | DeepSeek 文本/工具检查及四关后端正式提交通过 | 第四关额外提供了任务 ID 映射；未完成真实服务商的浏览器或零经验学生独立验收 |
| 新增 Key 管理的外部验证 | 尚未执行 | 未使用真实 DeepSeek/OpenAI Key 验证新增导入与列表流程 |

自动化明细见[前端验证](frontend-validation.md)、[后端验证](runtime-validation.md)；外部实测见[真实模型记录](live-model-validation.md)。不将脚本模型、演示模式或模型列表成功当作外部工具兼容性证明。

## 已知待办

1. 第四关对 `save_todos` 所需 `task_id` 的说明不充分，现有文字未给出必要映射；实测通过依赖额外提示。需要发布新的课程版本并复测零经验流程，不能直接改写已归档的 1.0.0 课程。
2. 生成的 TypeScript discriminator 仍有 schema 名称与线上常量差异，前端保留边界适配；需修正生成方式后联动移除。
3. 启动器等待 API 健康，但未等待前端 HTTP 就绪，首次页面可能需要稍等刷新。
4. 登录、班级、线上部署、多用户调度、任意代码执行和文件上传均未实现。身份接口仅为预留声明，尚未接入固定 local-owner 链路；运行、凭据和存储模块保留扩展位置。

## 文档入口

| 读者/用途 | 文档 |
| --- | --- |
| 安装、输入 Key、学习与排错 | [新手使用说明](user-guide.md) |
| 后端启动与代理联调 | [后端开发说明](backend.md) |
| 请求、错误、幂等和事件 | [契约说明](../contracts/README.md)、[OpenAPI](../contracts/openapi.json) |
| 前后端接手与已知问题 | [交接说明](backend-handoff.md)、[协调记录](backend-coordination.md) |
| 设计背景和原始任务拆分 | [设计](../outputs/local-agent-learning-design.md)、[实施计划](../outputs/local-agent-learning-implementation-plan.md)、[双人协作](../outputs/two-person-github-collaboration-plan.md) |
| 本次 Key 管理实现记录 | [2026-10-22 计划与验证](superpowers/plans/2026-10-22-key-manager.md) |

`content/lessons/` 是已发布的课程内容，`outputs/lesson-introductions.md` 是原始导读设计稿；运行时以课程包及其归档版本为准。原实施计划的未勾选框保留历史，不作为当前待办清单。
