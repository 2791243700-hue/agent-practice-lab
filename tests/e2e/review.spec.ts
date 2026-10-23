import { test, expect } from "../../apps/web/tests/browser";

test("历史实验保持只读，材料原文仍可预览与下载", async ({ page }) => {
  await page.goto("/lessons/02-context");
  await page
    .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
    .click();
  await expect(page).toHaveURL(/\/practice\//);
  await page.getByRole("checkbox", { name: "课程通知" }).check();
  await page.getByRole("button", { name: "保存下一轮设置" }).click();
  await expect(page.getByRole("button", { name: "设置已同步" })).toBeDisabled();
  const oldUrl = page.url();
  await page.getByRole("button", { name: "重置环境", exact: true }).click();
  await page.getByRole("button", { name: "确认重置环境", exact: true }).click();
  await expect(page).not.toHaveURL(oldUrl);
  await page.goto(oldUrl);
  await expect(
    page.getByText("此实验已重新开始，旧记录仍可回看和导出。", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "课程通知" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "课程通知" })).toBeDisabled();
  const preview = page
    .getByRole("button", { name: "预览原文", exact: true })
    .first();
  await expect(preview).toBeEnabled();
  await preview.click();
  await expect(
    page.getByRole("region", { name: "课程通知预览" }),
  ).toContainText("2026-11-04");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载完整文件" }).click();
  expect((await download).suggestedFilename()).toBeTruthy();
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(preview).toBeFocused();
  await expect(page.getByRole("button", { name: "设置已同步" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "发送任务", exact: true }),
  ).toHaveCount(0);
});
