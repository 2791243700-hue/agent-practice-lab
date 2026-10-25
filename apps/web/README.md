# Agent Practice Lab Web

当前统一功能见[交付记录](../../docs/unified-practice-delivery.md)：第一关按课程版本使用正式复盘或旧版 choice，草稿后端恢复；Tips、重置、结果弹窗和其余三关完整保留。以下 2026-10-24 记录为预览交付历史。

Next.js App Router + TypeScript。课程、评分和身份通过现有后端获取，页面不复制正式评分逻辑，不修改已发布课程。

2026-10-24：包含 Key 管理、按凭据状态显示的首页准备提示、可收起工作区和流式对话。第一关使用复盘验收模板，移除旧单选与提交；当前仅本地核对/下载，尚无新正式评分。第二至四关及旧成绩保留，详见[版本状态](../../docs/project-status.md)、[使用说明](../../docs/user-guide.md)和[后端接入清单](../../docs/reflection-assessment-backend-handoff.md)。

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

最近本地验证：前端单元 8 项、浏览器 30 项、类型、格式和隔离生产构建通过。浏览器使用脚本模型和虚构凭据，第一关旧提交只构造历史兼容记录，不算新复盘正式评分。明细与截图见[前端交付](../../docs/reflection-assessment-delivery.md)。不要在日常 dev 使用的同一 .next 中执行 build。
