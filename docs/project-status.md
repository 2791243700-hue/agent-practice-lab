# 当前版本与文档索引

更新：2026-10-26。统一实训已通过 [PR #9](https://github.com/2791243700-hue/agent-practice-lab/pull/9) 合并到 main `af36497`，包含第一关 1.1.0 正式复盘、草稿恢复、Tips 和提交弹窗。当前契约 v0.1.0：41 个 HTTP 操作、102 个 schema、11 类 SSE 事件。 main 的前端、后端及契约 CI 均通过；本地服务是否加载新版取决于实际启动版本。

## 当前范围

2026-10-26 后续修复：PR #11 已将接口判别值映射合并 main 94481d8。本次增量修复第一关通知上下文，材料区内联原文、复盘顺序解锁及产物标题；范围与验证见[实训修复记录](practice-fixes-2026-10-26.md)。

- 四关导读、统一教学 Agent、Key 管理、工具授权和学习记录。
- 按需模型 Tips、顶部重置保留当前 Key/模型、Markdown 表格及提交结果弹窗。
- 第一关新版 1.1.0 四步复盘、自动保存/恢复、正式结构化验收、历史回看和导出；旧 1.0.0 继续使用旧规则和原成绩。
- 第二至四关继续使用真实事件和产物验收；演示不计正式通过。
- 41 个 HTTP 操作、102 个 schema、11 类事件；前后端使用共享契约。

本次本地验证：193 项后端、18 项前端、52 项浏览器全量及 231 项契约结构检查通过；格式、类型、生产构建通过。当前实现、保存/评分边界和本次验证以[统一交付记录](unified-practice-delivery.md)为准。2026-10-24 的[预览交付](reflection-assessment-delivery.md)保留为历史设计；[后端接入说明](reflection-assessment-backend-handoff.md)已更新为正式协议；2026-10-23 的[Tips 交付](practice-updates-2026-10-23.md)与[清理记录](cleanup-2026-10-23.md)保留历史验证数字。

## 已知边界

1. 自由解释和改写收集保存，正式成绩只覆盖约定的基础操作与结构化核对；模型建议单独展示。
2. Key 仅存后端内存，完整服务重启后重新输入；关卡重置无需重新配置。
3. 新流程使用本地脚本模型自动化验证，真实服务商和零经验学生独立验收仍须另行记录。
4. 第四关 task_id 指导、启动器前端 HTTP 就绪等待仍待完善。discriminator 映射及适配清理已完成，见[接口更新](interface-update-2026-10-26.md)。
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

历史 PR #1—#8 已完成原版及 Key/工作区功能；PR #10 为复盘预览已合并。PR #9 已将两个方向合并；核验的是 main af36497 的检查结果。
