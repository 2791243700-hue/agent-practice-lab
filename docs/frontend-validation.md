# 前端交付与验证记录

更新：2026-10-22。远程基线与本地新增功能见[版本状态](project-status.md)。以下最近结果对应当前本地源码，云端 CI 结果以本次功能分支 PR 的实际检查为准。

## 已实现的流程

四关课程与固定版本导读、开始/继续、模型与内存 Key 配置、主动连接检查、任务/材料/设置、消息与工具过程、逐次批准/拒绝、预览下载、理解与事实核对表单、提交反馈与历史快照、学习记录及 ZIP 导出。

2026-10-22 新增 Key 优先设置：服务商格式建议、DeepSeek/OpenAI 官方地址、实际模型列表选择、兼容接口自定义地址及手动模型入口。多个 Key 可添加、切换、重命名、重新输入、清除和删除；仅重命名保留检查结果，切换模型需重新检查。Key 输入提交后清空，不进入浏览器持久存储；API 幂等操作缓存仅保留请求体的 SHA-256 指纹。

学习记录右侧和实训页显示上海时区开始日期，以及带图标和文字的绿色“已通关”或红色“未通关”。演示不能显示正式通关；已被重置的旧正式通过记录保留原结果。移除本地运行、头像、侧栏底部和混合版本小字，顶栏仅保留问号及“帮助”；内部课件版本与历史归档不变。

浏览器只调用同源 `/api/v1`，代理校验 Host 与写 Origin，内部令牌只在服务端注入，SSE 流式转发。刷新分页读取事件，再按序号续接，不重新发起运行。完整消息替换增量，重复事件去重；批准决定与实际保存成功分别展示。正式完成由后端决定。`src/lib/types.ts` 暂留生成类型 discriminator 的边界适配。

## 最近完成的本地检查

| 检查 | 2026-10-22 结果 |
| --- | --- |
| 前端类型、格式与生产构建 | 通过；默认开启 noUnusedLocals/noUnusedParameters，构建在隔离目录完成 |
| 前端测试 | 8 项通过，含事件恢复、契约常量、代理与响应丢失后的幂等手动重试 |
| 浏览器回归 | 15 项通过：8 项学习流程、2 项预览、2 项日期/通关布局、2 项 Key 管理、1 项历史只读预览 |
| 后端与契约 | 91 项后端、197 项契约结构检查通过；Ruff 与格式通过，详见[后端报告](runtime-validation.md) |

本次浏览器回归在 Windows 使用已安装的 Chrome；测试服务启动隔离 FastAPI、AgentScope 2.0.10 和本地确定性 HTTP 模型，使用虚构凭据与临时数据。它不访问学生 Key 或日常学习库。`mode=live` 用于验证正式评分分支，不证明外部服务兼容。

覆盖的流程包括：无 Key 导读、390px 布局、认证失败、模型列表和兼容接口手动回退、多个 Key 独立管理、模型切换/重命名的检查状态、清除/删除与重启后实际重输 Key 并完成连接检查；手动模型刷新/重入不误报目录失败、错误 Key 仍报认证错误、连接检查仅刷新一次配置；两轮任务、反馈、演示隔离、刷新/临时 SSE 503 续接且运行 POST 不增加；审批时刷新、拒绝无写入、批准实际保存；产物和冻结快照下载、导出、重置、停止与重启恢复；预览自动滚动、关闭后恢复键盘焦点、历史材料只读预览和下载；桌面右侧状态和移动端无横向溢出。

## 复现

先从根目录运行 `uv sync --project apps/api --locked`，再执行：

```powershell
cd apps/web
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Windows 启动器专项；使用 3200/8200 与隔离数据目录
npm run test:launcher
```

标准 e2e 使用 3100/8100/8101；可通过 `AGENT_SCHOOL_TEST_PYTHON` 指定后端 Python。不要同时在同一目录运行 typecheck、build、dev，以免争用 Next.js 生成目录。此前 Windows 启动器专项已通过；本次没有重新运行该专项，不将旧结果计入 15 项浏览器测试。

## 截图

以下为自动化测试场景，不代表真实服务商实测。截图不包含真实 Key；测试连接地址、模型名和记录均为虚构样例。

| 页面 | 截图 |
| --- | --- |
| 课程入口 | [课程列表](screenshots/01-courses.png) |
| 第一关导读 | [导读](screenshots/02-introduction.png) |
| 模型设置 | [检查状态](screenshots/03-model-settings.png) |
| 第一关反馈 | [两轮回答与反馈](screenshots/04-first-lesson-feedback.png) |
| 保存授权 | [批准/拒绝](screenshots/05-save-approval.png) |
| 产物与验收 | [产物与反馈](screenshots/06-artifacts-feedback.png) |
| 移动布局 | [390px 课程列表](screenshots/07-mobile-courses.png) |
| 多 Key 管理 | [桌面](screenshots/08-key-manager-desktop.png)、[移动](screenshots/09-key-manager-mobile.png) |
| 日期与通关列 | [桌面](screenshots/10-records-desktop.png)、[移动](screenshots/11-records-mobile.png) |

## 历史修复与验证边界

PR #3 已合并前端及响应丢失幂等重试、临时 SSE 错误续接修复；PR #5 已合并预览自动滚动与焦点恢复修复。SDK 流式正文修复与 DeepSeek/授权适配见[协调记录](backend-coordination.md)。各 PR 合并时检查通过；本次改动已完成本地独立审阅，云端 CI 以功能分支 PR 为准。

本地审查修复已清理旧 CSS、未使用导入/绑定和重复配置刷新，并补齐上述历史预览、手动模型重输回归；[审查关闭记录](code-review-2026-10-22.md)保留修复前失败证据及复审结果。

2026-10-19 已完成 DeepSeek 的后端实测，不能再称为“外部模型完全未验证”，但没有完成真实服务商浏览器验收，也未实测新增 Key 导入/列表流程。第四关需要额外任务 ID 提示，尚未证明零经验学生可独立完成。详见[实测记录](live-model-validation.md)。
