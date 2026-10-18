import { test, expect, type Page } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const screenshots = path.resolve(process.cwd(), "../../docs/screenshots");
async function screenshot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, `${name}.png`),
    fullPage: true,
  });
}
async function startDemo(page: Page, id: string) {
  await page.goto(`/lessons/${id}`);
  await page
    .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
    .click();
  await expect(page).toHaveURL(/\/practice\//);
  await expect(
    page.getByRole("heading", { name: "与 Agent 一起完成任务" }),
  ).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByLabel("任务说明", { exact: true }).fill(text);
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
}
async function testProfile(page: Page) {
  const response = await page.request.post("/api/v1/model-profiles", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      name: "独立凭据恢复测试",
      provider: "openai-compatible",
      base_url: "http://127.0.0.1:8101/v1",
      model: "browser-scripted-model",
    },
  });
  expect(response.status()).toBe(201);
  const profile = await response.json();
  const credential = await page.request.put(
    `/api/v1/model-profiles/${profile.id}/credential`,
    {
      headers: { Origin: "http://127.0.0.1:3100" },
      data: {
        expected_revision: profile.revision,
        api_key: "browser-test-only",
      },
    },
  );
  expect(credential.ok()).toBe(true);
  return await credential.json();
}

test("无 Key 阅读四关、首页与移动布局", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "第一次使用 Agent，从这里开始。" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "阅读导读" })).toHaveCount(4);
  await screenshot(page, "01-courses");
  for (const id of ["01-task", "02-context", "03-tools", "04-permission"]) {
    await page.goto(`/lessons/${id}`);
    await expect(page.getByText("本关学什么", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始实训", exact: true }),
    ).toBeVisible();
    if (id === "01-task") await screenshot(page, "02-introduction");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "阅读导读" })).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, "07-mobile-courses");
});

