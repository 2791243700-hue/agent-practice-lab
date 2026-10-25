import { expect, type Page } from "../../apps/web/tests/browser";
export async function fillReflection(
  page: Page,
  requirement: string,
  options: {
    wrongChallenge?: boolean;
    ids?: [string, string];
    judgment?: "satisfied" | "partial" | "unsatisfied";
  } = {},
) {
  const review = page.getByTestId("conversation-review");
  await expect(
    review.getByRole("combobox", { name: "第一次尝试", exact: true }),
  ).toBeEnabled();
  const before = review.getByRole("combobox", {
    name: "第一次尝试",
    exact: true,
  });
  const ids =
    options.ids ??
    ((await before
      .locator("option[value]:not([value=''])")
      .evaluateAll((items) =>
        items.map((item) => (item as HTMLOptionElement).value),
      )) as [string, string]);
  await before.selectOption(ids[0]);
  await review
    .getByRole("combobox", { name: "改进后的尝试", exact: true })
    .selectOption(ids[1]);
  await review.getByRole("button", { name: "下一步", exact: true }).click();
  await review
    .getByRole("combobox", { name: "主要改动是什么？", exact: true })
    .selectOption("constraint");
  await review.getByLabel("引用新增或改写的要求").fill(requirement);
  await review.getByRole("button", { name: "下一步", exact: true }).click();
  for (const [messageLabel, quoteLabel] of [
    ["第一次引用消息", "第一次回答的依据"],
    ["改进后引用消息", "改进后回答的依据"],
  ]) {
    const select = review.getByRole("combobox", {
      name: messageLabel,
      exact: true,
    });
    await select.selectOption({ index: 1 });
    const text = await select
      .locator("xpath=ancestor::article")
      .locator(".review-source-text")
      .textContent();
    await review
      .getByRole("textbox", { name: quoteLabel, exact: true })
      .fill(text!);
  }
  await review
    .getByRole("radio", {
      name: {
        satisfied: "满足要求",
        partial: "部分满足",
        unsatisfied: "没有满足",
      }[options.judgment ?? "satisfied"],
      exact: true,
    })
    .check();
  await review.getByLabel("结合引用，说说你的判断").fill("根据原文核对。");
  if (options.judgment && options.judgment !== "satisfied")
    await review
      .getByLabel("如果再试一次，你会怎样修改指令？")
      .fill("请注明来源。");
  await review.getByRole("button", { name: "下一步", exact: true }).click();
  for (const name of ["开始时间", "集合地点"])
    await review
      .getByRole("combobox", { name, exact: true })
      .selectOption("known");
  await review
    .getByRole("combobox", { name: "结束时间", exact: true })
    .selectOption(options.wrongChallenge ? "known" : "confirm");
  await review
    .getByRole("combobox", { name: "是否需要报名", exact: true })
    .selectOption("confirm");
  await review
    .getByLabel("给 Agent 补充一条要求")
    .fill("请先确认没有说明的信息。");
}
