import { test, expect, type Page } from "../../apps/web/tests/browser";
import type {
  Attempt,
  Profile,
  Run,
  Schema,
} from "../../apps/web/src/lib/types";

async function fixture(
  page: Page,
  options: {
    ready?: boolean;
    needsMaterials?: boolean;
    completed?: boolean;
  } = {},
) {
  const attempt: Attempt = {
    id: "composer-fixture",
    owner_id: "local-owner",
    lesson_id: options.needsMaterials ? "02-context" : "01-task",
    lesson_version: "1.0.0",
    mode: "live",
    progress: "in_progress",
    status: "active",
    revision: 1,
    settings: { system_instruction: "", temperature: 0.3 },
    selected_file_ids: [],
    active_run_id: null,
    latest_submission_id: null,
    reset_to_attempt_id: null,
    created_at: "2026-10-27T00:00:00Z",
    updated_at: "2026-10-27T00:00:00Z",
  };
  const profile: Profile = {
    id: "composer-profile",
    name: "模拟学习模型",
    revision: 1,
    provider: "openai-compatible",
    base_url: "https://provider.example/v1",
    model: "test-model",
    credential_status: "configured",
    connection_check: {
      status: options.ready === false ? "failed" : "passed",
      text_ok: true,
      tools_ok: true,
      error_code: null,
      message: "模拟连接检查",
      checked_at: null,
    },
    created_at: attempt.created_at,
    updated_at: attempt.created_at,
  };
  const run: Run = {
    id: "composer-run",
    attempt_id: attempt.id,
    mode: "live",
    status: "completed",
    last_seq: 1,
    input_text: "根据通知整理待办事项",
    snapshot: {
      settings: attempt.settings,
      selected_file_ids: [],
      profile_id: profile.id,
      profile_revision: 1,
      model: profile.model,
    },
    pending_approval: null,
    usage: { model_calls: 1, input_tokens: 20, output_tokens: 20 },
    error: null,
    created_at: attempt.created_at,
    started_at: attempt.created_at,
    ended_at: attempt.created_at,
  };
  const tips: Schema["RunTips"] = {
    run_id: run.id,
    attempt_id: attempt.id,
    profile_id: profile.id,
    model: profile.model,
    created_at: attempt.created_at,
    assessment: "目标已经清楚，下一轮可以补充输出格式。",
    gaps: ["还没有规定输出方式。"],
    next_steps: ["试着要求用表格列出事项与截止日期。"],
    evidence: [],
    usage: run.usage,
    context_truncated: false,
  };
  let starts = 0,
    reads = 0,
    generations = 0;
  let saved: typeof tips | null = null;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      pathname.startsWith("/api/v1/lessons/") &&
      route.request().method() === "GET"
    )
      return route.continue();
    if (pathname === "/api/v1/model-profiles")
      return route.fulfill({ json: { items: [profile] } });
    if (pathname === `/api/v1/attempts/${attempt.id}`)
      return route.fulfill({ json: attempt });
    if (pathname.endsWith("/tips")) {
      if (route.request().method() === "GET") {
        reads++;
        return route.fulfill({ json: { tips: saved } });
      }
      generations++;
      saved = tips;
      return route.fulfill({ json: tips });
    }
    if (pathname === "/api/v1/runs" && route.request().method() === "POST") {
      starts++;
      expect(route.request().postDataJSON().input_text).toBe(
        "请根据课程通知整理任务",
      );
      await gate;
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "MODEL_UNAVAILABLE",
            message: "模拟失败",
            retryable: true,
            fields: [],
          },
        },
      });
    }
    if (pathname.endsWith("/runs"))
      return route.fulfill({
        json: { items: options.completed ? [run] : [], next_cursor: null },
      });
    if (pathname.endsWith("/event-history"))
      return route.fulfill({
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
                message_id: "composer-answer",
                role: "assistant",
                content: "已根据通知整理两项待办。请核对截止日期和来源。",
              },
            },
          ],
          next_after_seq: 1,
          has_more: false,
        },
      });
    if (pathname.startsWith(`/api/v1/attempts/${attempt.id}/`))
      return route.fulfill({ json: { items: [], next_cursor: null } });
    return route.abort();
  });
  await page.goto(`/practice/${attempt.id}`);
  await expect(page.getByLabel("任务说明", { exact: true })).toBeVisible();
  return {
    release,
    starts: () => starts,
    reads: () => reads,
    generations: () => generations,
  };
}

