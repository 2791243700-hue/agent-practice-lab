# 实训工作区交付与验证

日期：2026-10-22。交付分支：`feat/practice-workspace-interactions`。

本次前端增量基于 PR [#6](https://github.com/2791243700-hue/agent-practice-lab/pull/6) 的 `b56182f`，PR 目标为 `feat/key-manager-review-fixes`，只展示本轮差异。PR #6 尚未合并到 main；接收时先合并基础 PR，再将本 PR 的目标调整到 main 并确认差异和检查结果。

## 最终交互

- 四关任务区增加生活情境的小例子，说明操作方法，避免直接复述本题。它们属于前端辅助说明；本轮没有修改已归档课件包、答案表单或评分规则。
- 材料准备提醒集中在任务输入框附近。需要读取材料的关卡在未选择材料时提示选择；选中后尚未保存时提示保存，保存成功后消失。第一、三关可直接采用默认设置。选中材料仍不代表成功读取。
- 左侧“任务与设置”统一收纳任务、材料与 Agent 设置、产物和原文预览，默认展开。收起后桌面只留 40px 图标按钮，主任务区扩宽；手机端移除内容占位，主任务区提前。三个子板块仍可独立折叠。
- 收起不会卸载设置或预览内容；未保存设置、材料选择、任务草稿均保留。“前往设置”自动展开侧栏和设置板块。文件预览会展开预览板块、进入视口并获得焦点；关闭后回到原按钮。
- 实训顶部合并为导航/操作、标题/状态两行。帮助和导读仍可访问；开始日期、课程版本和模式放入可点击的“实训信息”，支持键盘展开和 Esc 关闭。记录页继续直接显示上海时区的开始日期。
- 点击发送后，在等待创建运行请求时立即显示任务说明及发送状态，接收 Run 后替换为服务端正式记录。发送失败恢复原文并移除临时消息，不自动重试。
- 接收 SSE 分片时即时更新回答，并滚动对话容器和必要的页面视口，使最新输出可见。终态正文继续替换累计分片；刷新按事件序号恢复，不重新 POST 运行。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| TypeScript | `tsc --noEmit --incremental false` 通过；隔离生产构建内的类型检查通过 |
| Web 格式 | `npm run format:check` 通过 |
| 前端单元测试 | `npm test`，8 项通过 |
| 生产构建 | `npm run build` 通过 |
| 浏览器回归 | `npm run test:e2e`，26 项全部通过，约 55 秒 |
| 差异检查 | `git diff --check` 通过 |

浏览器测试使用 Playwright Chromium，桌面 1440px、手机 390px。原有 15 项回归保留，新增 11 项覆盖例子与准备提示、折叠和侧栏、紧凑顶部、即时发送与真实分片渲染。顶部测试使用独立响应夹具，避免污染课程列表的初始状态。

流式用例通过隔离 FastAPI、实际 AgentScope SDK、同源代理及本地 HTTP 模型发送分片；在显式结束响应前逐段检查正文、滚动位置和“正在输出”状态，并在第二段刷新后继续。每次实训只产生一次运行 POST。另覆盖延迟创建响应时已显示问题、失败恢复输入和不自动重试。

所有自动化使用虚构凭据和临时学习库，不访问正在体验的 3000/8000 实例。为保留用户的开发服务和内存凭据，生产构建及浏览器测试在独立目录执行；没有同时在开发目录运行生产构建。本轮没有使用私人 Key 进行外部模型实测；已有 DeepSeek 后端实测边界仍见[真实模型记录](live-model-validation.md)。后端、契约与课件未更改，本轮未重跑后端测试。

## 启动与复现

根目录执行：

```powershell
uv sync --project apps/api --locked
npm --prefix apps/web ci
.\scripts\start.ps1
# 打开 http://127.0.0.1:3000
# 停止：.\scripts\stop.ps1
```

在单独 checkout 中执行以下检查，避免与开发服务争用 Next.js 生成目录：

```powershell
cd apps/web
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

测试使用 3100/8100/8101 端口；可通过 `AGENT_SCHOOL_TEST_PYTHON` 指定后端 Python。运行真实模型仍需用户自行在页面输入 Key 并主动进行连接检查。

## 截图

以下均来自自动化虚构场景，不是学生的真实学习记录。

| 场景 | 截图 |
| --- | --- |
| 紧凑顶部及默认侧栏 | [桌面](screenshots/practice-workspace/06-header-1440.png)、[手机](screenshots/practice-workspace/06-header-390.png) |
| 侧栏收起后让出空间 | [桌面](screenshots/practice-workspace/05-sidebar-closed-1440.png)、[手机](screenshots/practice-workspace/05-sidebar-closed-390.png) |
| 请求确认前已显示问题 | [桌面](screenshots/practice-workspace/07-send-immediately-1440.png) |
| 尚未结束的输出与最新视野 | [手机](screenshots/practice-workspace/08-stream-follow-390.png) |
