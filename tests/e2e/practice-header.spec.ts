import { test, expect } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Attempt } from "../../apps/web/src/lib/types";

for (const width of [1440, 390]) {
  test(`实训顶部紧凑排列，日期可通过键盘查看且功能入口保留（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const attempt: Attempt = {
      id: `header-fixture-${width}`,
      owner_id: "local-owner",
      lesson_id: "01-task",
      lesson_version: "1.0.0",
      mode: "live",
      progress: "in_progress",
      status: "active",
      revision: 1,
      settings: { system_instruction: "", temperature: 0.3 },
      selected_file_ids: [],
      active_run_id: null,
      latest_submission_id: null,
      reset_to_attempt_id: null,
      created_at: "2026-10-19T16:08:00Z",
      updated_at: "2026-10-20T00:00:00Z",
    };
    await page.route(`**/api/v1/attempts/${attempt.id}/**`, (route) =>
      route.fulfill({ json: { items: [], next_cursor: null } }),
    );
    await page.route(`**/api/v1/attempts/${attempt.id}`, (route) =>
      route.fulfill({ json: attempt }),
    );
    await page.goto(`/practice/${attempt.id}`);
    const header = page.locator(".practice-header");
    await expect(
      header.getByRole("heading", { name: "让 Agent 理解任务", exact: true }),
    ).toBeVisible();
    await expect(header.locator(".completion-pill")).toHaveText("未通关");
    await expect(header.locator(".practice-crumbs")).toContainText("正式实训");
    await expect(page.locator(".topbar")).toHaveCount(0);
    await expect(header.locator(".eyebrow")).toHaveCount(0);
    const date = header.locator("time");
    await expect(date).toBeHidden();
    const before = await page.locator(".practice-layout").boundingBox();
    const main = await page.locator("#main").boundingBox();
    expect(before!.y - main!.y).toBeLessThan(180);
    const info = header.locator(".practice-info > summary");
    await expect(info).toHaveAccessibleName("实训信息");
    await info.focus();
    await info.press("Enter");
    await expect(date).toBeVisible();
    await expect(date).toHaveAttribute("datetime", attempt.created_at);
    const expectedDate = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(attempt.created_at));
    await expect(date).toHaveText(expectedDate);
    await expect(header.locator(".practice-info-popover")).toContainText(
      "1.0.0",
    );
    const during = await page.locator(".practice-layout").boundingBox();
    expect(during!.y).toBe(before!.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await info.press("Escape");
    await expect(date).toBeHidden();
    await expect(info).toBeFocused();
    await header.getByRole("button", { name: "查看本关介绍" }).click();
    await expect(page.locator(".intro-review")).toBeVisible();
    await header.getByRole("button", { name: "收起导读" }).click();
    await expect(page.locator(".intro-review")).toHaveCount(0);
    const screenshots = path.resolve(
      process.cwd(),
      "../../work/guidance-preview",
    );
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, `06-header-${width}.png`),
    });
    attempt.progress = "completed";
    attempt.mode = "demo";
    await page.reload();
    await expect(header.locator(".completion-pill")).toHaveText("未通关");
    await expect(header.locator(".practice-crumbs")).toContainText("演示练习");
    attempt.mode = "live";
    await page.reload();
    await expect(header.locator(".completion-pill")).toHaveText("已通关");
    await header.getByRole("link", { name: "使用帮助" }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.locator(".topbar")).toBeVisible();
    await page.goto(`/practice/${attempt.id}`);
    await page.getByRole("link", { name: "全部课程", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
}
