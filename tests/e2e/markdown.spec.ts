import { test, expect } from "../../apps/web/tests/browser";
import type { Run } from "../../apps/web/src/lib/types";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [1440, 390]) {
  test(`历史模型回答中的对比表格正确渲染且不撑破页面（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const created = await page.request.post("/api/v1/attempts", {
      headers: {
        Origin: "http://127.0.0.1:3100",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { lesson_id: "01-task", lesson_version: "1.0.0", mode: "live" },
    });
    expect(created.status()).toBe(201);
    const attempt = await created.json();
    const run: Run = {
      id: `markdown-fixture-${width}`,
      attempt_id: attempt.id,
      mode: "live",
      status: "completed",
      last_seq: 1,
      input_text: "比较两次任务说明的效果",
      snapshot: {
        settings: attempt.settings,
        selected_file_ids: [],
        profile_id: null,
        profile_revision: null,
        model: null,
      },
      pending_approval: null,
      usage: { model_calls: 1, input_tokens: null, output_tokens: null },
      error: null,
      created_at: attempt.created_at,
      started_at: attempt.created_at,
      ended_at: attempt.created_at,
    };
    const content =
      "两次结果比较：\n\n| 项目 | 第一次（简单要求） | 第二次（补充目标与限制） |\n| --- | --- | --- |\n| 输出内容 | 两项任务及截止日期 | 目标、信息边界与保存前批准 |\n| 信息完整性 | 较简略 | **更完整**，不猜测通知中未说明的信息 |\n\n待确认：是否需要继续整理？";
    await page.route(`**/api/v1/attempts/${attempt.id}/runs*`, (route) =>
      route.fulfill({ json: { items: [run], next_cursor: null } }),
    );
    await page.route(`**/api/v1/runs/${run.id}/event-history*`, (route) =>
      route.fulfill({
        json: {
          items: [
            {
              schema_version: "0.1.0",
              run_id: run.id,
              attempt_id: attempt.id,
              mode: "live",
              created_at: attempt.created_at,
              seq: 1,
              kind: "message.completed",
              payload: {
                message_id: "table-message",
                role: "assistant",
                content,
              },
            },
          ],
          next_after_seq: 1,
          has_more: false,
        },
      }),
    );
    await page.goto(`/practice/${attempt.id}`);
    const output = page.locator(".assistant-message .markdown");
    const table = output.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(
      table.getByRole("cell").filter({ hasText: "更完整" }),
    ).toBeVisible();
    await expect(output).toContainText("待确认：是否需要继续整理？");
    const scroller = output.getByRole("region", { name: "表格（可横向滚动）" });
    await scroller.scrollIntoViewIfNeeded();
    await scroller.focus();
    await expect(scroller).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 390) {
      expect(
        await scroller.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
      await scroller.press("ArrowRight");
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    }
    const screenshots = path.resolve(
      process.cwd(),
      "../../work/markdown-preview",
    );
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({
      path: path.join(screenshots, `table-${width}.png`),
    });
  });
}
