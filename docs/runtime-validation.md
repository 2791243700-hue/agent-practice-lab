# 后端验证报告

日期：2026-10-17。范围：后端 B 的实现；前端页面与浏览器端到端验收待 A 接入。

## 实现范围

- 35 个 v0.1.0 HTTP 操作；请求、JSON 响应和事件按现有契约校验。
- 四个版本化课程包及导读，本地身份、独立实训、设置快照、分页和幂等。
- AgentScope 2.0.10 的 Agent.reply_stream 与外部工具执行适配；SDK 参数修复前先校验原始工具参数。
- 四种受控工具、逐次授权、拒绝不写入、文件组原子发布、取消、超时与恢复。
- SQLite + SQLAlchemy，Alembic 初始迁移，事件持久化、SSE 重放和提交快照。
- 规则评分、证据引用、快照附件与 ZIP 导出；演示评测不能使正式课程完成。
- Windows 后台启动器、项目进程停止、同数据目录 OS 锁、端口占用检查。

## 已执行的验证

本地环境：Windows、Python 3.12.14、Node.js 24.16.0。SDK 与全部直接/间接 Python 依赖固定在 apps/api/uv.lock。

- AgentScope 探针先出现 5 个缺实现失败，再实现并通过读取、拒绝、批准、取消和异常参数测试。
- 课程/实验与凭据/连接检查分别先出现缺实现失败，再完成；Alembic upgrade head 连续执行两次成功。
- 工具、授权和运行测试覆盖实际文件写入、重复决定、过期、中文路径以及 Windows junction；此次本机 junction 测试已执行，通过，没有跳过。
- 评分/导出先出现 5 个缺操作失败，再实现并通过四关验收、错误事实反馈、演示不计正式通过、产物篡改与不可变旧提交测试。
- 使用本地 HTTP 测试提供商走真实 Chat Completions 格式、AgentScope 流式调用、模型兼容性检查和第一关正式评分链路；这是测试服务，不是外部模型服务。
- 恢复测试验证 active Run 变为 interrupted、pending Approval 失效、进度可读；执行预算不包含授权等待，不能发生第 11 次模型调用。
- 启动器测试执行真实后台进程，验证空格/中文数据目录、重复启动、停止及外部端口占用；修正了 Windows 虚拟环境启动进程 PID 与实际 Python PID 不一致的问题。
- 同数据目录第二服务启动被拒绝。Key 不出现在普通配置响应、数据库和导出；误粘到指令中的已配置 Key 会在持久化前被遮盖。
- 错误游标返回 CURSOR_INVALID；列表游标绑定资源及过滤条件，不能跨实训或资源列表使用。

完整后端测试共 41 项；另有 191 项契约结构检查。CI 结果以本分支 PR 中的实际运行结果为准。报告不把格式校验、脚本模型或本地 HTTP 服务称为真实外部模型验证。

## 独立审查与修正

一次全分支独立审查发现两处重要问题，均先用测试 Key 复现失败后修复：

- 模型把 Key 拆在多个流式片段中输出，逐片遮盖仍可能在事件重放时拼回。现在为每条消息保留可能包含未完整 Key 的尾部，只发布安全片段；完成时遮盖尾部，失败或取消时丢弃尾部。回归测试覆盖完成、失败、取消三种终态。
- 工具参数中的 Key 可能进入授权记录及 Run.pending_approval。现在在工具入口冻结参数前统一遮盖，授权展示和实际执行使用同一份处理后的参数；SDK 后续消息中的完整文本和工具参数也在进入历史前处理。

云端首次检查暴露了 Ruff 根据运行目录推断导入分类不一致的问题；显式指定源目录与模块分类，保证仓库根目录与 apps/api 中运行结果一致。

## 复现命令

在仓库根目录：

```powershell
uv sync --project apps/api --locked
uv run --project apps/api pytest apps/api/tests -q
uv run --project apps/api ruff check --config apps/api/pyproject.toml apps/api/src apps/api/tests
uv run --project apps/api ruff format --check --config apps/api/pyproject.toml apps/api/src apps/api/tests apps/api/alembic
cd contracts
npm ci
npm run validate
npm run types
git diff --exit-code -- types.d.ts
```

GitHub Actions 增加 Ubuntu/Windows、Python 3.11/3.12 四组后端检查；云端结果以 Actions 实际结论为准。

## 明确的交接与限制

1. 未提供学生 Key，外部服务商的真实调用、额度与兼容性尚未实测；学生通过本地设置页接入后再验收。
2. 前端、Next.js 同源代理和浏览器体验归 A；启动器已约定私有环境变量，但尚未与真实前端联合启动。
3. 当前保留 JSON 契约为 HTTP 规范来源，内部运行对象使用 Pydantic；全量迁移到 Pydantic 导出并不是本次已完成事项。
4. 基础课程包来自已确认导读与固定虚构资料，A 可继续润色；已发布课程版本不可原地改写。
5. 桌面应用工作区工具报告 Git 不可用，本次使用普通 Git worktree 隔离；该工作区不受桌面应用的托管归档工具管理。
6. 审查中的一项次要问题留待前端接入：启动器等待 API 健康，但尚未等待前端 HTTP 就绪。首次前端启动较慢时，需等页面服务就绪再访问；当前无前端，不能把 API 就绪解释为完整界面可用。

## 实施裁定

- 后端提供最小四关课程包，使接口、工具和评分可独立验证；后续内容润色需与 A 协调并发布新版本。
- JSON HTTP 契约继续作为规范，路由边界校验，内部运行类型使用 Pydantic；完整 Pydantic 导出迁移延后，避免本次无意变更已约定接口。
- 连接检查在数据库长事务之外执行。检查期间崩溃保留未确认幂等操作，不自动重新计费；恢复时需查看状态并用新的操作 key 明确重试。
- 工具与运行生命周期互相依赖，因此实现计划中的工具、授权和运行任务合并提交；不影响对外接口和两人分工。
- Next.js 代理、浏览器端到端验收、真实外部提供商测试不属于此次已验证范围；本地文件边界也不宣称提供任意程序执行的 OS 沙箱。
