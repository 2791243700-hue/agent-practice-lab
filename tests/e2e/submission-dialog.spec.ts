import { test, expect, type Page } from "../../apps/web/tests/browser";
import type { Submission } from "../../apps/web/src/lib/types";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function setup(
  page: Page,
  lesson = "01-task",
  mode: "live" | "demo" = "live",
  passed = true,
) {
  const created = await page.request.post("/api/v1/attempts", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { lesson_id: lesson, lesson_version: "1.0.0", mode },
  });
  expect(created.status()).toBe(201);
  const attempt = await created.json();
  let saved: Submission | null = null;
  let posts = 0;
  await page.route(`**/api/v1/attempts/${attempt.id}`, (route) =>
    route.fulfill({
      json: { ...attempt, latest_submission_id: saved?.id ?? null },
    }),
  );
  await page.route(`**/api/v1/attempts/${attempt.id}/submissions*`, (route) =>
    route.fulfill({ json: { items: saved ? [saved] : [], next_cursor: null } }),
  );
  await page.route("**/api/v1/submissions", async (route) => {
    posts++;
    saved = {
      id: `dialog-submission-${posts}`,
      attempt_id: attempt.id,
      lesson_version: "1.0.0",
      mode,
      passed: mode === "live" && passed,
      evaluation_passed: passed,
      created_at: "2026-10-23T00:00:00Z",
      rules: [
        {
          rule_id: "dialog-rule",
          required: true,
          passed,
          message: passed
            ? "已完成本关目标。"
            : "请补充一次不同任务说明的运行。",
          evidence_refs: [],
        },
      ],
      evidence: [],
      answers: route.request().postDataJSON().answers,
    };
    await route.fulfill({ status: 201, json: saved });
  });
  await page.route("**/api/v1/submissions/dialog-submission-*", (route) =>
    route.fulfill({ json: saved }),
  );
  await page.goto(`/practice/${attempt.id}`);
  if (lesson === "01-task")
    await page
      .getByRole("radio", { name: "说明目标、约束和输出要求，再检查结果。" })
      .check();
  return { attempt, posts: () => posts };
}

for (const width of [1440, 390]) {
  test(`提交后弹窗可留在当前关卡，关闭和刷新不显示常驻结果（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const { attempt, posts } = await setup(page);
    const submit = page.getByRole("button", { name: "提交验收", exact: true });
    await submit.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("本关已通关");
    await expect(
      dialog.getByRole("link", { name: "下一关", exact: true }),
    ).toHaveAttribute("href", /\/lessons\/02-context/);
    await expect(
      dialog.getByRole("button", { name: "留在当前关卡", exact: true }),
    ).toBeFocused();
    await expect(page.getByTestId("submission-feedback")).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const screenshots = path.resolve(
      process.cwd(),
      "../../work/submission-preview",
    );
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, `dialog-${width}.png`),
    });
    await dialog
      .getByRole("button", { name: "留在当前关卡", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/practice/${attempt.id}$`));
    await expect(submit).toBeFocused();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "让 Agent 理解任务", exact: true }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("submission-feedback")).toHaveCount(0);
    expect(posts()).toBe(1);
    await page.getByText("历史提交（1）", { exact: true }).click();
    await page.locator(".history-item").click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}

test("提交弹窗可前往下一关导读", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "下一关", exact: true })
    .click();
  await expect(page).toHaveURL(/\/lessons\/02-context/);
  await expect(page.getByText("本关学什么", { exact: true })).toBeVisible();
});

test("从弹窗进入下一关并开始实训时保留当前模型", async ({ page }) => {
  const headers = () => ({
    Origin: "http://127.0.0.1:3100",
    "Idempotency-Key": crypto.randomUUID(),
  });
  const connected = await page.request.post("/api/v1/model-profiles/connect", {
    headers: headers(),
    data: {
      provider_id: "openai-compatible",
      api_key: "browser-test-only",
      base_url: "http://127.0.0.1:8101/v1",
      model_id: "browser-scripted-model",
      name: "下一关模型保留",
    },
  });
  expect(connected.status()).toBe(201);
  const { profile } = await connected.json();
  const checked = await page.request.post(
    `/api/v1/model-profiles/${profile.id}/check`,
    {
      headers: headers(),
      data: { expected_revision: profile.revision },
    },
  );
  expect((await checked.json()).connection_check.status).toBe("passed");
  await setup(page);
  await page
    .getByRole("combobox", { name: "本轮模型" })
    .selectOption(profile.id);
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await page.route(/\/api\/v1\/attempts\?lesson_id=02-context/, (route) =>
    route.fulfill({ json: { items: [], next_cursor: null } }),
  );
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "下一关", exact: true }),
  ).toHaveAttribute("href", `/lessons/02-context?profile=${profile.id}`);
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "下一关", exact: true })
    .click();
  await expect(page).toHaveURL(/\/lessons\/02-context/);
  expect(new URL(page.url()).searchParams.get("profile")).toBe(profile.id);
  await page.getByRole("button", { name: "开始实训", exact: true }).click();
  await expect(page).toHaveURL(/\/practice\//);
  await expect(page.getByRole("combobox", { name: "本轮模型" })).toHaveValue(
    profile.id,
  );
});

test("未通过时在弹窗显示待补充项，关闭后可继续作答", async ({ page }) => {
  await setup(page, "01-task", "live", false);
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("本次尚未通过");
  await expect(dialog).toContainText("请补充一次不同任务说明的运行。");
  await dialog
    .getByRole("button", { name: "留在当前关卡", exact: true })
    .click();
  await expect(page.getByRole("radio").first()).toBeEnabled();
});

test("下一关读取失败可重试，且不会阻止留在当前关卡", async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route("**/api/v1/lessons", async (route) => {
    if (++reads === 1) await route.fulfill({ status: 503, json: {} });
    else await route.continue();
  });
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("暂时无法读取课程列表。");
  await expect(
    dialog.getByRole("button", { name: "留在当前关卡", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "下一关", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(2);
});

test("最后一关弹窗可返回课程列表，演示结果不宣称正式通关", async ({ page }) => {
  await setup(page, "04-permission", "demo");
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("演示检查通过 · 不计正式完成");
  await expect(
    dialog.getByRole("link", { name: "下一关", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("link", { name: "返回课程列表", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
