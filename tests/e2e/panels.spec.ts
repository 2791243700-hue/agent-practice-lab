import { test, expect } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";

for (const width of [1440, 390]) {
  test(`实训板块可折叠并保留设置，定位与预览自动展开（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/lessons/02-context");
    await page
      .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
      .click();
    const titles = ["这一关，做什么？", "材料与 Agent 设置", "产物与原文预览"];
    const panels = [
      "#practice-mission",
      "#practice-preparation",
      "#practice-artifacts",
    ];
    for (let i = 0; i < titles.length; i++) {
      const toggle = page.getByRole("button", { name: titles[i], exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.locator(`${panels[i]} > .practice-panel-content`),
      ).toBeHidden();
      expect((await page.locator(panels[i]).innerText()).trim()).toBe(
        titles[i],
      );
    }
    const screenshots = path.resolve(
      process.cwd(),
      "../../work/guidance-preview",
    );
    await mkdir(screenshots, { recursive: true });
    await page.locator(".practice-controls").screenshot({
      path: path.join(screenshots, `04-collapsed-${width}.png`),
    });
    const mission = page.getByRole("button", { name: titles[0], exact: true });
    await mission.focus();
    await mission.press("Enter");
    await expect(page.locator(".mission-example")).toBeVisible();
    await mission.press("Space");
    await expect(page.locator(".mission-example")).toBeHidden();

    await page.getByRole("link", { name: "前往设置 ↑" }).click();
    await expect(page.locator("#practice-preparation")).toBeFocused();
    await expect(
      page.getByRole("button", { name: titles[1], exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    const material = page.getByRole("checkbox", { name: "课程通知" });
    await material.check();
    await page.getByText("调整 Agent 的工作方式", { exact: true }).click();
    const instruction = page.getByRole("textbox", {
      name: "系统指令",
      exact: true,
    });
    await instruction.fill("只根据所选资料回答，不猜测缺失信息。");
    await page.getByRole("button", { name: titles[1], exact: true }).click();
    await expect(page.locator(".composer-preparation")).toBeVisible();
    await page.getByRole("link", { name: "前往设置 ↑" }).click();
    await expect(material).toBeChecked();
    await expect(instruction).toHaveValue(
      "只根据所选资料回答，不猜测缺失信息。",
    );
    await page.getByRole("button", { name: "保存下一轮设置" }).click();
    await expect(page.locator(".composer-preparation")).toHaveCount(0);

    const opener = page.getByRole("button", { name: "预览原文", exact: true });
    await opener.click();
    const preview = page.getByRole("region", { name: "课程通知预览" });
    await expect(
      page.getByRole("button", { name: titles[2], exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(preview).toContainText("2026-11-04");
    await expect(preview).toBeFocused();
    await page.getByRole("button", { name: titles[2], exact: true }).click();
    await expect(preview).toBeHidden();
    await page.getByRole("button", { name: titles[2], exact: true }).click();
    await expect(preview).toContainText("2026-11-04");
    await page.getByRole("button", { name: titles[1], exact: true }).click();
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    await expect(opener).toBeFocused();
    await expect(material).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
