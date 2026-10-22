import { test, expect } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const screenshots = path.resolve(process.cwd(), "../../work/guidance-preview");

test("四关例子使用不同于题目的生活情境，提醒仅在输入区按需显示", async ({
  page,
}) => {
  for (const id of ["01-task", "02-context", "03-tools", "04-permission"]) {
    await page.goto(`/lessons/${id}`);
    await page
      .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
      .click();
    const example = page.locator(".mission-example");
    await expect(
      example.getByRole("heading", { name: "举一个小例子" }),
    ).toBeVisible();
    await expect(example).not.toContainText(
      /课程通知|agent101|提交课程总结|预约实验室/,
    );
    const prepare = page.locator(".preparation-panel");
    await expect(prepare.locator(".notice, [role=status]")).toHaveCount(0);
    await expect(page.getByText("开始前必做", { exact: true })).toHaveCount(0);
    await page
      .getByLabel("任务说明", { exact: true })
      .fill("请帮我整理课程通知");
    if (id === "01-task" || id === "03-tools") {
      await expect(page.locator(".composer-preparation")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "发送任务", exact: true }),
      ).toBeEnabled();
    } else {
      await expect(page.locator(".composer-preparation")).toContainText(
        "选择材料并保存",
      );
      await expect(
        page.getByRole("button", { name: "发送任务", exact: true }),
      ).toBeDisabled();
    }
    if (id === "01-task") {
      await mkdir(screenshots, { recursive: true });
      await page
        .locator(".task-panel")
        .screenshot({ path: path.join(screenshots, "01-mission-example.png") });
    }
  }
});

test("材料准备提示随选择、保存、修改和刷新更新，移动端可定位设置", async ({
  page,
}) => {
  await page.goto("/lessons/02-context");
  await page
    .getByRole("button", { name: "先试试无 Key 演示（不计正式通过）" })
    .click();
  const send = page.getByRole("button", { name: "发送任务", exact: true });
  const material = page.getByRole("checkbox", { name: "课程通知" });
  const reminder = page.locator(".composer-preparation");
  await page
    .getByLabel("任务说明", { exact: true })
    .fill("请读取课程通知并整理待办");
  await expect(send).toBeDisabled();
  await expect(reminder).toContainText("选择材料并保存");
  await material.check();
  await expect(reminder).toContainText("材料或设置尚未保存");
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "保存下一轮设置" }).click();
  await expect(reminder).toHaveCount(0);
  await expect(send).toBeEnabled();
  await page.reload();
  await expect(material).toBeChecked();
  await expect(reminder).toHaveCount(0);
  await page
    .getByLabel("任务说明", { exact: true })
    .fill("请读取课程通知并整理待办");
  await page.getByText("调整 Agent 的工作方式", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "系统指令", exact: true })
    .fill("只使用选中的材料，不猜测日期。");
  await expect(send).toBeDisabled();
  await expect(reminder).toContainText("材料或设置尚未保存");
  await page.getByRole("button", { name: "保存下一轮设置" }).click();
  await expect(reminder).toHaveCount(0);
  await expect(send).toBeEnabled();
  await material.uncheck();
  await expect(reminder).toContainText("选择材料并保存");
  await expect(send).toBeDisabled();
  await page.getByText("调整 Agent 的工作方式", { exact: true }).click();
  await mkdir(screenshots, { recursive: true });
  await page.locator(".composer").screenshot({
    path: path.join(screenshots, "03-composer-reminder.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "前往设置 ↑" }).click();
  await expect(page.locator("#practice-preparation")).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
