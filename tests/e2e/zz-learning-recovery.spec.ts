import { test, expect, type Page } from "../../apps/web/tests/browser";

const headers = () => ({
  Origin: "http://127.0.0.1:3100",
  "Idempotency-Key": crypto.randomUUID(),
});
async function createAttempt(page: Page, lesson: string, version: string) {
  const response = await page.request.post("/api/v1/attempts", {
    headers: headers(),
    data: { lesson_id: lesson, lesson_version: version, mode: "live" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}
async function addProfile(page: Page, name: string) {
  const response = await page.request.post("/api/v1/model-profiles/connect", {
    headers: headers(),
    data: {
      name,
      provider_id: "openai-compatible",
      model_id: "browser-scripted-model",
      api_key: "browser-test-only",
      base_url: "http://127.0.0.1:8101/v1",
    },
  });
  expect(response.status()).toBe(201);
  const { profile } = await response.json();
  const checked = await page.request.post(
    "/api/v1/model-profiles/" + profile.id + "/check",
    { headers: headers(), data: { expected_revision: profile.revision } },
  );
  expect((await checked.json()).connection_check.status).toBe("passed");
  return profile.id as string;
}
const unavailable = {
  status: 503,
  json: {
    error: {
      code: "INTERNAL_ERROR",
      message: "读取失败",
      fields: [],
      retryable: true,
    },
  },
};

for (const lesson of ["02-context", "03-tools", "04-permission"]) {
  test(lesson + " 重新打开后可继续半份作答", async ({ page, context }) => {
    const profile = await addProfile(page, "草稿恢复 " + lesson);
    const id = await createAttempt(page, lesson, "1.1.0");
    await page.goto("/practice/" + id + "?profile=" + profile);
    await page
      .getByLabel("我的核对说明", { exact: true })
      .fill("我核对了任务中的日期。");
    let sourceValue = "";
    if (lesson === "02-context") {
      const row = page.locator(".fact-row").first();
      await row.getByLabel("截止日期").fill("2026-10-29");
      await row.getByLabel("依据来源").selectOption({ index: 1 });
      sourceValue = await row.getByLabel("依据来源").inputValue();
    }
    if (lesson === "03-tools") {
      await page.getByLabel("课程日期", { exact: true }).fill("2026-10-29");
      await page.getByLabel("教室", { exact: true }).fill("A301");
    }
    await page
      .getByRole("checkbox", { name: /我同意发送上述内容，并接受本次模型验收/ })
      .check();
    await expect(
      page.getByText("作答草稿已保存", { exact: true }),
    ).toBeVisible();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto("/records");
    await reopened.locator('a[href="/practice/' + id + '"]').click();
    await expect(
      reopened.getByRole("textbox", { name: "我的核对说明", exact: true }),
    ).toHaveValue("我核对了任务中的日期。");
    await expect(
      reopened.getByRole("checkbox", {
        name: /我同意发送上述内容，并接受本次模型验收/,
      }),
    ).not.toBeChecked();
    if (lesson === "02-context") {
      const row = reopened.locator(".fact-row").first();
      await expect(row.getByLabel("截止日期")).toHaveValue("2026-10-29");
      await expect(row.getByLabel("依据来源")).toHaveValue(sourceValue);
    }
    if (lesson === "03-tools") {
      await expect(
        reopened.getByLabel("课程日期", { exact: true }),
      ).toHaveValue("2026-10-29");
      await expect(reopened.getByLabel("教室", { exact: true })).toHaveValue(
        "A301",
      );
    }
  });
}

test("模型选择属于同一次实训，旧轮出错可单独恢复", async ({ page }) => {
  const a = await addProfile(page, "恢复 A");
  const b = await addProfile(page, "恢复 B");
  const id = await createAttempt(page, "01-task", "1.3.0");
  await page.goto("/practice/" + id + "?profile=" + a);
  const picker = page.getByRole("combobox", { name: "本轮模型", exact: true });
  await expect(picker).toHaveValue(a);
  await picker.selectOption(b);
  await page.reload();
  await expect(picker).toHaveValue(b);
  await expect(page.getByText(/验收模型：/)).toContainText("恢复 B");
  for (const [index, task] of [
    "整理本关通知",
    "根据本关通知列出任务与截止时间",
  ].entries()) {
    await page.getByLabel("任务说明", { exact: true }).fill(task);
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await expect(page.getByText("本轮已完成", { exact: true })).toHaveCount(
      index + 1,
    );
  }
  const { items } = await (
    await page.request.get("/api/v1/attempts/" + id + "/runs")
  ).json();
  const first = items.find(
    (run: { input_text: string }) => run.input_text === "整理本关通知",
  );
  expect(first.snapshot.profile_id).toBe(b);
  const broken = "**/api/v1/runs/" + first.id + "/event-history*";
  await page.route(broken, (r) => r.fulfill(unavailable));
  await page.reload();
  const retry = page.getByRole("button", { name: "重新读取第 1 轮" });
  await expect(retry).toBeVisible();
  await expect(page.getByLabel("任务说明", { exact: true })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "导出学习记录" }),
  ).toBeVisible();
  await expect(page.locator(".assistant-message .markdown")).toHaveCount(1);
  await page.unroute(broken);
  await retry.click();
  await expect(page.locator(".assistant-message .markdown")).toHaveCount(2);
  const link = "/practice/" + id + "?from=settings&profile=" + a;
  await page.goto(link);
  await expect(picker).toHaveValue(a);
  await page.route("**/api/v1/model-profiles", async (route) => {
    const response = await route.fetch();
    const { items } = await response.json();
    await route.fulfill({
      json: { items: items.filter((p: { id: string }) => p.id !== a) },
    });
  });
  await page.reload();
  await expect(page.getByText(/上次选择的模型当前不可用/)).toBeVisible();
  await expect(picker).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "发送任务", exact: true }),
  ).toBeDisabled();
});

