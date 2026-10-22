import { test, expect } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [1440, 390]) {
  test(`问题先于请求响应显示，回答逐段到达并跟随滚动，刷新不重发（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const headers = () => ({
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    });
    const connected = await page.request.post(
      "/api/v1/model-profiles/connect",
      {
        headers: headers(),
        data: {
          provider_id: "openai-compatible",
          api_key: "browser-test-only",
          base_url: "http://127.0.0.1:8101/v1",
          model_id: "browser-scripted-model",
          name: "分段输出测试",
        },
      },
    );
    expect(connected.ok()).toBe(true);
    const { profile } = await connected.json();
    const checked = await page.request.post(
      `/api/v1/model-profiles/${profile.id}/check`,
      { headers: headers(), data: { expected_revision: profile.revision } },
    );
    expect((await checked.json()).connection_check.status).toBe("passed");
    const created = await page.request.post("/api/v1/attempts", {
      headers: headers(),
      data: { lesson_id: "01-task", lesson_version: "1.0.0", mode: "live" },
    });
    const attempt = await created.json();
    await page.goto(`/practice/${attempt.id}?profile=${profile.id}`);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let starts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/v1/runs"))
        starts++;
    });
    await page.route("**/api/v1/runs", async (route) => {
      await gate;
      await route.continue();
    });
    const text = "交互流式测试：请分段整理结果";
    await page.getByLabel("任务说明", { exact: true }).fill(text);
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await expect(page.getByTestId("pending-message")).toContainText(text);
    await expect(page.getByTestId("pending-message")).toBeInViewport();
    await expect(page.getByTestId("run-view")).toHaveCount(0);
    await expect(page.getByLabel("任务说明", { exact: true })).toHaveValue("");
    const screenshots = path.resolve(
      process.cwd(),
      "../../work/guidance-preview",
    );
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, `07-send-immediately-${width}.png`),
    });
    release();
    await expect(page.getByTestId("pending-message")).toHaveCount(0);
    const output = page.locator(".assistant-message .markdown");
    await expect(output).toContainText("实时片段1");
    await expect(output).not.toContainText("实时片段2");
    await expect(page.getByText("正在输出…", { exact: true })).toBeVisible();
    await expect(page.getByText("本轮已完成", { exact: true })).toHaveCount(0);
    const atLatest = async () => {
      await expect
        .poll(() =>
          page
            .locator(".conversation-history")
            .evaluate(
              (element) =>
                element.scrollHeight - element.scrollTop - element.clientHeight,
            ),
        )
        .toBeLessThan(3);
      await expect(page.locator(".conversation-end")).toBeInViewport();
    };
    await atLatest();
    const next = async () => {
      expect(
        (
          await page.request.post("http://127.0.0.1:8101/__test/stream/next", {
            headers: { "X-Test-Control": "browser-test-control" },
          })
        ).ok(),
      ).toBe(true);
    };
    await next();
    await expect(output).toContainText("实时片段2");
    await atLatest();
    await page.screenshot({
      path: path.join(screenshots, `08-stream-follow-${width}.png`),
    });
    await page.reload();
    await expect(output).toContainText("实时片段2");
    await expect(page.locator(".user-message")).toHaveCount(1);
    await atLatest();
    await next();
    await expect(output).toContainText("实时片段3");
    await atLatest();
    await next();
    await expect(page.getByText("本轮已完成", { exact: true })).toBeVisible();
    await expect(page.getByText("正在输出…", { exact: true })).toHaveCount(0);
    await expect(
      output.getByRole("heading", { name: "实时片段1", exact: true }),
    ).toHaveCount(1);
    await expect(page.locator(".user-message")).toHaveCount(1);
    await atLatest();
    expect(starts).toBe(1);
  });
}

test("发送失败保留原文且不留下已发送消息，不自动重试", async ({ page }) => {
  await page.goto("/lessons/01-task");
  await page
    .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
    .click();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let starts = 0;
  await page.route("**/api/v1/runs", async (route) => {
    starts++;
    await gate;
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "MODEL_UNAVAILABLE",
          message: "测试连接不可用",
          retryable: true,
          request_id: "stream-test",
          fields: [],
        },
      },
    });
  });
  const text = "发送失败时保留的原始任务";
  await page.getByLabel("任务说明", { exact: true }).fill(text);
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(page.getByTestId("pending-message")).toContainText(text);
  release();
  await expect(page.getByTestId("pending-message")).toHaveCount(0);
  await expect(page.getByLabel("任务说明", { exact: true })).toHaveValue(text);
  await expect(page.getByTestId("run-view")).toHaveCount(0);
  await expect(page.locator(".notice.error[role=alert]")).toContainText(
    "MODEL_UNAVAILABLE",
  );
  expect(starts).toBe(1);
});
