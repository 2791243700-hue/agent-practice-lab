# Agent Practice Lab Web

Next.js App Router + TypeScript。课程、评分和身份通过现有后端获取，页面不复制评分逻辑，不修改已发布课程。

2026-10-22：当前本地包含 Key 优先配置、服务商模型列表和多个内存 Key 管理；学习记录显示日期与红/绿正式通关状态，顶栏提供“帮助”。main 基线和本次功能分支改动见[版本状态](../../docs/project-status.md)。操作步骤见[新手说明](../../docs/user-guide.md)。

从仓库根目录安装：`npm --prefix apps/web ci`。使用 `scripts/start.ps1` 一起启动前后端；原启动器已支持本目录的 `npm run dev -- --hostname … --port …`。

```powershell
cd apps/web
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

浏览器测试要求先 `uv sync --project apps/api --locked` 创建后端环境，使用 3100（Web）、8100（API）、8101（本地脚本模型）端口及新建的临时数据目录。测试进程结束时仅停止其创建的子进程；不会读取学生 Key 或修改日常学习数据库。可通过 `AGENT_SCHOOL_TEST_PYTHON` 指定项目 Python。

私有服务端变量由启动器提供：`AGENT_SCHOOL_API_ORIGIN`、`AGENT_SCHOOL_FRONTEND_ORIGIN`、`AGENT_SCHOOL_LOCAL_TOKEN`。绝不添加 `NEXT_PUBLIC_` 前缀，也不把令牌写进 .env 或 URL。代理校验实际 Host 与写请求 Origin，覆盖浏览器的同名内部令牌头，并流式透传 SSE 与附件响应。

`src/lib/types.ts` 只对现有生成类型的错误 discriminator 字面量做边界适配，payload 均复用原类型；修正生成器后可删除适配。新接口在契约中定义并重新生成 `contracts/types.d.ts`，不手改生成类型。服务端仍决定权限、状态和 `Submission.passed`。

`components/key-manager.tsx` 管理 Key 与模型；`components/learning-status.tsx` 统一日期和通关展示；`lib/api.ts` 保留结果不明确时的幂等键，操作体缓存只保留 SHA-256 指纹，不保留 Key 明文。Key 不写入 localStorage/sessionStorage。服务商建议不等于认证成功；模型列表不等于文本和工具兼容检查通过。

最近本地验证：8 项前端测试、15 项浏览器测试、类型、格式和生产构建通过。浏览器测试使用本地脚本模型和虚构凭据；本机此次使用 Chrome，CI 使用安装的 Chromium。明细与截图见[前端验证](../../docs/frontend-validation.md)。生产构建与日常开发应使用独立目录，避免占用同一 `.next`。
