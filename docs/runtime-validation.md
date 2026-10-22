# 后端验证报告

更新：2026-10-22。当前实现包含 v0.1.0 的 37 个 HTTP 操作；已合并 main 的交付状态见[版本状态](project-status.md)。

## 实现与最近验证

| 范围 | 内容与结果 |
| --- | --- |
| 后端完整测试 | 91 项通过；包含 11 项模型目录/Key 管理及本轮新增的 33 项审查修复回归 |
| 契约结构 | 197 项检查通过：37 个操作、89 个 schema、21 个 HTTP 样例、6 个事件场景/11 类事件；类型已重新生成 |
| Python 质量检查 | Ruff check、format check 通过 |
| 联动前端 | 8 项前端、26 项浏览器测试及类型、格式、生产构建通过，见[前端报告](frontend-validation.md) |

后端使用 Python 3.11/3.12，AgentScope 固定为 2.0.10，依赖固定在 `apps/api/uv.lock`。本地自动化使用独立临时库/文件、MockTransport 或本地 HTTP 模型，不消耗外部模型额度。上述结果为本地验证，功能分支的云端 CI 结论以对应 PR 为准。

## 已覆盖的边界

- 课程导读、任务和材料按版本归档；归属检查、分页游标、设置 revision、幂等成功去重、不可变提交和导出。
- 真实 SDK 流式文本及工具循环；文本结束字段缺省时保留累计正文；原始工具参数先校验，不依赖 SDK 自动修正。
- 四种受控工具、保存逐次授权；拒绝无写入、批准两份产物原子发布、重复决定、过期、停止及重启恢复。
- 单执行槽、10 次调用/120 秒执行预算、独立授权等待预算；重启将活跃运行置 interrupted、未决授权取消，不自动重跑。
- 中文路径、父目录穿越、symlink/Windows junction 边界；此前本机 junction 测试实际执行通过。文件边界不是任意程序执行沙箱。
- 凭据不进入普通配置响应、数据库或导出；流式片段保留可能含 Key 的尾部，结束前统一脱敏，失败/取消丢弃尾部；工具参数与历史在持久化前遮盖。
- 新 Key 导入先取所选服务商模型列表，再创建配置；失败无残留，成功幂等重放不重复创建。Key 仅在内存，错误/模型元数据不能回显凭据，模型列表拒绝重定向和无效返回。
- 多 Key 独立清除/删除、配置占用限制、重启后缺凭据；只重命名保留检查，修改模型/地址/凭据使检查失效。
- 第四关先拒绝后保存，按私有的 SQLite 事件追加顺序跨 Run 比较；覆盖同钟、反向顺序和重开数据库，保留当前产物 ID/哈希关联，旧提交不重算。
- 提交前按本关校验答案；部分复制、评分、数据库写入、响应校验、幂等写入和最外层 commit 失败均清理本次快照，ID 碰撞保留旧目录。真实 Windows junction 回归确认外部文件不受清理影响；发现链接时拒绝递归删除并保留异常目录。
- 混合数字/文本、Unicode 非十进制数字及空分段的合法版本名可排序；发布和导入拒绝无必需规则、表单与 evaluator/答案引用不匹配、必读材料/表单来源/产物来源不存在的课程。
- Windows 启动器真实后台进程、数据目录进程锁、重复启动、端口占用、停止时核对本项目进程身份。此前跨平台测试已修正端口 TIME_WAIT 导致的误判。

## 外部实测与兼容性修复

2026-10-19 DeepSeek 文本/工具/工具结果检查和四关后端正式提交通过；第四关依赖额外任务 ID 映射提示。实测不含浏览器验收，完整边界见[实测记录](live-model-validation.md)。

PR #4 已修复官方 DeepSeek 默认 thinking 与强制工具选择冲突，以及 AgentScope 外部写工具权限回调必需的 message 字段。官方 DeepSeek 主机使用共享 provider options 关闭 thinking；兼容服务不会按名称套用该参数。应用工具网关仍独立执行逐次批准，SDK 回调不能绕过保存审批。

新增 Key 管理在 2026-10-22 只做自动化验证，未用私人 Key 实测 DeepSeek/OpenAI 的新导入和模型列表流程；模型列出也不证明 Chat Completions 与工具兼容。

## 复现命令

仓库根目录：

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

最后一条用于核对生成类型是否已同步；在尚未提交的契约变更工作目录中会显示预期差异，需审阅而不能将其当作生成失败。后端 CI 覆盖 Ubuntu/Windows × Python 3.11/3.12；具体结果绑定对应提交，不能以旧 CI 代表本地新改动。

## 当前限制与实施裁定

1. JSON 契约继续作为 HTTP 规范来源，路由校验请求/响应，内部 DTO 使用 Pydantic；尚未全量改为 Pydantic 导出。
2. 课程版本仍为 1.0.0，本次没有改评分；第四关任务 ID 说明需发布新课程版本修正。
3. 生成 TypeScript discriminator 差异仍由前端边界适配；后续修正生成方式并联动移除适配。
4. 启动器只等待 API 健康，尚未等待前端 HTTP 就绪。前端与代理已联合验证，不能再称为“尚无前端”。
5. 连接检查在长事务外执行；崩溃留下未确认幂等操作时，不自动重新计费。用户查看状态后用新操作键明确重试。
6. IdentityProvider/LocalIdentityProvider 仅保留声明，当前服务、存储与幂等链路固定 local-owner，尚未注入可替换身份；没有任意 shell、上传或自定义 MCP 执行。旧阶段采用普通 Git worktree，未由桌面托管工具管理。

审查修复的失败证据与逐项关闭状态见[审查记录](code-review-2026-10-22.md)。额外的契约 JSON Prettier 默认检查提示现有机器文件样式差异，本次保留原格式；项目契约校验、Web 格式和 Ruff 检查均通过。
