import { test, expect } from "../../apps/web/tests/browser";

for (const width of [1440, 390]) {
  test(`原文预览自动进入视口并支持关闭后重新打开（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/lessons/01-task");
    await page
      .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
      .click();
    const prepare = page.locator("section").filter({
      has: page.getByRole("heading", { name: "材料与 Agent 设置" }),
    });
    await prepare.getByText("调整 Agent 的工作方式", { exact: true }).click();
    const opener = prepare.getByRole("button", { name: "预览原文" });
    const selection = prepare.getByRole("checkbox", { name: "课程通知" });
    await expect(selection).not.toBeChecked();
    for (let index = 0; index < 2; index++) {
      await opener.click();
      const preview = page.locator(".file-preview");
      await expect(preview).toContainText("2026-11-04");
      await expect(preview).toBeInViewport({ ratio: 0.8 });
      await expect(preview).toBeFocused();
      await preview.getByRole("button", { name: "关闭预览" }).click();
      await expect(preview).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
    await expect(selection).not.toBeChecked();
  });
}