test("第一关：模型设置、认证失败、两次运行、刷新续接、逐项反馈和正式通过", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const starts: string[] = [];
  const cursors: number[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1")) {
      expect(request.headers()["x-local-token"]).toBeUndefined();
      if (request.method() === "POST" && request.url().endsWith("/runs"))
        starts.push(request.url());
      if (request.url().includes("/events?"))
        cursors.push(
          Number(new URL(request.url()).searchParams.get("after_seq")),
        );
    }
  });
  await page.goto("/lessons/01-task");
  await page.getByRole("button", { name: "开始实训", exact: true }).click();
  await expect(page).toHaveURL(/\/practice\//);
  const attemptUrl = page.url();
  await page.getByRole("link", { name: "去设置 →" }).click();
  await page.getByLabel("配置名称").fill("浏览器测试模型");
  await page.getByLabel("API 根地址").fill("http://127.0.0.1:8101/v1");
  await page.getByLabel("模型名称").fill("browser-scripted-model");
  await page.getByRole("button", { name: "保存连接信息", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "02 · 输入 API Key" }),
  ).toBeVisible();
  await page
    .getByLabel("API Key", { exact: true })
    .fill("invalid-browser-test");
  await page.getByRole("button", { name: "提交 Key", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByRole("checkbox", { name: /我知道连接检查/ }).check();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByText("连接检查未通过", { exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText("MODEL_AUTH_FAILED");
  await page.getByLabel("API Key", { exact: true }).fill("browser-test-only");
  await page.getByRole("button", { name: "提交 Key", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("browser-test-only");
  await screenshot(page, "03-model-settings");
  await page.getByRole("link", { name: "返回实训 →" }).click();
  await expect(page).toHaveURL(attemptUrl);
  await send(page, "帮我看看这份课程通知");
  await expect(page.getByRole("button", { name: "停止本轮" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("本轮已完成", { exact: true })).toBeVisible();
  await expect(
    page.locator(".assistant-message .markdown").first(),
  ).toContainText("已根据课程通知整理两项待办，请核对日期和来源。");
  expect(starts.length).toBe(1);
  expect(cursors.some((c) => c > 0)).toBe(true);
  await page
    .getByRole("radio", { name: "只说帮我处理，并直接相信结果。" })
    .check();
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByTestId("submission-feedback")).toContainText(
    "需要补充",
  );
  await send(
    page,
    "请整理两项待办，列出截止日期，只使用通知中的事实，不猜测缺失信息。",
  );
  await expect(page.getByText("本轮已完成", { exact: true })).toHaveCount(2);
  expect(starts.length).toBe(2);
  await page
    .getByRole("radio", { name: "说明目标、约束和输出要求，再检查结果。" })
    .check();
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByTestId("submission-feedback")).toContainText(
    "正式通过，做得有依据。",
  );
  await page.getByRole("button", { name: "查看本关介绍" }).click();
  await expect(page.getByText("本关学什么", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "收起导读" }).click();
  await screenshot(page, "04-first-lesson-feedback");
  await page.getByText("历史提交（2）", { exact: true }).click();
  await page.locator(".history-item").last().click();
  await expect(page.getByTestId("submission-feedback")).toContainText(
    "还差几步",
  );
  await page.goto("/");
  await expect(page.getByText("已正式通过", { exact: true })).toHaveCount(1);
  await page.getByRole("link", { name: "继续实训" }).click();
  await expect(page).toHaveURL(attemptUrl);
  expect(pageErrors).toEqual([]);
});

test("第二、三关：材料、工具结果、事实核对、错误反馈与演示隔离", async ({
  page,
}) => {
  const before = await (await page.request.get("/api/v1/lessons")).json();
  await startDemo(page, "02-context");
  await page.getByRole("checkbox", { name: "课程通知" }).check();
  await page.getByRole("button", { name: "保存下一轮设置" }).click();
  await expect(page.getByRole("button", { name: "设置已同步" })).toBeDisabled();
  await send(page, "请读取课程通知，提取任务的日期和来源。");
  await expect(page.getByText("本轮已完成", { exact: true })).toBeVisible();
  await expect(page.locator(".tool-event")).toHaveCount(2);
  const facts = page.locator(".fact-row");
  for (let i = 0; i < 2; i++) {
    await facts
      .nth(i)
      .getByLabel("截止日期")
      .fill(i === 0 ? "2026-11-04" : "2026-11-06");
    await facts.nth(i).getByLabel("依据来源").selectOption("notice-week");
  }
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByTestId("submission-feedback")).toContainText(
    "演示检查通过 · 不计正式完成",
  );
  await startDemo(page, "03-tools");
  await send(page, "查询 agent101 的课程安排，并告诉我日期和教室。");
  await expect(page.getByText("本轮已完成", { exact: true })).toBeVisible();
  await page.locator(".tool-event summary").click();
  await expect(page.locator(".tool-details")).toContainText("agent101");
  await page.getByLabel("课程日期", { exact: true }).fill("2026-11-07");
  await page.getByLabel("教室", { exact: true }).fill("错误教室");
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByTestId("submission-feedback")).toContainText(
    "需要补充",
  );
  await page.getByLabel("课程日期", { exact: true }).fill("2026-11-05");
  await page.getByLabel("教室", { exact: true }).fill("A301");
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByTestId("submission-feedback")).toContainText(
    "演示检查通过 · 不计正式完成",
  );
  await page.goto("/");
  await expect(page.getByText("已正式通过", { exact: true })).toHaveCount(
    before.items.filter((item: { completed: boolean }) => item.completed)
      .length,
  );
});

test("第四关：刷新恢复审批、拒绝未写入、批准实际完成、产物、快照下载与导出", async ({
  page,
}) => {
  await startDemo(page, "04-permission");
  await page.getByRole("checkbox", { name: "课程通知" }).check();
  await page.getByRole("button", { name: "保存下一轮设置" }).click();
  await send(page, "读取通知，保存两项待办清单，请先让我核对并批准。");
  await expect(
    page.getByRole("button", { name: "拒绝此次保存" }),
  ).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "拒绝此次保存" }),
  ).toBeVisible();
  await screenshot(page, "05-save-approval");
  await page.getByRole("button", { name: "拒绝此次保存" }).click();
  await expect(
    page.getByText("已拒绝 · 此次操作不会保存", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".artifact-panel .file-row")).toHaveCount(0);
  await page.getByRole("button", { name: "批准此次保存" }).click();
  await expect(
    page.getByText("已保存 · 工具执行成功", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("本轮已完成", { exact: true })).toBeVisible();
  await expect(page.locator(".artifact-panel .file-row")).toHaveCount(2);
  await page.locator(".artifact-panel .file-row .text-button").first().click();
  await expect(page.locator(".file-preview")).toContainText("2026-11-04");
  const fileDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载完整文件" }).click();
  expect((await fileDownload).suggestedFilename()).toBeTruthy();
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByTestId("submission-feedback")).toContainText(
    "演示检查通过 · 不计正式完成",
  );
  await screenshot(page, "06-artifacts-feedback");
  for (const detail of await page.locator(".feedback details").all())
    await detail.locator("summary").click();
  const frozen = page.waitForEvent("download");
  await page
    .getByRole("link", { name: /下载提交时快照/ })
    .first()
    .click();
  expect((await frozen).suggestedFilename()).toBeTruthy();
  await page.getByRole("button", { name: "导出学习记录", exact: true }).click();
  const zip = page.waitForEvent("download");
  await page.getByRole("link", { name: "学习记录已就绪，下载 ZIP" }).click();
  expect((await zip).suggestedFilename()).toMatch(/\.zip$/);
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await page.getByRole("button", { name: "确认重新开始", exact: true }).click();
  await expect(page).not.toHaveURL(url);
  await expect(page.getByText("0 轮尝试", { exact: true })).toBeVisible();
  await page.goto(url);
  await expect(
    page.getByText("此实验已重新开始，旧记录仍可回看和导出。", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发送任务", exact: true }),
  ).toHaveCount(0);
});

