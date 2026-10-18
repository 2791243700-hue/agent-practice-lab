# Agent Practice Lab · Agent 入门实训平台

面向零使用经验学习者，通过文字导读和浏览器内实训，学习 Agent 的基本用途、任务设置、资料使用、工具调用与操作授权。

**当前状态：v0.1.0 本地前后端已接入。** 浏览器内可阅读四关导读、配置自备模型、运行实训、批准或拒绝保存、查看产物、提交验收和导出学习记录。不提供登录或线上部署。外部真实模型实测状态单独记录，脚本模型测试不代表服务商验证。

## 本地启动（Windows）

需要 Node.js 22+、Python 3.11/3.12 和 uv。在仓库根目录：

```powershell
uv sync --project apps/api --locked
npm --prefix apps/web ci
.\scripts\start.ps1
# 打开启动器显示的 http://127.0.0.1:3000
# 停止：.\scripts\stop.ps1
```

无需 Key 即可阅读课程。正式运行时，到“模型设置”填写服务商 API 根地址、模型 ID 和自备 Key，并主动进行连接检查。检查最多调用模型三次，可能消耗额度；不要把 Key 发到聊天或 PR。启动器自动将同一私有令牌交给前后端，不能只单独运行 npm dev。

使用 `scripts/start.ps1 -Demo` 可开启无 Key 演示；演示记录始终不计正式通过。安装、恢复、错误排查见[新手使用说明](docs/user-guide.md)；开发检查、截图见[前端验证](docs/frontend-validation.md)；真实模型测试见[独立实测记录](docs/live-model-validation.md)。

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
- [前端向后端开发者交接](docs/backend-handoff.md)

使用 Next.js + TypeScript、FastAPI、AgentScope SDK、SQLite 和 SSE。浏览器只调用同源 `/api/v1`，Next.js 服务端代理转发内部令牌；Key 只在后端内存中保存。前端类型来自 `contracts/types.d.ts`，已知生成器 discriminator 差异的边界适配见前端验证文档。

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
