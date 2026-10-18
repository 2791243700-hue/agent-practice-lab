# Agent Practice Lab Web

Next.js App Router + TypeScript。课程、评分和身份通过现有后端获取，页面不复制评分逻辑，不修改已发布课程。

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

`src/lib/types.ts` 只对现有生成类型的错误 discriminator 字面量做边界适配，payload 均复用原类型。API/schema/生成文件保持原样，后端维护者修正生成器后可删除适配。服务端仍决定权限、状态和 `Submission.passed`。