test("Ctrl+Enter 复用发送流程，输入法、换行和重复按键安全，首次提示仅记录使用标记", async ({
  page,
}) => {
  const state = await fixture(page);
  const input = page.getByLabel("任务说明", { exact: true });
  const hint = page.locator("#task-shortcut-hint");
  await expect(hint).toContainText("直接发送");
  await input.fill("第一行");
  await input.press("Enter");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("第一行\n\n");
  expect(state.starts()).toBe(0);
  await input.fill("  ");
  await input.press("Control+Enter");
  expect(state.starts()).toBe(0);
  await expect(hint).toBeVisible();
  await input.fill("请根据课程通知整理任务");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    isComposing: true,
  });
  await input.dispatchEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    repeat: true,
  });
  expect(state.starts()).toBe(0);
  await input.press("Control+Enter");
  await expect(page.getByTestId("pending-message")).toContainText(
    "请根据课程通知整理任务",
  );
  await expect(input).toHaveValue("");
  await page.keyboard.press("Control+Enter");
  expect(state.starts()).toBe(1);
  await expect(hint).toHaveCount(0);
  state.release();
  await expect(page.locator(".notice.error[role=alert]")).toContainText(
    "MODEL_UNAVAILABLE",
  );
  await expect(input).toHaveValue("请根据课程通知整理任务");
  expect(state.starts()).toBe(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("agent-practice-lab:task-shortcut-used"),
    ),
  ).toBe("1");
  await page.reload();
  await expect(input).toBeVisible();
  await expect(hint).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "发送任务", exact: true }),
  ).toContainText("Ctrl ↵");
});

for (const [name, options] of [
  ["连接未通过", { ready: false }],
  ["未选择必需材料", { needsMaterials: true }],
] as const) {
  test(`${name}时 Ctrl+Enter 与发送按钮都不发起运行`, async ({ page }) => {
    const state = await fixture(page, options);
    const input = page.getByLabel("任务说明", { exact: true });
    await input.fill("请根据课程通知整理任务");
    await expect(
      page.getByRole("button", { name: "发送任务", exact: true }),
    ).toBeDisabled();
    await input.press("Control+Enter");
    await expect(input).toHaveValue("请根据课程通知整理任务");
    await expect(page.getByTestId("pending-message")).toHaveCount(0);
    expect(state.starts()).toBe(0);
  });
}

for (const width of [1440, 390]) {
  test(`学习建议卡明显可见，展开不调用模型、确认后仅生成一次（${width}px）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await fixture(page, { completed: true });
    const panel = page.getByRole("region", {
      name: "本轮学习建议",
      exact: true,
    });
    const toggle = panel.getByRole("button", {
      name: "Tips · 本轮学习建议",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toContainText("不知道下一步怎么改？看看本轮建议");
    await expect(panel).toContainText("展开建议");
    expect(state.reads()).toBe(0);
    expect(state.generations()).toBe(0);
    await panel.screenshot({
      path: testInfo.outputPath(`tips-card-${width}.png`),
    });
    await page
      .locator(".composer")
      .screenshot({ path: testInfo.outputPath(`shortcut-hint-${width}.png`) });
    await toggle.click();
    await expect(
      panel.getByRole("button", { name: "生成 Tips", exact: true }),
    ).toBeDisabled();
    expect(state.reads()).toBe(1);
    expect(state.generations()).toBe(0);
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "生成 Tips", exact: true }).click();
    await expect(panel).toContainText("下一轮可以补充输出格式");
    await expect(panel).toContainText("建议已保存，可随时展开回看");
    await toggle.click();
    await toggle.click();
    expect(state.generations()).toBe(1);
    expect(state.reads()).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
