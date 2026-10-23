import { test, expect, type Page } from "../../apps/web/tests/browser";
import type { Profile, Run, Schema } from "../../apps/web/src/lib/types";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const profile: Profile = {
  id: "tips-profile",
  revision: 7,
  name: "学习模型",
  provider: "openai-compatible",
  base_url: "https://provider.example/v1",
  model: "teaching-model",
  credential_status: "configured",
  connection_check: {
    status: "passed",
    text_ok: true,
    tools_ok: true,
    error_code: null,
    message: "",
    checked_at: "2026-10-23T00:00:00Z",
  },
  created_at: "2026-10-23T00:00:00Z",
  updated_at: "2026-10-23T00:00:00Z",
};

async function fixture(page: Page, profiles: Profile[] = [profile]) {
  const created = await page.request.post("/api/v1/attempts", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { lesson_id: "01-task", lesson_version: "1.0.0", mode: "live" },
  });
  expect(created.status()).toBe(201);
  const attempt = await created.json();
  const run: Run = {
    id: `tips-${attempt.id}`,
    attempt_id: attempt.id,
    mode: "live",
    status: "completed",
    last_seq: 1,
    input_text: "请整理今天的任务",
    snapshot: {
      settings: attempt.settings,
      selected_file_ids: [],
      profile_id: null,
      profile_revision: null,
      model: null,
    },
    pending_approval: null,
    usage: { model_calls: 1, input_tokens: 40, output_tokens: 20 },
    error: null,
    created_at: attempt.created_at,
    started_at: attempt.created_at,
    ended_at: attempt.created_at,
  };
  await page.route("**/api/v1/model-profiles", (route) =>
    route.fulfill({ json: { items: profiles } }),
  );
  await page.route(`**/api/v1/attempts/${attempt.id}/runs*`, (route) =>
    route.fulfill({ json: { items: [run], next_cursor: null } }),
  );
  await page.route(`**/api/v1/runs/${run.id}/event-history*`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            schema_version: "0.1.0",
            run_id: run.id,
            attempt_id: attempt.id,
            mode: "live",
            created_at: attempt.created_at,
            seq: 1,
            kind: "message.completed",
            payload: {
              message_id: "tips-answer",
              role: "assistant",
              content:
                "已整理任务。\n\n这段旧回答的完整说明必须保留。\n\n最后一项原始内容。",
            },
          },
        ],
        next_after_seq: 1,
        has_more: false,
      },
    }),
  );
  const tips: Schema["RunTips"] = {
    run_id: run.id,
    attempt_id: attempt.id,
    profile_id: profile.id,
    model: profile.model,
    created_at: attempt.created_at,
    assessment: "目标明确，还可补充限制。",
    gaps: ["缺少截止时间。"],
    next_steps: ["补充时间后再尝试。"],
    evidence: ["任务说明未提及完成日期。"],
    usage: { model_calls: 1, input_tokens: 100, output_tokens: 60 },
    context_truncated: true,
  };
  return {
    attempt,
    run,
    tips,
    panel: page.getByRole("region", { name: "本轮学习建议", exact: true }),
  };
}

test("Tips waits for explicit consent, posts once, and reuses saved content across collapse and reload", async ({
  page,
}) => {
  const { attempt, run, tips, panel } = await fixture(page);
  let gets = 0;
  let posts = 0;
  let saved: Schema["RunTips"] | null = null;
  let releaseGeneration = () => {};
  const generation = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });
  await page.route(`**/api/v1/runs/${run.id}/tips`, async (route) => {
    if (route.request().method() === "GET") {
      gets++;
      await route.fulfill({ json: { tips: saved } });
    } else {
      posts++;
      expect(route.request().postDataJSON()).toEqual({
        profile_id: profile.id,
        expected_profile_revision: 7,
      });
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      saved = tips;
      await generation;
      await route.fulfill({ json: saved });
    }
  });
  await page.goto(`/practice/${attempt.id}`);
  const toggle = panel.getByRole("button", { name: "Tips · 本轮学习建议" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(gets).toBe(0);
  expect(posts).toBe(0);
  await toggle.click();
  const generate = panel.getByRole("button", {
    name: "生成 Tips",
    exact: true,
  });
  await expect(generate).toBeDisabled();
  await expect(panel).toContainText("发送到所选模型服务商");
  await expect(panel).toContainText(profile.base_url);
  expect(posts).toBe(0);
  await panel.getByRole("checkbox").check();
  await generate.click();
  await expect(panel.getByRole("status")).toContainText("正在生成 Tips");
  await toggle.click();
  await toggle.click();
  await expect(panel.getByRole("status")).toContainText("正在生成 Tips");
  expect(posts).toBe(1);
  releaseGeneration();
  await expect(panel).toContainText(tips.assessment);
  await expect(panel).toContainText("模型建议，不代表正式通关");
  await expect(panel).toContainText("只使用了部分上下文");
  await expect(panel).toContainText(tips.gaps[0]);
  await expect(panel).toContainText(tips.next_steps[0]);
  await expect(
    panel.getByRole("heading", { name: "依据", exact: true }),
  ).toHaveCount(0);
  await expect(panel).not.toContainText(tips.evidence[0]);
  await expect(page.locator(".assistant-message")).toContainText(
    "最后一项原始内容。",
  );
  await toggle.click();
  await toggle.click();
  await expect(panel).toContainText(tips.assessment);
  expect(gets).toBe(1);
  expect(posts).toBe(1);
  // Saved advice remains readable after credentials are removed.
  await page.route("**/api/v1/model-profiles", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.reload();
  await toggle.click();
  await expect(panel).toContainText(tips.assessment);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  expect(posts).toBe(1);
  expect(gets).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toContainText(tips.assessment);
  await panel.scrollIntoViewIfNeeded();
  const screenshots = path.resolve(process.cwd(), "../../work/tips-preview");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, "tips-mobile.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("failed Tips generation supports an explicit retry with the same idempotency key", async ({
  page,
}) => {
  const { attempt, run, tips, panel } = await fixture(page);
  const keys: string[] = [];
  await page.route(`**/api/v1/runs/${run.id}/tips`, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { tips: null } });
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 1)
      return route.fulfill({
        status: 502,
        json: {
          error: {
            code: "MODEL_TIMEOUT",
            message: "timeout",
            retryable: true,
            fields: [],
          },
        },
      });
    await route.fulfill({ json: tips });
  });
  await page.goto(`/practice/${attempt.id}`);
  await panel.getByRole("button", { name: "Tips · 本轮学习建议" }).click();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "生成 Tips", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("MODEL_TIMEOUT");
  expect(keys).toHaveLength(1);
  await panel.getByRole("button", { name: "重试生成 Tips" }).click();
  await expect(panel).toContainText(tips.assessment);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("Tips read errors can retry safely and missing credentials prevent generation", async ({
  page,
}) => {
  const { attempt, run, panel } = await fixture(page, []);
  let reads = 0;
  let posts = 0;
  await page.route(`**/api/v1/runs/${run.id}/tips`, async (route) => {
    if (route.request().method() !== "GET") {
      posts++;
      return route.fulfill({ status: 500 });
    }
    reads++;
    if (reads === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "MODEL_TIMEOUT",
            message: "unavailable",
            retryable: true,
            fields: [],
          },
        },
      });
    await route.fulfill({ json: { tips: null } });
  });
  await page.goto(`/practice/${attempt.id}`);
  await panel.getByRole("button", { name: "Tips · 本轮学习建议" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("button", { name: "重新加载" }).click();
  await expect(
    panel.getByRole("button", { name: "生成 Tips", exact: true }),
  ).toBeDisabled();
  await expect(panel.getByRole("checkbox")).toBeDisabled();
  expect(reads).toBe(2);
  expect(posts).toBe(0);
});

