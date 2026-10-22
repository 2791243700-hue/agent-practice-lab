import { test, expect } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [1440, 390]) {
  test(`左侧任务设置默认展开，收起让出空间并保留输入（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/lessons/02-context");
    await page
      .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
      .click();
    const controls = page.locator("#practice-sidebar-content");
    const close = page.getByRole("button", {
      name: "收起任务与设置侧栏",
      exact: true,
    });
    const open = page.getByRole("button", {
      name: "展开任务与设置侧栏",
      exact: true,
    });
    const main = page.locator(".practice-main");
    await expect(close).toHaveAttribute("aria-expanded", "true");
    await expect(controls).toBeVisible();
    const before = await main.boundingBox();
    await page.getByRole("checkbox", { name: "课程通知" }).check();
    await page.getByText("调整 Agent 的工作方式", { exact: true }).click();
    const instruction = page.getByRole("textbox", {
      name: "系统指令",
      exact: true,
    });
    await instruction.fill("请依据所选材料，不猜测信息。");
    const input = page.getByLabel("任务说明", { exact: true });
    await input.fill("帮我整理材料里的事项");
    await close.click();
    await expect(controls).toBeHidden();
    await expect(open).toHaveAttribute("aria-expanded", "false");
    expect((await page.locator(".practice-sidebar").innerText()).trim()).toBe(
      "",
    );
    await expect(input).toHaveValue("帮我整理材料里的事项");
    await expect(page.locator(".composer-preparation")).toBeVisible();
    const after = await main.boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (width > 900) {
      expect(after!.width - before!.width).toBeGreaterThan(240);
      const sidebar = await page.locator(".practice-sidebar").boundingBox();
      expect(sidebar!.width).toBeLessThanOrEqual(40);
    } else {
      expect(after!.y).toBeLessThan(before!.y);
      expect(after!.width).toBeGreaterThanOrEqual(before!.width);
    }
    const screenshots = path.resolve(
      process.cwd(),
      "../../work/guidance-preview",
    );
    await mkdir(screenshots, { recursive: true });
    await page.locator(".practice-layout").screenshot({
      path: path.join(screenshots, `05-sidebar-closed-${width}.png`),
    });
    await open.focus();
    await open.press("Enter");
    await expect(controls).toBeVisible();
    await expect(instruction).toHaveValue("请依据所选材料，不猜测信息。");
    await expect(
      page.getByRole("checkbox", { name: "课程通知" }),
    ).toBeChecked();
    await close.click();
    await page.getByRole("link", { name: "前往设置 ↑" }).click();
    await expect(controls).toBeVisible();
    await expect(page.locator("#practice-preparation")).toBeFocused();
    await page.getByRole("button", { name: "保存下一轮设置" }).click();
    await expect(page.locator(".composer-preparation")).toHaveCount(0);

    await page.getByRole("button", { name: "预览原文", exact: true }).click();
    const preview = page.getByRole("region", { name: "课程通知预览" });
    await expect(preview).toBeFocused();
    await close.click();
    await expect(preview).toBeHidden();
    await open.click();
    await expect(preview).toContainText("2026-11-04");
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "预览原文", exact: true }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
