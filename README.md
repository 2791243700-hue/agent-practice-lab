# Agent Practice Lab · Agent 入门实训平台

面向零使用经验学习者，通过文字导读和浏览器内实训，学习 Agent 的基本用途、任务设置、资料使用、工具调用与操作授权。

**当前状态：v0.1.0 后端已实现，前端待接入。** 后端可本地启动并提供课程、Agent 运行、工具授权、规则评分和导出；当前尚无学生浏览器界面或在线演示。接口契约与后端均可独立验证。

## 首版范围

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
- [v0.1.0 接口契约与调用规则](contracts/README.md)（35 个 HTTP 操作、11 类事件）
- [机器可读 OpenAPI](contracts/openapi.json)与[生成的 TypeScript 类型](contracts/types.d.ts)
- [后端安装、启动与前端联调](docs/backend.md)
- [后端验证报告](docs/runtime-validation.md)

拟采用 Next.js + TypeScript、FastAPI、AgentScope SDK、SQLite 和 SSE。依赖兼容性与真实模型调用将在实施阶段验证。

## 双人协作

| 角色 | 主要负责 |
| --- | --- |
| A | 前端页面、课程内容、模拟接口、浏览器测试和使用说明 |
| B | 后端接口、Agent 执行、数据存储、工具授权、规则评分和启动脚本 |

以 contracts/ 中的 v0.1.0 契约开始并行开发；先完成第一关闭环，再扩展其余三关。前端使用类型和模拟样例，后端落实接口和业务约束。使用短期功能分支和 Pull Request 合并到 main。

```powershell
git clone https://github.com/2791243700-hue/agent-practice-lab.git
cd agent-practice-lab
git switch -c feat/lesson-intro
```

上述命令用于获取项目并开始开发。后端在 apps/api 执行 uv sync --locked 安装依赖，Windows 从根目录运行 scripts/start.ps1 启动；详细环境、令牌和接入说明见后端文档。第二名开发者需要仓库写权限才能直接推送分支，也可通过 fork 提交 PR。

## 计划中的代码组织

```text
apps/web/        前端
apps/api/        后端与 Agent（已实现）
content/lessons/ 四关导读、材料和模板（已有基础课程包）
contracts/      HTTP 与事件契约、生成类型和校验工具（当前已有）
tests/e2e/      浏览器验收
scripts/        Windows 本地启停
outputs/        已确认的设计与计划（当前已有）
```

API Key、个人连接信息、实验数据、数据库和日志不进入源码仓库。运行时凭据按设计仅保存在后端进程内存。