test("记录与旧导读在临时故障后能就地重试", async ({ page }) => {
  for (const [url, pat] of [
    ["/records", "**/api/v1/attempts?*"],
    ["/lessons/01-task?version=1.2.0", "**/api/v1/lessons/01-task?version=*"],
  ]) {
    await page.route(pat, (r) => r.fulfill(unavailable));
    await page.goto(url);
    const retry = page.getByRole("button", { name: "重新加载" });
    await expect(retry).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    await page.unroute(pat);
    await retry.click();
    await expect(retry).toHaveCount(0);
    if (url === "/records")
      await expect(page.locator(".records-list, .panel.empty")).toBeVisible();
    else {
      const current = page.getByRole("link", { name: /查看最新版/ });
      await expect(current).toBeVisible();
      await current.click();
      await expect(page.getByRole("link", { name: /查看最新版/ })).toHaveCount(
        0,
      );
    }
  }
});

test("两个页面编辑同一作答时保留冲突文本，并可恢复服务端版本", async ({
  page,
  context,
}) => {
  const id = await createAttempt(page, "03-tools", "1.1.0");
  const path = "/practice/" + id;
  const second = await context.newPage();
  await Promise.all([page.goto(path), second.goto(path)]);
  const note = page.getByRole("textbox", { name: "我的核对说明" });
  const competing = second.getByRole("textbox", { name: "我的核对说明" });
  await expect(note).toBeEnabled();
  await expect(competing).toBeEnabled();
  await note.fill("已核对服务端日期");
  await expect(page.getByText("作答草稿已保存", { exact: true })).toBeVisible();
  await competing.fill("另一个标签页的核对内容");
  const conflict = second.getByRole("alert").filter({ hasText: "草稿未保存" });
  await expect(conflict).toBeVisible();
  await expect(competing).toHaveValue("另一个标签页的核对内容");
  await expect(
    conflict.getByRole("button", { name: "下载当前草稿备份" }),
  ).toBeVisible();
  second.once("dialog", (dialog) => dialog.accept());
  await conflict.getByRole("button", { name: "重新读取服务端草稿" }).click();
  await expect(competing).toHaveValue("已核对服务端日期");
  await expect(conflict).toHaveCount(0);
});
