# 当前版本与文档索引

同步日期：2026-10-22。本文记录已合并的 main 状态与验证边界，其他文档的“当前”均以此范围为准。

## 代码交付状态

PR [#6](https://github.com/2791243700-hue/agent-practice-lab/pull/6) 与 [#7](https://github.com/2791243700-hue/agent-practice-lab/pull/7) 已依次合并到 main。#6 合并提交为 `e5a3458`，#7 合并提交为 `a8f7438`；后续文档同步提交在此基线上追加。安装和接手直接使用 main，无需再切换功能分支。

前端体验增量原分支为 `feat/practice-workspace-interactions`，基于 `b56182f` 开发；PR #6 合并后，#7 已改为以 main 为目标并完成合并。包含生活情境示例、输入区准备提醒、左侧可收起工作区、紧凑顶部及实训信息、立即显示问题与流式跟随。完整说明及截图见[实训工作区交付](practice-workspace-delivery.md)。本轮未改动后端、接口、课件包或评分。

公开仓库：[2791243700-hue/agent-practice-lab](https://github.com/2791243700-hue/agent-practice-lab)。契约、后端、前端、DeepSeek 适配和预览修复已通过 PR [#1](https://github.com/2791243700-hue/agent-practice-lab/pull/1)、[#2](https://github.com/2791243700-hue/agent-practice-lab/pull/2)、[#3](https://github.com/2791243700-hue/agent-practice-lab/pull/3)、[#4](https://github.com/2791243700-hue/agent-practice-lab/pull/4)、[#5](https://github.com/2791243700-hue/agent-practice-lab/pull/5) 合并。上述为历史基线 `3214d75`；当前已合并代码基线为 `a8f7438`（见上文）。

在历史基线 `3214d75` 上新增并已合并的功能包括：

- 模型设置以输入 Key 开始，支持 DeepSeek、OpenAI 和其他兼容接口，获取服务商模型列表后下拉选择。
- 多个 Key 可添加、切换、重命名、重新输入、清除或删除；凭据仍仅在后端内存保存。
- 新增 `POST /model-profiles/connect`、`GET /model-profiles/{profile_id}/models`；契约仍为 v0.1.0，共 37 个 HTTP 操作、89 个 schema、11 类事件。
- 学习记录显示开始日期与红/绿通关状态；实训页采用紧凑顶部，标题旁显示状态，日期、版本和模式收入实训信息。任务、材料设置和预览统一收纳为默认展开的左侧栏，输入区提醒在准备正确后消失；问题即时显示，回答分片呈现并跟随滚动。内部课程版本归档不变。
- 整体审查的问题已修复并合并：验收顺序、失败快照清理、课件语义/版本排序、历史原文预览及手动模型恢复，并清理确认无用的样式和代码；见[逐项关闭与复审](code-review-2026-10-22.md)。

## 验证状态

| 范围 | 最近完成的结果 | 边界 |
| --- | --- | --- |
| PR #6 基线本地自动化 | 197 项契约结构检查、91 项后端测试、8 项前端测试、15 项浏览器测试通过；Ruff、格式、类型和生产构建通过 | 模型使用 MockTransport 或本地脚本服务，无私人 Key；浏览器回归使用本机 Chrome，构建在隔离目录执行 |
| 本轮前端体验增量 | 8 项前端、26 项浏览器测试、Web 格式、类型和生产构建通过 | Playwright Chromium、临时数据和本地分段模型；没有私人 Key 实测，未重跑后端测试 |
| 云端 CI | PR #6 的 6 项检查全部通过；#7 的后端四环境与契约检查通过，前端检查在合并时仍排队 | #7 本地 8 项前端、26 项浏览器、类型与构建通过。合并后的 main 检查以 GitHub 对应提交为准，不把排队视为通过 |
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