test("real Tips generation persists one model result and remains readable after clearing its key", async ({
  page,
}) => {
  const headers = {
    Origin: "http://127.0.0.1:3100",
    "Idempotency-Key": crypto.randomUUID(),
  };
  const createProfile = await page.request.post("/api/v1/model-profiles", {
    headers,
    data: {
      name: "Tips 实际流程",
      provider: "openai-compatible",
      base_url: "http://127.0.0.1:8101/v1",
      model: "browser-scripted-model",
    },
  });
  expect(createProfile.status()).toBe(201);
  let readyProfile: Profile = await createProfile.json();
  const credential = await page.request.put(
    `/api/v1/model-profiles/${readyProfile.id}/credential`,
    {
      headers: { Origin: headers.Origin },
      data: {
        expected_revision: readyProfile.revision,
        api_key: "browser-test-only",
      },
    },
  );
  expect(credential.ok()).toBe(true);
  readyProfile = await credential.json();
  const check = await page.request.post(
    `/api/v1/model-profiles/${readyProfile.id}/check`,
    {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { expected_revision: readyProfile.revision },
    },
  );
  expect(check.ok()).toBe(true);
  readyProfile = await check.json();
  expect(readyProfile.connection_check.status).toBe("passed");
  const createAttempt = await page.request.post("/api/v1/attempts", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { lesson_id: "01-task", lesson_version: "1.0.0", mode: "live" },
  });
  expect(createAttempt.status()).toBe(201);
  const attempt = await createAttempt.json();
  await page.goto(`/practice/${attempt.id}?profile=${readyProfile.id}`);
  await page
    .getByLabel("任务说明", { exact: true })
    .fill("请整理今天的任务，并说明完成结果。");
  await page.getByRole("button", { name: "发送任务", exact: true }).click();
  await expect(page.getByText("本轮已完成", { exact: true })).toBeVisible();
  const runs = await (
    await page.request.get(`/api/v1/attempts/${attempt.id}/runs`)
  ).json();
  const runId = runs.items[0].id;
  const before = await page.request.get(`/api/v1/runs/${runId}/tips`);
  expect(await before.json()).toEqual({ tips: null });
  const panel = page.getByRole("region", { name: "本轮学习建议", exact: true });
  await panel.getByRole("button", { name: "Tips · 本轮学习建议" }).click();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "生成 Tips", exact: true }).click();
  await expect(panel).toContainText("任务结果已给出，仍需核对完成依据。");
  const saved = await (
    await page.request.get(`/api/v1/runs/${runId}/tips`)
  ).json();
  expect(saved.tips.usage.model_calls).toBe(1);
  expect(saved.tips.profile_id).toBe(readyProfile.id);
  const clear = await page.request.delete(
    `/api/v1/model-profiles/${readyProfile.id}/credential?expected_revision=${readyProfile.revision}`,
    {
      headers: { Origin: headers.Origin },
    },
  );
  expect(clear.ok()).toBe(true);
  await page.reload();
  await panel.getByRole("button", { name: "Tips · 本轮学习建议" }).click();
  await expect(panel).toContainText(saved.tips.assessment);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  const after = await (
    await page.request.get(`/api/v1/runs/${runId}/tips`)
  ).json();
  expect(after).toEqual(saved);
});
