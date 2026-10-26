# 当前版本与文档索引

更新：2026-10-26。最近已合并版本为 [PR #13](https://github.com/2791243700-hue/agent-practice-lab/pull/13) 的 main `48e3147`，包含统一实训、第一关正式复盘、接口判别值映射及通知上下文修复。当前契约 v0.1.0：41 个 HTTP 操作、102 个 schema、11 类 SSE 事件。闲置样式与文档清理已经合并，见[清理记录](cleanup-2026-10-26.md)。本次模型连接恢复修复作为独立变更提交，合并状态以对应 PR 为准，见[修复与验证](model-connection-fix-2026-10-26.md)。

## 当前范围

PR #11 完成接口判别值映射；PR #12 修复第一关通知上下文，将材料原文放回材料区，限制四步复盘按顺序解锁，并将产物区标题简化为“产物”。具体行为见[实训修复记录](practice-fixes-2026-10-26.md)。

- 四关导读、统一教学 Agent、Key 管理、工具授权和学习记录。
- 按需模型 Tips、顶部重置保留当前 Key/模型、Markdown 表格及提交结果弹窗。
- 第一关新版 1.1.0 四步复盘、自动保存/恢复、正式结构化验收、历史回看和导出；旧 1.0.0 继续使用旧规则和原成绩。
- 第二至四关继续使用真实事件和产物验收；演示不计正式通过。
- 41 个 HTTP 操作、102 个 schema、11 类事件；前后端使用共享契约。

PR #12 合并时的验证：198 项后端、19 项前端单元、55 项浏览器回归及 231 项契约结构检查通过；main `1b2b788` 的[后端](https://github.com/2791243700-hue/agent-practice-lab/actions/runs/40330515797)、[前端](https://github.com/2791243700-hue/agent-practice-lab/actions/runs/40330515854)与[契约 CI](https://github.com/2791243700-hue/agent-practice-lab/actions/runs/40330515875)均通过。本次清理的验证单独记录在[清理记录](cleanup-2026-10-26.md)，不把此前结果算作本次重跑。

[统一交付](unified-practice-delivery.md)、[接口更新](interface-update-2026-10-26.md)、[实训修复](practice-fixes-2026-10-26.md)分别保留各次交付的范围与测试数字；2026-10-24 的预览、2026-10-23 的 Tips 和清理报告属于历史记录。

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

历史 PR #1—#8 完成原版及 Key/工作区功能；PR #10 为复盘预览，PR #9 完成正式整合，PR #11 修复生成类型映射，PR #12 完成通知与界面修复。历史报告中的提交号和测试数字仅对应各自日期。
