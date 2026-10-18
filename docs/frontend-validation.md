# 前端交付与验证记录

日期：2026-10-18。开发基线：`origin/feat/backend` 的 `d908e01`。前端放在 `apps/web/`，浏览器用例在 `tests/e2e/`。

## 实现

课程列表、四关固定版本导读、开始/继续、模型与内存 Key 配置、主动连接检查、独立实训、任务/材料/设置、消息与工具过程、逐次批准/拒绝、预览与下载、理解和事实核对表单、提交反馈/证据/历史快照、学习记录与 ZIP 导出。

浏览器只调用同源 `/api/v1`；私有令牌仅由服务器覆盖注入；请求校验 Host 与写 Origin，SSE 不缓冲。刷新先读取实验固定版本、分页运行和事件历史，再按事件末序号续接；不在恢复时 POST 运行。完整消息替换增量，重复事件去重。审批决定与实际工具完成分别展示。完成状态只取后端 `Submission.passed`。

课程、评分和 JSON 契约没有修改。用户确认后增加了一项最小后端正文修复，独立提交 `fix(api): preserve complete streamed assistant replies`；修正 SDK 结束事件未携带完整正文时的适配。线上身份保持 `/me` 扩展边界，没有增加空登录页或云部署。`src/lib/types.ts` 对生成器 discriminator 问题做边界适配，详见[协调记录](backend-coordination.md)。

## 实际检查

本地 Windows，Node.js 22.18.0、Python 3.12.14、Next.js 16.4.2、React 19.3.1、TypeScript 5.9.3、Playwright 1.64.1 / Chromium 156。使用锁文件固定安装结果。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过；含前端、代理及仓库级 e2e TypeScript |
| `npm run build` | 通过；页面与动态 API 路由正常生成 |
| `npm test` | 5 项通过：事件去重/完整替换、序号续接/204、契约常量、真实批准结果、代理来源/令牌/流式/附件 |
| `npm run format:check` | 通过 |
| 原 Windows 启动器联动 `npm run test:launcher` | 通过；Next dev + API 私有令牌代理，四关可读、首页 HTTP 200；测试子进程已停止 |
| 加强后的完整浏览器回归 | **7 项全部通过**，包含最终完整回答正文断言，耗时约 22 秒 |
| 最小后端修复回归 | **41 项全部通过**，含 SDK HTTP 正文、凭据遮盖、授权、恢复与评分；Ruff 检查与格式通过 |

截图审阅曾发现普通流式回答结束时被后端清空。先补正文断言复现失败，再经用户明确确认修复，最后全量回归通过并重新生成截图。修复方案、影响与复现见[协调记录](backend-coordination.md)。

浏览器覆盖：无 Key 四关导读、390px 移动布局；错误 Key、替换与检查、输入框清空；两轮指令与逐项反馈、历史提交、正式与演示隔离；刷新按序号续接且运行 POST 次数不增加；等待审批时刷新；拒绝后无产物、批准后真实完成；产物和提交快照下载、ZIP；重新开始后旧记录只读；停止与批准失效；服务重启中断、Key 清除、无自动重跑；演示后另建正式实训；来源拒绝与内部令牌不返回浏览器。

## 复现

先在仓库根目录 `uv sync --project apps/api --locked`，再：

```powershell
cd apps/web
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Windows 单独验证现有启动器；会使用 3200/8200 和隔离数据目录
npm run test:launcher
```

不要并行执行 typecheck、build、dev，它们会更新同一 Next.js 生成类型目录。e2e 使用 3100/8100/8101，真实 API + AgentScope SDK + 本地确定性 HTTP 模型，独立临时数据，无学生 Key。第一关使用 `mode=live` 仅测试正式评分路径；它不是外部真实模型。

新增独立前端 GitHub Actions，执行格式、类型、单元、构建与浏览器检查并上传报告；云端是否通过应以 PR 实际 checks 为准，本地记录不代表云端结果。

## 截图

截图由最终通过的浏览器测试生成，无真实 Key。桌面 1440px，移动 390px。第一关截图已包含完整的两轮助手回答。

| 页面 | 截图 |
| --- | --- |
| 课程入口 | [课程列表](screenshots/01-courses.png) |
| 第一关导读 | [版本化导读](screenshots/02-introduction.png) |
| 模型配置 | [检查通过与已清空 Key 输入框](screenshots/03-model-settings.png) |
| 第一关反馈 | [两轮完整回答与提交反馈](screenshots/04-first-lesson-feedback.png) |
| 保存授权 | [审批参数与批准/拒绝](screenshots/05-save-approval.png) |
| 产物与验收 | [已保存、预览、逐项反馈](screenshots/06-artifacts-feedback.png) |
| 移动布局 | [390px 课程列表](screenshots/07-mobile-courses.png) |

## 真实模型与待办

### 2026-10-18 审查修复

已修复两项通信恢复问题，并先用回归测试复现失败：代理未收到已提交操作的响应时，前端保留原幂等键供手动重试；SSE 遇到临时 408/429/500/502/503/504 时，按原事件序号退避重连。写操作不会自动重发；永久来源、权限、资源或游标错误仍停止订阅，204 和运行终态仍关闭连接。

新增真实 HTTP 断开响应的 api + proxy 集成用例，确认手动重试只产生一个资源、成功后的新操作生成新键；新增 SSE 503 恢复、永久错误停止，以及浏览器 503 恢复且 POST 运行次数不增加的回归。更新后的测试集为 8 项前端测试、8 项浏览器流程。当前 CI 结果仍以对应提交为准。

外部模型没有使用本地自备 Key 实测，详见[单独记录](live-model-validation.md)。不查找私人 Key，不将占位测试凭据当作真实凭据。

最小后端修复已按用户同意执行，单独提交便于后端维护者审阅。GitHub 仓库邀请已接受并确认写权限，本次通过前端 PR 交付。后端 PR #2 与契约 PR #1 仍未合并，前端 PR 先以 `feat/backend` 为基分支，依赖合并后再转 main；不把原后端实现混入前端审阅差异。
