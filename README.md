# Agent Practice Lab · Agent 入门实训平台

面向零使用经验学习者，通过文字导读和浏览器内实训，学习 Agent 的基本用途、任务设置、资料使用、工具调用与操作授权。

**当前状态（2026-10-24）：v0.1.0 本地前后端已接入，第一关采用复盘验收预览。** 可阅读四关、管理自备 Key、运行实训、审批和查看产物、回看历史与导出记录。第一关已移除旧单选提交入口，新复盘尚未接入正式评分，完成后不会新生成通关成绩；第二至四关继续按真实事件及内容正式验收。无需登录，不提供线上部署。完整范围见[版本状态](docs/project-status.md)。

## 本地启动（Windows）

需要 Node.js 22+、Python 3.11/3.12 和 uv。在仓库根目录：

```powershell
uv sync --project apps/api --locked
npm --prefix apps/web ci
.\scripts\start.ps1
# 打开启动器显示的 http://127.0.0.1:3000
# 停止：.\scripts\stop.ps1
```

无需 Key 即可阅读课程。正式运行时，到“模型设置”添加自备 Key，确认服务商，获取模型列表后选择模型并主动检查连接。DeepSeek、OpenAI 自动填写官方地址；其他兼容接口保留自定义地址和手动模型入口。Key 格式只用于建议，无法判断时需选择服务商；不会逐家试探。连接检查最多调用模型三次，可能消耗额度。不要把 Key 发到聊天或 PR。启动器自动将同一私有令牌交给前后端，不能只单独运行 npm dev。首次页面启动较慢时稍等后刷新。

使用 `scripts/start.ps1 -Demo` 可开启无 Key 演示；演示记录始终不计正式通过。安装、恢复、错误排查见[新手使用说明](docs/user-guide.md)；开发检查、截图见[前端验证](docs/frontend-validation.md)；真实模型测试见[独立实测记录](docs/live-model-validation.md)。

## 首版范围

首页在至少一把 Key 已配置后隐藏准备提示，全部凭据缺失后恢复。第一关四步复盘可引用、标亮并下载对话依据；草稿刷新或离开后清空，不在原有 ZIP 中。功能、截图与验证见[本次交付](docs/reflection-assessment-delivery.md)，正式接入见[后端工作清单](docs/reflection-assessment-backend-handoff.md)。

- 本地运行、浏览器操作；学生自行申请并配置模型服务 API Key。
- 使用统一教学 Agent，每关先读介绍，再实践并查看反馈。
- 验收结合真实操作过程、任务结果和概念理解；模拟运行不计正式通过。
- 登录和线上部署保留扩展接口，首版不建设账号系统或云端服务。

## 四个入门关卡

1. **让 Agent 理解任务**：描述目标、约束和输出要求。
2. **给 Agent 足够的资料**：理解上下文、材料读取与来源核对。
3. **让 Agent 使用工具**：查看工具输入、执行结果和信息使用过程。
4. **管理权限并检查成果**：练习拒绝和批准，检查产物并提交。

## 设计文档

- [本地版设计与架构](outputs/local-agent-learning-design.md)
- [四关导读](outputs/lesson-introductions.md)
- [分阶段实施计划](outputs/local-agent-learning-implementation-plan.md)
- [双人分工与 GitHub 协作](outputs/two-person-github-collaboration-plan.md)
- [v0.1.0 接口契约与调用规则](contracts/README.md)（37 个 HTTP 操作、11 类事件）
- [机器可读 OpenAPI](contracts/openapi.json)与[生成的 TypeScript 类型](contracts/types.d.ts)
- [后端安装、启动与前端联调](docs/backend.md)
- [后端验证报告](docs/runtime-validation.md)
- [前端向后端开发者交接](docs/backend-handoff.md)

使用 Next.js + TypeScript、FastAPI、AgentScope SDK、SQLite 和 SSE。浏览器只调用同源 `/api/v1`，Next.js 服务端代理转发内部令牌；Key 只在后端内存中保存。前端类型来自 `contracts/types.d.ts`，已知生成器 discriminator 差异的边界适配见前端验证文档。

多个 Key 可切换、重命名、清除或删除；重启需重新输入 Key。列表成功不等于工具兼容，正式运行仍要求连接检查通过。旧成绩保留，演示与第一关新复盘都不伪造正式通过。2026-10-24 前端单元 8 项、浏览器 30 项及类型/格式/隔离构建通过；后端 91 项与契约 197 项是原有基线，本次未修改或重跑。外部模型与第四关教学限制见[实测记录](docs/live-model-validation.md)。

## 双人协作

| 角色 | 主要负责 |
| --- | --- |
| A | 前端页面、课程内容、模拟接口、浏览器测试和使用说明 |
| B | 后端接口、Agent 执行、数据存储、工具授权、规则评分和启动脚本 |

原版四关闭环、Key 管理、工作区及文档已通过 PR #1—#8 合并，本次以前一版 main `55ce473` 为开发基线，选择性替换第一关验收 UI。新正式评分仍待前后端协调，第二至四关与旧成绩保留。后续使用短期分支与 PR；接口、评分或课件变更同步契约、新版本和测试。原工作区历史记录见[交付说明](docs/practice-workspace-delivery.md)。

```powershell
git clone https://github.com/2791243700-hue/agent-practice-lab.git
cd agent-practice-lab
git switch -c feat/lesson-intro
```

上述命令用于获取项目并开始开发。后端在 apps/api 执行 uv sync --locked 安装依赖，Windows 从根目录运行 scripts/start.ps1 启动；详细环境、令牌和接入说明见后端文档。第二名开发者需要仓库写权限才能直接推送分支，也可通过 fork 提交 PR。

## 代码组织

```text
apps/web/        Next.js 前端、同源代理、前端依赖锁文件
apps/api/        后端与 Agent（已实现）
content/lessons/ 四关导读、材料和模板（已有基础课程包）
contracts/      HTTP 与事件契约、生成类型和校验工具（当前已有）
tests/e2e/      浏览器验收
scripts/        Windows 本地启停
outputs/        已确认的设计与计划（当前已有）
```

API Key、个人连接信息、实验数据、数据库和日志不进入源码仓库。运行时凭据按设计仅保存在后端进程内存。
