# 当前版本与文档索引

更新：2026-10-25。本地及 PR #9 分支整合 main PR #10 的复盘界面，并完成第一关新版正式复盘接入。交付分支为 [feat/practice-tips-and-feedback](https://github.com/2791243700-hue/agent-practice-lab/tree/feat/practice-tips-and-feedback)；main 基线为 `47108b2`，本次尚未合并主分支。

## 当前范围

- 四关导读、统一教学 Agent、Key 管理、工具授权和学习记录。
- 按需模型 Tips、顶部重置保留当前 Key/模型、Markdown 表格及提交结果弹窗。
- 第一关新版 1.1.0 四步复盘、自动保存/恢复、正式结构化验收、历史回看和导出；旧 1.0.0 继续使用旧规则和原成绩。
- 第二至四关继续使用真实事件和产物验收；演示不计正式通过。
- 41 个 HTTP 操作、102 个 schema、11 类事件；前后端使用共享契约。

本次本地验证：193 项后端、18 项前端、52 项浏览器全量及 231 项契约结构检查通过；格式、类型、生产构建通过。当前实现、保存/评分边界和本次验证以[统一交付记录](unified-practice-delivery.md)为准。2026-10-24 的[预览交付](reflection-assessment-delivery.md)和[后端接入清单](reflection-assessment-backend-handoff.md)保留为历史设计；2026-10-23 的[Tips 交付](practice-updates-2026-10-23.md)与[清理记录](cleanup-2026-10-23.md)保留历史验证数字。

## 已知边界

1. 自由解释和改写收集保存，正式成绩只覆盖约定的基础操作与结构化核对；模型建议单独展示。
2. Key 仅存后端内存，完整服务重启后重新输入；关卡重置无需重新配置。
3. 新流程使用本地脚本模型自动化验证，真实服务商和零经验学生独立验收仍须另行记录。
4. 第四关 task_id 指导、生成器 discriminator 适配、启动器前端 HTTP 就绪等待仍是独立待办，不在本次课程变更内。
5. 登录、班级、线上部署、多用户调度、任意代码执行及文件上传未实现；身份声明为扩展位置。

## 文档入口

| 用途 | 文档 |
| --- | --- |
| 安装和学习 | [使用说明](user-guide.md) |
| 当前交付与验证 | [统一实训](unified-practice-delivery.md)、[前端](frontend-validation.md)、[后端](runtime-validation.md) |
| 接口 | [契约](../contracts/README.md)、[OpenAPI](../contracts/openapi.json) |
| 接手开发 | [后端说明](backend.md)、[交接](backend-handoff.md)、[协调](backend-coordination.md) |
| 新版设计与计划 | [设计](superpowers/specs/2026-10-25-unified-practice-design.md)、[计划](superpowers/plans/2026-10-25-unified-practice.md) |
| 外部模型历史验证 | [真实模型记录](live-model-validation.md) |

历史 PR #1—#8 已完成原版及 Key/工作区功能；PR #10 为复盘预览已合并。本次基于这两个方向协调，不沿用旧 CI 结果证明当前提交。
