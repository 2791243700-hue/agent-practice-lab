import { test, expect, type Page } from "../../apps/web/tests/browser";
import type { Attempt, Profile } from "../../apps/web/src/lib/types";

async function fixture(page: Page, ready: boolean) {
  const attempt: Attempt = {
    id: "validation-attempt",
    owner_id: "local-owner",
    lesson_id: "02-context",
    lesson_version: "1.1.0",
    mode: "live",
    status: "active",
    progress: "in_progress",
    revision: 1,
    settings: { system_instruction: "根据通知核对。", temperature: 0.3 },
    selected_file_ids: [],
    active_run_id: null,
    latest_submission_id: null,
    reset_to_attempt_id: null,
    created_at: "2026-10-27T00:00:00Z",
    updated_at: "2026-10-27T00:00:00Z",
  };
  const profile: Profile = {
    id: "validation-profile",
    name: "模拟验收模型",
    provider: "openai-compatible",
    revision: 1,
    base_url: "https://provider.example/v1",
    model: "test-model",
    credential_status: "configured",
    connection_check: {
      status: "passed",
      text_ok: true,
      tools_ok: true,
      message: "模拟通过",
      checked_at: null,
      error_code: null,
    },
    created_at: attempt.created_at,
    updated_at: attempt.created_at,
  };
  let submissions = 0;
  await page.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      pathname.startsWith("/api/v1/lessons/") &&
      route.request().method() === "GET"
    )
      return route.continue();
    if (pathname === "/api/v1/lessons")
      return route.fulfill({ json: { items: [] } });
    if (pathname === "/api/v1/model-profiles")
      return route.fulfill({ json: { items: ready ? [profile] : [] } });
    if (pathname === `/api/v1/attempts/${attempt.id}`)
      return route.fulfill({ json: attempt });
    if (pathname.startsWith(`/api/v1/attempts/${attempt.id}/`))
      return route.fulfill({ json: { items: [], next_cursor: null } });
    if (
      pathname === "/api/v1/submissions" &&
      route.request().method() === "POST"
    ) {
      submissions++;
      const body = route.request().postDataJSON();
      expect(body.assessment.consent).toBe(true);
      expect(body.learning_reflection.trim()).not.toBe("");
      return route.fulfill({
        status: 201,
        json: {
          id: "validation-submission",
          attempt_id: attempt.id,
          mode: "live",
          lesson_version: "1.1.0",
          passed: false,
          evaluation_passed: false,
          created_at: attempt.created_at,
          answers: body.answers,
          learning_reflection: body.learning_reflection,
          rules: [
            {
              rule_id: "read-and-facts",
              required: true,
              passed: false,
              message: "模拟：尚未实际读取材料。",
              evidence_refs: [],
            },
          ],
          evidence: [],
        },
      });
    }
    return route.abort();
  });
  await page.goto(`/practice/${attempt.id}`);
  await expect(page.getByLabel("我的核对说明")).toBeVisible();
  return () => submissions;
}

for (const width of [1440, 390]) {
  test(`普通验收逐项标记日期来源、说明和模型缺失，定位正确且不调用验收（${width}px）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const submissions = await fixture(page, false);
    const submit = page.getByRole("button", { name: "提交验收", exact: true });
    const rows = page.locator(".fact-row");
    const date = rows.nth(0).getByLabel("截止日期", { exact: true });
    const source = rows
      .nth(0)
      .getByRole("combobox", { name: "依据来源", exact: true });
    await submit.click();
    await expect(date).toHaveAttribute("aria-invalid", "true");
    await expect(date).toBeFocused();
    await expect(date).toBeInViewport();
    await expect(source).toHaveAttribute("aria-invalid", "true");
    expect(submissions()).toBe(0);
    await date.fill("2026-11-04");
    await expect(date).not.toHaveAttribute("aria-invalid", "true");
    await submit.click();
    await expect(source).toBeFocused();
    await page.locator(".validation-summary").screenshot({
      path: testInfo.outputPath(`submission-missing-${width}.png`),
    });
    await source.selectOption("notice-week");
    await rows
      .nth(1)
      .getByLabel("截止日期", { exact: true })
      .fill("2026-11-06");
    await rows
      .nth(1)
      .getByRole("combobox", { name: "依据来源", exact: true })
      .selectOption("notice-week");
    await submit.click();
    const reflection = page.getByLabel("我的核对说明");
    await expect(reflection).toBeFocused();
    await expect(reflection).toHaveAttribute("aria-invalid", "true");
    await reflection.fill("我将两项任务的日期与通知逐项对照，并确认了来源。");
    await submit.click();
    const modelLink = page.getByRole("link", {
      name: "前往模型设置",
      exact: true,
    });
    await expect(modelLink).toBeFocused();
    await expect(modelLink).toBeInViewport();
    await expect(page.locator(".validation-summary")).toContainText(
      "通过连接检查的验收模型",
    );
    expect(submissions()).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("确认费用缺失时定位同意项，勾选后标记消除且仅发送一次", async ({
  page,
}) => {
  const submissions = await fixture(page, true);
  const rows = page.locator(".fact-row");
  for (const [index, date] of ["2026-11-04", "2026-11-06"].entries()) {
    await rows.nth(index).getByLabel("截止日期", { exact: true }).fill(date);
    await rows
      .nth(index)
      .getByRole("combobox", { name: "依据来源", exact: true })
      .selectOption("notice-week");
  }
  await page
    .getByLabel("我的核对说明")
    .fill("我逐项核对了通知中的任务和日期，未说明的信息保留待确认。");
  const submit = page.getByRole("button", { name: "提交验收", exact: true });
  await submit.click();
  const consent = page.getByRole("checkbox", {
    name: /本次模型验收可能产生的费用/,
  });
  await expect(consent).toBeFocused();
  await expect(consent).toHaveAttribute("aria-invalid", "true");
  expect(submissions()).toBe(0);
  await consent.check();
  await expect(consent).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".validation-summary")).toHaveCount(0);
  await submit.click();
  await expect(page.getByRole("dialog")).toContainText("本次尚未通过");
  expect(submissions()).toBe(1);
});
