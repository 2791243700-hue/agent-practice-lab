import { test, expect } from "../../apps/web/tests/browser";
import { fillReflection } from "./reflection-helpers";

for (const width of [1440, 390]) {
  test(`正式模型验收拒绝乱填、失败不放行、主动修正通过并冻结历史（${width}px）`, async ({
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
          name: `正式评分测试 ${width}`,
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
      data: { lesson_id: "01-task", lesson_version: "1.2.0", mode: "live" },
    });
    const attempt = await created.json();
    await page.goto(`/practice/${attempt.id}?profile=${profile.id}`);
    await page
      .getByRole("button", { name: "收起任务与设置侧栏", exact: true })
      .click();
    for (const [index, text] of [
      "帮我整理课程通知。",
      "帮我整理课程通知。未说明的信息先向我确认。",
    ].entries()) {
      await page.getByLabel("任务说明", { exact: true }).fill(text);
      await page.getByRole("button", { name: "发送任务", exact: true }).click();
      await expect(page.getByText("本轮已完成", { exact: true })).toHaveCount(
        index + 1,
      );
    }
    await fillReflection(page, "未说明的信息先向我确认。");
    const explanation = page.getByLabel("结合引用，说说你的判断");
    const consent = page.getByRole("checkbox", {
      name: /本次模型验收可能产生的费用/,
    });
    const submit = page.getByRole("button", { name: "提交验收", exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(consent).toHaveAttribute("aria-invalid", "true");
    await expect(consent).toBeFocused();
    await page
      .getByRole("navigation", { name: "复盘步骤" })
      .getByRole("button", { name: /核对回答/ })
      .click();
    await explanation.fill("无关乱填");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(
      page.getByTestId("conversation-review").getByRole("status"),
    ).toContainText("复盘草稿已保存");
    await consent.check();
    await submit.click();
    const dialog = page.getByTestId("submission-dialog");
    await expect(dialog).toContainText("本次尚未通过");
    await expect(dialog).toContainText("解释没有说明引用与要求的关系");
    await page.getByText("查看详细验收记录", { exact: true }).click();
    await expect(page.getByTestId("model-assessment-result")).toContainText(
      "模型调用 1 次",
    );
    await dialog.screenshot({
      path: testInfo.outputPath(`model-failed-${width}.png`),
    });
    await page
      .getByRole("button", { name: "留在当前关卡", exact: true })
      .click();
    await expect(consent).not.toBeChecked();
    // The provider fixture simulates unavailable transport; the production code
    // must preserve the response as an incomplete, non-passing submission.
    await page
      .getByRole("navigation", { name: "复盘步骤" })
      .getByRole("button", { name: /核对回答/ })
      .click();
    await explanation.fill("模拟验收超时");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await consent.check();
    await submit.click();
    await expect(dialog).toContainText("模型验收未完成");
    await page.getByText("查看详细验收记录", { exact: true }).click();
    await expect(page.getByTestId("model-assessment-result")).toContainText(
      "MODEL_UNAVAILABLE",
    );
    await expect(page.getByTestId("model-assessment-result")).toContainText(
      "模型调用 1 次",
    );
    await page
      .getByRole("button", { name: "留在当前关卡", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "复盘步骤" })
      .getByRole("button", { name: /核对回答/ })
      .click();
    await explanation.fill(
      "我新增了不猜测缺失信息的限制，回答让我核对日期和来源；仍应继续确认未说明的具体提交方式。引用对应通知核对要求。",
    );
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await consent.check();
    await submit.click();
    await expect(dialog).toContainText("本关已通关");
    await page.getByText("查看详细验收记录", { exact: true }).click();
    await expect(page.getByTestId("model-assessment-result")).toContainText(
      "模型内容验收已完成",
    );
    await dialog.screenshot({
      path: testInfo.outputPath(`model-passed-${width}.png`),
    });
    await page
      .getByRole("button", { name: "留在当前关卡", exact: true })
      .click();
    const history = await (
      await page.request.get(`/api/v1/attempts/${attempt.id}/submissions`)
    ).json();
    expect(history.items).toHaveLength(3);
    expect(
      history.items.filter((s: { passed: boolean }) => s.passed),
    ).toHaveLength(1);
    const old = await (
      await page.request.get(`/api/v1/submissions/${history.items[2].id}`)
    ).json();
    expect(old.answers.explanation).toBe("无关乱填");
    expect(old.passed).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
