import { test, expect } from "../../apps/web/tests/browser";
import type { Profile } from "../../apps/web/src/lib/types";

function profile(
  id: string,
  status: Profile["connection_check"]["status"],
): Profile {
  return {
    id,
    name: `测试连接 ${id}`,
    revision: 1,
    provider: "openai-compatible",
    base_url: "https://api.deepseek.com",
    model: "test-model-a",
    credential_status: "configured",
    connection_check: {
      status,
      text_ok: status === "passed",
      tools_ok: status === "passed",
      error_code: status === "failed" ? "MODEL_UNAVAILABLE" : null,
      message: "测试检查状态",
      checked_at: null,
    },
    created_at: "2026-10-27T00:00:00Z",
    updated_at: "2026-10-27T00:00:00Z",
  };
}

test("申领提示随当前连接的检查、模型变更与 Key 清除更新", async ({
  page,
}, testInfo) => {
  let current = profile("unchecked", "unchecked");
  let nextCheck: "passed" | "failed" = "failed";
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/model-profiles") {
      return route.fulfill({ json: { items: [current] } });
    }
    if (pathname.endsWith("/models")) {
      return route.fulfill({
        json: {
          items: [{ id: "test-model-a" }, { id: "test-model-b" }],
          source: "provider",
        },
      });
    }
    if (pathname.endsWith("/check") && request.method() === "POST") {
      current = {
        ...current,
        connection_check: profile("result", nextCheck).connection_check,
      };
      return route.fulfill({ json: current.connection_check });
    }
    if (request.method() === "PUT") {
      current = {
        ...current,
        model: request.postDataJSON().model,
        revision: current.revision + 1,
        connection_check: profile("changed", "unchecked").connection_check,
      };
      return route.fulfill({ json: current });
    }
    if (pathname.endsWith("/credential") && request.method() === "DELETE") {
      current = {
        ...current,
        credential_status: "missing",
        connection_check: profile("cleared", "unchecked").connection_check,
      };
      return route.fulfill({ status: 204 });
    }
    return route.abort();
  });
  await page.goto("/settings");
  const tip = page.getByRole("complementary", {
    name: "第一次配置模型？可以从 DeepSeek 开始",
  });
  await expect(tip).toBeVisible();
  await expect(tip.getByRole("link")).toHaveAttribute(
    "href",
    "https://platform.deepseek.com/api_keys",
  );
  await expect(tip.getByRole("link")).toHaveAttribute("target", "_blank");
  await page.screenshot({
    path: testInfo.outputPath("settings-tip-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("checkbox", { name: /我知道连接检查/ }).check();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByText("连接检查未通过", { exact: true })).toBeVisible();
  await expect(tip).toBeVisible();
  nextCheck = "passed";
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
  await expect(tip).toHaveCount(0);
  await page
    .getByLabel("选择模型", { exact: true })
    .selectOption("test-model-b");
  await expect(
    page.getByText("尚未通过连接检查", { exact: true }),
  ).toBeVisible();
  await expect(tip).toBeVisible();
  await page.getByRole("checkbox", { name: /我知道连接检查/ }).check();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(tip).toHaveCount(0);
  await page.getByRole("button", { name: "清除当前 Key", exact: true }).click();
  await expect(tip).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tip).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("settings-tip-mobile.png"),
    fullPage: true,
  });
});

test("没有连接时显示；重入已通过的连接时隐藏，切换未通过连接时恢复", async ({
  page,
}) => {
  let items: Profile[] = [];
  await page.route("**/api/v1/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/v1/model-profiles") {
      return route.fulfill({ json: { items } });
    }
    if (route.request().url().endsWith("/models")) {
      return route.fulfill({
        json: { items: [{ id: "test-model-a" }], source: "provider" },
      });
    }
    return route.abort();
  });
  const tip = page.getByRole("complementary", {
    name: "第一次配置模型？可以从 DeepSeek 开始",
  });
  await page.goto("/settings");
  await expect(tip).toBeVisible();
  items = [profile("passed", "passed"), profile("failed", "failed")];
  await page.reload();
  await expect(page.getByText("连接检查通过", { exact: true })).toBeVisible();
  await expect(tip).toHaveCount(0);
  await page.getByRole("button", { name: /^测试连接 failed/ }).click();
  await expect(tip).toBeVisible();
  await page.getByRole("button", { name: /^测试连接 passed/ }).click();
  await expect(tip).toHaveCount(0);
});
