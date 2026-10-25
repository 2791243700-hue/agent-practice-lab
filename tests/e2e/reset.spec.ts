import { test, expect } from "../../apps/web/tests/browser";

test("重置保留当前手动选择的 Key 和连接检查，刷新后无需配置即可发送", async ({
  page,
}) => {
  const headers = () => ({
    Origin: "http://127.0.0.1:3100",
    "Idempotency-Key": crypto.randomUUID(),
  });
  const profiles = [];
  for (const suffix of ["默认", "当前选择"]) {
    const connected = await page.request.post(
      "/api/v1/model-profiles/connect",
      {
        headers: headers(),
        data: {
          provider_id: "openai-compatible",
          api_key: "browser-test-only",
          base_url: "http://127.0.0.1:8101/v1",
          model_id: "browser-scripted-model",
          name: `重置模型保留-${suffix}`,
        },
      },
    );
    expect(connected.status()).toBe(201);
    const { profile } = await connected.json();
    const checked = await page.request.post(
      `/api/v1/model-profiles/${profile.id}/check`,
      {
        headers: headers(),
        data: { expected_revision: profile.revision },
      },
    );
    expect(checked.status()).toBe(200);
    const ready = await checked.json();
    expect(ready.connection_check.status).toBe("passed");
    profiles.push(ready);
  }
  const response = await page.request.post("/api/v1/attempts", {
    headers: headers(),
    data: { lesson_id: "01-task", lesson_version: "1.0.0", mode: "live" },
  });
  expect(response.status()).toBe(201);
  const attempt = await response.json();
  await page.goto(`/practice/${attempt.id}?profile=${profiles[0].id}`);
  const picker = page.getByRole("combobox", { name: "本轮模型" });
  await picker.selectOption(profiles[1].id);
  await expect(picker).toHaveValue(profiles[1].id);
  let configurationWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.url().includes("/api/v1/model-profiles")
    )
      configurationWrites++;
  });
  await page.getByRole("button", { name: "重置环境", exact: true }).click();
  await page.getByRole("button", { name: "确认重置环境", exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`/practice/${attempt.id}\\?`));
  await expect(picker).toHaveValue(profiles[1].id);
  await page.reload();
  await expect(picker).toHaveValue(profiles[1].id);
  await expect(
    page.getByText("请先配置模型、输入 Key 并通过连接检查。"),
  ).toHaveCount(0);
  await page
    .getByLabel("任务说明", { exact: true })
    .fill("列出通知中的两项任务。");
  const start = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/v1/runs"),
  );
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  expect((await start).postDataJSON().profile_id).toBe(profiles[1].id);
  await expect(page.getByText("本轮已完成", { exact: true })).toBeVisible();
  expect(configurationWrites).toBe(0);
  for (const profile of profiles) {
    const retained = await (
      await page.request.get(`/api/v1/model-profiles/${profile.id}`)
    ).json();
    expect(retained).toEqual(profile);
  }
});

for (const width of [1440, 390]) {
  test(`顶部重置环境可取消，确认后恢复本关默认环境并保留旧记录和 Key（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const headers = {
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    };
    const created = await page.request.post("/api/v1/attempts", {
      headers,
      data: { lesson_id: "02-context", lesson_version: "1.0.0", mode: "live" },
    });
    expect(created.status()).toBe(201);
    const original = await created.json();
    const changed = await page.request.patch(
      `/api/v1/attempts/${original.id}`,
      {
        headers,
        data: {
          expected_revision: original.revision,
          settings: {
            system_instruction: "重置前的自定义设置",
            temperature: 0.8,
          },
          selected_file_ids: ["notice-week"],
        },
      },
    );
    expect(changed.ok()).toBe(true);
    const profileResponse = await page.request.post("/api/v1/model-profiles", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        name: "重置保留凭据测试",
        provider: "openai-compatible",
        base_url: "http://127.0.0.1:8101/v1",
        model: "browser-scripted-model",
      },
    });
    expect(profileResponse.status()).toBe(201);
    const profile = await profileResponse.json();
    const credential = await page.request.put(
      `/api/v1/model-profiles/${profile.id}/credential`,
      {
        headers,
        data: {
          expected_revision: profile.revision,
          api_key: "browser-test-only",
        },
      },
    );
    expect(credential.ok()).toBe(true);
    const savedProfile = await credential.json();
    let resetRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/reset"))
        resetRequests++;
    });
    await page.goto(`/practice/${original.id}`);
    const trigger = page
      .locator(".practice-header")
      .getByRole("button", { name: "重置环境", exact: true });
    await expect(trigger).toBeInViewport();
    await trigger.click();
    const confirmation = page.getByRole("region", { name: "重置当前关卡环境" });
    await expect(confirmation).toBeInViewport();
    await confirmation
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(confirmation).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(resetRequests).toBe(0);
    await trigger.click();
    await confirmation
      .getByRole("button", { name: "确认重置环境", exact: true })
      .click();
    await expect(page).not.toHaveURL(new RegExp(`/practice/${original.id}$`));
    const old = await (
      await page.request.get(`/api/v1/attempts/${original.id}`)
    ).json();
    expect(old.status).toBe("superseded");
    expect(old.settings.system_instruction).toBe("重置前的自定义设置");
    const fresh = await (
      await page.request.get(`/api/v1/attempts/${old.reset_to_attempt_id}`)
    ).json();
    expect(fresh.settings).toEqual(original.settings);
    expect(fresh.selected_file_ids).toEqual(original.selected_file_ids);
    expect(fresh.lesson_version).toBe(original.lesson_version);
    expect(fresh.mode).toBe("live");
    expect(fresh.progress).toBe("not_started");
    const retained = await (
      await page.request.get(`/api/v1/model-profiles/${profile.id}`)
    ).json();
    expect(retained).toEqual(savedProfile);
    expect(resetRequests).toBe(1);
    await page.goto(`/practice/${original.id}`);
    await expect(
      page
        .locator(".practice-header")
        .getByRole("button", { name: "重置环境", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "继续新的实验" }),
    ).toBeVisible();
  });
}
