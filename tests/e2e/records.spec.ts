import { test, expect } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Attempt } from "../../apps/web/src/lib/types";

const examples = [
  { mode: "live", progress: "completed", status: "active", passed: true },
  { mode: "live", progress: "in_progress", status: "active", passed: false },
  { mode: "live", progress: "completed", status: "superseded", passed: true },
  { mode: "demo", progress: "completed", status: "active", passed: false },
] as const;

for (const width of [1440, 390]) {
  test(`学习记录右侧显示日期与红绿通关状态（${width}px）`, async ({ page }) => {
    const attempts: Attempt[] = examples.map((item, index) => ({
      id: `record-${index}`,
      owner_id: "local-owner",
      lesson_id: `lesson-${index}`,
      lesson_version: "1.0.0",
      mode: item.mode,
      progress: item.progress,
      status: item.status,
      revision: 1,
      settings: { system_instruction: "", temperature: 0.3 },
      selected_file_ids: [],
      active_run_id: null,
      latest_submission_id: null,
      reset_to_attempt_id: item.status === "superseded" ? "record-next" : null,
      created_at: "2026-10-19T16:08:00Z",
      updated_at: "2026-10-20T00:00:00Z",
    }));
    await page.route("**/api/v1/attempts?**", (route) =>
      route.fulfill({ json: { items: attempts, next_cursor: null } }),
    );
    await page.route("**/api/v1/lessons", (route) =>
      route.fulfill({
        json: {
          items: attempts.map((a, index) => ({
            id: a.lesson_id,
            title: [
              "让 Agent 理解任务",
              "给 Agent 足够的资料",
              "让 Agent 使用工具",
              "管理权限并检查成果",
            ][index],
          })),
        },
      }),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/records");
    const rows = page.locator(".records-list article");
    await expect(rows).toHaveCount(examples.length);
    for (let index = 0; index < examples.length; index++) {
      const row = rows.nth(index);
      const status = row.locator(".learning-status");
      await expect(status).toContainText("开始日期");
      await expect(status.locator("time")).toHaveAttribute(
        "datetime",
        attempts[index].created_at,
      );
      await expect(status.locator("time")).toContainText("2026/10/20");
      const pill = status.locator(".completion-pill");
      await expect(pill).toHaveText(
        examples[index].passed ? "已通关" : "未通关",
      );
      await expect(pill).toHaveCSS(
        "color",
        examples[index].passed ? "rgb(22, 101, 52)" : "rgb(180, 35, 24)",
      );
      await expect(row).not.toContainText(
        /v1\.0\.0|学习进行中|已重新开始，记录保留/,
      );
      if (width === 1440) {
        const statusBox = await status.boundingBox();
        const actionBox = await row.getByRole("link").boundingBox();
        expect(statusBox!.x).toBeGreaterThan(actionBox!.x + actionBox!.width);
      }
    }
    await expect(
      rows.nth(2).getByRole("link", { name: "回看记录" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const output = path.resolve(process.cwd(), "../../work");
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: path.join(output, `records-${width}.png`),
      fullPage: true,
    });
  });
}
