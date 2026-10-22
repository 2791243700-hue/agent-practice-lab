import { test, expect, type Page } from "../../apps/web/tests/browser";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function addKey(page: Page, name: string, key = "browser-test-only") {
  await page.getByRole("button", { name: "添加 Key", exact: true }).click();
  await page.getByLabel("API Key", { exact: true }).fill(key);
  await page
    .getByLabel("服务商", { exact: true })
    .selectOption("openai-compatible");
  await page.getByLabel("API 根地址").fill("http://127.0.0.1:8101/v1");
  await page.getByLabel("Key 名称（可选）").fill(name);
  await page
    .getByRole("button", { name: "识别并获取模型", exact: true })
    .click();
  await expect(page.getByLabel("选择模型", { exact: true })).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
}

test("多个 Key 的识别建议、模型发现、重命名、模型切换与独立删除", async ({
  page,
}) => {
  let imports = 0,
    checks = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/model-profiles/connect")
    )
      imports++;
    if (request.method() === "POST" && request.url().endsWith("/check"))
      checks++;
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "添加 Key", exact: true }).click();
  await page
    .getByLabel("API Key", { exact: true })
    .fill("sk-proj-synthetic-test");
  await expect(page.getByLabel("服务商", { exact: true })).toHaveValue(
    "openai",
  );
  expect(imports).toBe(0);
  await addKey(page, "课程 Key A");
  await expect(
    page.getByLabel("选择模型", { exact: true }).locator("option"),
  ).toHaveCount(2);
  expect(checks).toBe(0);
  await page.getByRole("checkbox", { name: /我知道连接检查/ }).check();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
  await page.getByLabel("Key 名称", { exact: true }).fill("课程 Key A 改名");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(
    page.getByText("Key 名称已更新。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
  expect(checks).toBe(1);
  await page
    .getByLabel("选择模型", { exact: true })
    .selectOption("browser-scripted-model");
  await expect(
    page.getByText("模型已切换，请重新检查连接。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("尚未通过连接检查", { exact: true }),
  ).toBeVisible();
  expect(checks).toBe(1);
  await addKey(page, "课程 Key B", "browser-test-secondary");
  await expect(page.locator(".key-card")).toHaveCount(2);
  await page.getByRole("button", { name: /^课程 Key A 改名/ }).click();
  await expect(page.getByLabel("选择模型", { exact: true })).toHaveValue(
    "browser-scripted-model",
  );
  await page.getByRole("button", { name: "清除当前 Key", exact: true }).click();
  await expect(page.getByLabel("选择模型", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /^课程 Key B/ }).click();
  await expect(page.getByLabel("选择模型", { exact: true })).toBeEnabled();
  await page
    .getByRole("button", { name: "删除 课程 Key A 改名", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除 Key", exact: true }).click();
  await expect(page.locator(".key-card")).toHaveCount(1);
  await expect(page.getByLabel("选择模型", { exact: true })).toBeEnabled();
  const profiles = await (
    await page.request.get("/api/v1/model-profiles")
  ).json();
  expect(JSON.stringify(profiles)).not.toContain("browser-test-secondary");
  expect(JSON.stringify(profiles)).not.toContain("browser-test-only");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("browser-test-");
  const output = path.resolve(process.cwd(), "../../work");
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, "key-manager-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(output, "key-manager-mobile.png"),
    fullPage: true,
  });
});

test("手动模型在重启后可重输 Key、检查连接，重新进入和刷新目录不误报失败", async ({
  page,
}) => {
  let profileReloads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().endsWith("/model-profiles"))
      profileReloads++;
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "添加 Key", exact: true }).click();
  await page.getByLabel("API Key", { exact: true }).fill("browser-test-only");
  await page
    .getByLabel("服务商", { exact: true })
    .selectOption("openai-compatible");
  await page.getByLabel("API 根地址").fill("http://127.0.0.1:8101/unsupported");
  await page
    .getByRole("button", { name: "识别并获取模型", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "MODEL_CATALOG_UNSUPPORTED",
  );
  await page.getByRole("checkbox", { name: /手动填写模型/ }).check();
  await page
    .getByLabel("模型名称", { exact: true })
    .fill("browser-scripted-model");
  await page.getByLabel("API Key", { exact: true }).fill("browser-test-only");
  await page.getByLabel("Key 名称（可选）").fill("手动配置 Key");
  await page
    .getByRole("button", { name: "添加 Key 并使用手动模型", exact: true })
    .click();
  await expect(
    page.getByText("当前模型为手动指定，访问权限尚需检查。", { exact: true }),
  ).toBeVisible();
  const restart = await page.request.post(
    "http://127.0.0.1:8101/__test/restart-backend",
    { headers: { "X-Test-Control": "browser-test-control" } },
  );
  expect(restart.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^手动配置 Key/ }).click();
  await expect(page.getByLabel("选择模型", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "检查连接", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("API Key", { exact: true }).fill("browser-test-only");
  await page.getByRole("button", { name: "提交 Key", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Key 已提交到本地后端内存",
  );
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("选择模型", { exact: true })).toHaveValue(
    "browser-scripted-model",
  );
  await expect(
    page.getByRole("button", { name: "检查连接", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /我知道连接检查/ }).check();
  profileReloads = 0;
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
  expect(profileReloads).toBe(1);
  await page.goto("/");
  await page.goto("/settings");
  await page.getByRole("button", { name: /^手动配置 Key/ }).click();
  await expect(
    page.getByRole("button", { name: "刷新模型列表", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "刷新模型列表", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "刷新模型列表", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
  await expect(
    page.getByText("当前模型为手动指定，访问权限尚需检查。", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("API Key", { exact: true })
    .fill("invalid-browser-test");
  await page.getByRole("button", { name: "提交 Key", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "MODEL_AUTH_FAILED",
  );
  await page.getByLabel("API Key", { exact: true }).fill("browser-test-only");
  await page.getByRole("button", { name: "提交 Key", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Key 已提交到本地后端内存",
  );
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
