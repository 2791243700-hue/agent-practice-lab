import { test, expect } from "../../apps/web/tests/browser";

// The existing full suite shares an API database and its early tests require
// an untouched catalog/profile state. Run this additive live workflow last.
for (const width of [1440, 390]) {
  test(`简版复盘自动带入两轮、恢复草稿、选做不阻断验收（${width}px）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    const headers = () => ({
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    });
    const connected = await page.request.post(
      "/api/v1/model-profiles/connect",
      {
        headers: headers(),
        data: {
          provider_id: "openai-compatible",
          api_key: "browser-test-only",
          base_url: "http://127.0.0.1:8101/v1",
          model_id: "browser-scripted-model",
          name: `简版验收 ${width}`,
        },
      },
    );
    expect(connected.status()).toBe(201);
    const { profile } = await connected.json();
    const checked = await page.request.post(
      `/api/v1/model-profiles/${profile.id}/check`,
      { headers: headers(), data: { expected_revision: profile.revision } },
    );
    expect((await checked.json()).connection_check.status).toBe("passed");
    const created = await page.request.post("/api/v1/attempts", {
      headers: headers(),
      data: { lesson_id: "01-task", lesson_version: "1.3.0", mode: "live" },
    });
    expect(created.status()).toBe(201);
    const attempt = await created.json();
    await page.goto(`/practice/${attempt.id}?profile=${profile.id}`);
    await page
      .getByRole("button", { name: "收起任务与设置侧栏", exact: true })
      .click();
    for (const [index, text] of [
      "帮我整理这段通知。",
      "帮我整理这段通知，按日期列清单。",
    ].entries()) {
      await page.getByLabel("任务说明", { exact: true }).fill(text);
      await page.getByRole("button", { name: "发送任务", exact: true }).click();
      await expect(page.getByText("本轮已完成", { exact: true })).toHaveCount(
        index + 1,
      );
    }
    const review = page.getByTestId("brief-review");
    await expect(
      review.getByRole("combobox", { name: "第一次尝试", exact: true }),
    ).not.toHaveValue("");
    await expect(
      review.getByRole("combobox", { name: "改进后的尝试", exact: true }),
    ).not.toHaveValue("");
    await expect(
      review.getByText("引用新增或改写的要求", { exact: true }),
    ).toHaveCount(0);
    await review.getByRole("radio", { name: "部分符合", exact: true }).check();
    await review
      .getByRole("textbox", { name: "你从哪里看出来的？", exact: true })
      .fill("无关乱填");
    await expect(review.getByRole("status")).toHaveText("复盘草稿已保存");
    await page.reload();
    await expect(
      review.getByRole("textbox", { name: "你从哪里看出来的？", exact: true }),
    ).toHaveValue("无关乱填");
    await page
      .getByLabel("我同意发送上述内容，并接受本次模型验收可能产生的费用。")
      .check();
    await review.getByRole("button", { name: "提交验收", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("本次尚未通过");
    await page
      .getByRole("button", { name: "留在当前关卡", exact: true })
      .click();
    await expect(
      review.getByRole("textbox", { name: "你从哪里看出来的？", exact: true }),
    ).toHaveValue("无关乱填");
    await review
      .getByRole("textbox", { name: "你从哪里看出来的？", exact: true })
      .fill("第二轮给出了事项，但还需要核对日期顺序。");
    await review
      .getByText("选做：再试一个情境（不影响通关）", { exact: true })
      .click();
    await review
      .getByRole("combobox", { name: "结束时间", exact: true })
      .selectOption("known");
    await review
      .getByRole("button", { name: "查看自查提示", exact: true })
      .click();
    await expect(review.getByTestId("optional-self-check")).toContainText(
      "结束时间、是否需要报名未说明",
    );
    await page
      .getByLabel("我同意发送上述内容，并接受本次模型验收可能产生的费用。")
      .check();
    const submitted = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/submissions"),
    );
    await review.getByRole("button", { name: "提交验收", exact: true }).click();
    const body = (await submitted).postDataJSON();
    expect(Object.keys(body.answers).sort()).toEqual([
      "baseline_run_id",
      "explanation",
      "judgment",
      "kind",
      "revised_run_id",
    ]);
    await expect(page.getByRole("dialog")).toContainText("本关已通关");
    await page
      .getByRole("button", { name: "留在当前关卡", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await review.screenshot({ path: testInfo.outputPath("brief-review.png") });
  });
}