test("停止等待授权的运行，旧批准失效；清除 Key 后需重新检查", async ({
  page,
}) => {
  await startDemo(page, "04-permission");
  await page.getByRole("checkbox", { name: "课程通知" }).check();
  await page.getByRole("button", { name: "保存下一轮设置" }).click();
  await send(page, "保存课程待办");
  await expect(
    page.getByRole("button", { name: "批准此次保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止本轮" }).click();
  await expect(page.getByText("已停止", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批准此次保存" })).toHaveCount(
    0,
  );
  await expect(page.getByText("请求已失效", { exact: true })).toBeVisible();
  const profile = await testProfile(page);
  await page.goto("/settings");
  await page.getByLabel("选择已有配置").selectOption(profile.id);
  await page.getByRole("button", { name: "清除当前 Key", exact: true }).click();
  await expect(
    page.getByText("Key 已从本地后端内存清除。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("尚未通过连接检查", { exact: true }),
  ).toBeVisible();
});

test("同源代理拒绝缺失 Origin/错误来源，浏览器拿不到内部令牌", async ({
  request,
  page,
}) => {
  const missing = await request.post("/api/v1/attempts", { data: {} });
  expect(missing.status()).toBe(403);
  const wrong = await request.post("/api/v1/attempts", {
    data: {},
    headers: { Origin: "https://evil.example" },
  });
  expect(wrong.status()).toBe(403);
  const health = await request.get("/api/v1/health", {
    headers: { "X-Local-Token": "browser-forged" },
  });
  expect(health.status()).toBe(200);
  expect(await health.text()).not.toContain("token");
  await page.goto("/");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("token");
});

test("演示后可另建正式实训，后端重启恢复中断记录并清除 Key", async ({
  page,
}) => {
  const profile = await testProfile(page);
  await startDemo(page, "04-permission");
  await page.getByRole("checkbox", { name: "课程通知" }).check();
  await page.getByRole("button", { name: "保存下一轮设置" }).click();
  await send(page, "读取通知并申请保存");
  await expect(
    page.getByRole("button", { name: "批准此次保存" }),
  ).toBeVisible();
  const attemptUrl = page.url();
  let restartedPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/runs"))
      restartedPosts++;
  });
  const restart = await page.request.post(
    "http://127.0.0.1:8101/__test/restart-backend",
    { headers: { "X-Test-Control": "browser-test-control" } },
  );
  expect(restart.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("因服务重启中断", { exact: true })).toBeVisible();
  await expect(page.getByText("请求已失效", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批准此次保存" })).toHaveCount(
    0,
  );
  expect(restartedPosts).toBe(0);
  const after = await (
    await page.request.get(`/api/v1/model-profiles/${profile.id}`)
  ).json();
  expect(after.credential_status).toBe("missing");
  expect(after.connection_check.status).toBe("unchecked");
  await page.goto("/lessons/04-permission");
  await page.getByRole("button", { name: "开始正式实训" }).click();
  await expect(page).not.toHaveURL(attemptUrl);
  await expect(
    page.getByText("正式实训 · 使用自备模型", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "去设置 →" })).toBeVisible();
});
