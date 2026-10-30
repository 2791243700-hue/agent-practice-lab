import {
  test,
  expect,
  type Page,
  type Dialog,
} from "../../apps/web/tests/browser";
import { readFile } from "node:fs/promises";
import type {
  Attempt,
  Event,
  Lesson,
  Run,
  Schema,
  Submission,
} from "../../apps/web/src/lib/types";
import { fillReflection } from "./reflection-helpers";
const settings = {
  system_instruction: "根据通知整理，不猜测缺失信息。",
  temperature: 0.3,
};
const requirement = "未说明的信息先向我确认。";
const texts = ["😀日期未知；日期未知", "😀日期已列；日期已列"];
const lesson: Lesson = {
  id: "01-task",
  version: "1.1.0",
  title: "让 Agent 理解任务",
  description: "虚构复盘场景",
  order: 1,
  objectives: [],
  completion_criteria: [],
  allowed_tools: [],
  settings_policy: {
    defaults: settings,
    editable_fields: ["system_instruction", "temperature"],
  },
  limits: {
    max_model_calls: 10,
    execution_timeout_seconds: 120,
    approval_timeout_seconds: 600,
  },
  completed: false,
  intro_markdown: "复盘测试导读",
  task_markdown: "比较两轮指令与回答。",
  materials: [],
  answer_form: {
    kind: "reflection",
    prompt: "选择两轮真实对话，引用原文并核对新增要求。",
    challenge: {
      id: "activity-notice",
      title: "活动通知 · 虚构练习",
      notice: "周六 10:00 在图书馆一楼集合，请携带学生证。",
      items: [
        { id: "start", label: "开始时间" },
        { id: "place", label: "集合地点" },
        { id: "end", label: "结束时间" },
        { id: "signup", label: "是否需要报名" },
      ],
    },
  },
};
async function fixture(
  page: Page,
  options: {
    empty?: boolean;
    historical?: boolean;
    conflict?: boolean;
    delay?: number;
    saveFailure?: boolean;
    prepared?: boolean;
    restoredStep?: number;
  } = {},
) {
  const attempt: Attempt = {
    id: "review-fixture",
    owner_id: "local-owner",
    lesson_id: lesson.id,
    lesson_version: lesson.version,
    mode: "live",
    revision: 1,
    status: options.historical ? "superseded" : "active",
    settings,
    selected_file_ids: [],
    progress: "in_progress",
    active_run_id: null,
    latest_submission_id: null,
    reset_to_attempt_id: options.historical ? "review-next" : null,
    created_at: "2026-10-24T01:00:00Z",
    updated_at: "2026-10-24T01:01:00Z",
  };
  const makeRun = (
    id: string,
    input: string,
    extra: Partial<Run> = {},
  ): Run => ({
    id,
    attempt_id: attempt.id,
    mode: "live",
    status: "completed",
    last_seq: 2,
    input_text: input,
    snapshot: {
      settings,
      selected_file_ids: [],
      profile_id: null,
      profile_revision: null,
      model: null,
    },
    pending_approval: null,
    usage: { model_calls: 1, input_tokens: 5, output_tokens: 5 },
    error: null,
    created_at: "2026-10-24T01:01:00Z",
    started_at: null,
    ended_at: "2026-10-24T01:01:10Z",
    ...extra,
  });
  const runs = options.empty
    ? []
    : [
        makeRun("review-before", "整理这份通知。"),
        makeRun("review-after", `整理这份通知。${requirement}`),
        makeRun("review-failed", "未完成", { status: "failed" }),
        makeRun("review-demo", "演示", { mode: "demo" }),
        makeRun("review-other", "其他实训", { attempt_id: "other" }),
        makeRun("review-empty", "无回答"),
        makeRun("review-duplicate", "整理这份通知。"),
      ];
  let draft: Schema["ReflectionDraft"] = {
    attempt_id: attempt.id,
    revision: 0,
    draft: null,
    updated_at: null,
  };
  if (options.prepared || options.restoredStep !== undefined) {
    draft = {
      ...draft,
      revision: 1,
      updated_at: "2026-10-26T01:00:00Z",
      draft: {
        step: options.restoredStep ?? 0,
        beforeId: options.prepared ? "review-before" : "",
        afterId: options.prepared ? "review-after" : "",
        beforeMessageId: options.prepared ? "message-review-before" : "",
        afterMessageId: options.prepared ? "message-review-after" : "",
        beforeEventSeq: options.prepared ? 2 : 0,
        afterEventSeq: options.prepared ? 2 : 0,
        beforeStartOffset: 0,
        afterStartOffset: 0,
        beforeQuote: options.prepared ? texts[0] : "",
        afterQuote: options.prepared ? texts[1] : "",
        changeKind: options.prepared ? "constraint" : "",
        requirement: options.prepared ? requirement : "",
        judgment: options.prepared ? "satisfied" : "",
        explanation: options.prepared ? "根据原文核对。" : "",
        nextInstruction: "",
        facts: {},
        instruction: "",
      },
    };
  }
  const writes: Schema["PutReflectionDraftRequest"][] = [];
  const submissions: Submission[] = [];
  let activeWrites = 0,
    maximumWrites = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const uri = new URL(request.url()).pathname;
    if (uri.endsWith("/reflection-draft")) {
      if (request.method() === "PUT") {
        const body =
          request.postDataJSON() as Schema["PutReflectionDraftRequest"];
        writes.push(body);
        activeWrites++;
        maximumWrites = Math.max(maximumWrites, activeWrites);
        if (options.delay)
          await new Promise((resolve) => setTimeout(resolve, options.delay));
        activeWrites--;
        if (
          options.conflict ||
          body.expected_revision !== draft.revision ||
          options.saveFailure
        )
          return route.fulfill({
            status: options.saveFailure ? 503 : 409,
            json: {
              error: {
                code: options.saveFailure
                  ? "MODEL_UNAVAILABLE"
                  : "REVISION_CONFLICT",
                message: "测试保存失败",
                request_id: "review-test",
                fields: [],
                retryable: false,
              },
            },
          });
        draft = {
          attempt_id: attempt.id,
          revision: draft.revision + 1,
          draft: structuredClone(body.draft),
          updated_at: "2026-10-25T01:00:00Z",
        };
      }
      return route.fulfill({ json: draft });
    }
    if (uri === "/api/v1/submissions" && request.method() === "POST") {
      const saved: Submission = {
        id: `review-submission-${submissions.length + 1}`,
        attempt_id: attempt.id,
        lesson_version: lesson.version,
        mode: "live",
        passed: true,
        evaluation_passed: true,
        created_at: "2026-10-25T01:00:00Z",
        rules: [],
        evidence: [],
        answers: structuredClone(request.postDataJSON().answers),
      };
      submissions.unshift(saved);
      return route.fulfill({ status: 201, json: saved });
    }
    if (uri.startsWith("/api/v1/submissions/"))
      return route.fulfill({
        json: submissions.find((submission) => uri.endsWith(submission.id)),
      });
    if (uri.endsWith("/submissions"))
      return route.fulfill({ json: { items: submissions, next_cursor: null } });
    if (uri === `/api/v1/attempts/${attempt.id}`)
      return route.fulfill({
        json: { ...attempt, latest_submission_id: submissions[0]?.id ?? null },
      });
    if (uri === "/api/v1/lessons/01-task")
      return route.fulfill({ json: lesson });
    if (uri.endsWith(`/attempts/${attempt.id}/runs`))
      return route.fulfill({
        json: { items: [...runs].reverse(), next_cursor: null },
      });
    if (uri.endsWith("/event-history")) {
      const id = uri.split("/").at(-2)!;
      const run = runs.find((item) => item.id === id)!;
      const event: Event = {
        schema_version: "0.1.0",
        attempt_id: run.attempt_id,
        run_id: id,
        seq: 2,
        mode: run.mode,
        kind: "message.completed",
        created_at: run.created_at,
        payload: {
          message_id: `message-${id}`,
          role: "assistant",
          content: id === "review-before" ? texts[0] : texts[1],
        },
      };
      return route.fulfill({
        json: {
          items: id === "review-empty" ? [] : [event],
          has_more: false,
          next_after_seq: 2,
        },
      });
    }
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto(`/practice/${attempt.id}`);
  await expect(page.getByTestId("conversation-review")).toBeVisible();
  if (!options.historical)
    await expect(
      page.getByRole("combobox", { name: "第一次尝试", exact: true }),
    ).toBeEnabled();
  return {
    writes,
    submissions,
    draft: () => draft,
    maximumWrites: () => maximumWrites,
  };
}

test("顶部步骤按完成情况解锁，返回修改后重新锁定后续步骤", async ({ page }) => {
  await fixture(page);
  const review = page.getByTestId("conversation-review");
  const nav = review.getByRole("navigation", { name: "复盘步骤" });
  await expect(nav.getByRole("button", { name: /选择两轮/ })).toBeEnabled();
  for (const name of [/标出改动/, /核对回答/, /换个情境/])
    await expect(nav.getByRole("button", { name })).toBeDisabled();
  await review
    .getByRole("combobox", { name: "第一次尝试", exact: true })
    .selectOption("review-before");
  await expect(nav.getByRole("button", { name: /标出改动/ })).toBeDisabled();
  await review
    .getByRole("combobox", { name: "改进后的尝试", exact: true })
    .selectOption("review-after");
  await expect(nav.getByRole("button", { name: /标出改动/ })).toBeEnabled();
  await nav.getByRole("button", { name: /标出改动/ }).click();
  await expect(nav.getByRole("button", { name: /核对回答/ })).toBeDisabled();
  await review
    .getByRole("combobox", { name: "主要改动是什么？", exact: true })
    .selectOption("constraint");
  await review.getByLabel("引用新增或改写的要求").fill("不是原始指令的内容");
  await expect(nav.getByRole("button", { name: /核对回答/ })).toBeDisabled();
  await review.getByLabel("引用新增或改写的要求").fill(requirement);
  await expect(nav.getByRole("button", { name: /核对回答/ })).toBeEnabled();
  await expect(nav.getByRole("button", { name: /换个情境/ })).toBeDisabled();
  await nav.getByRole("button", { name: /选择两轮/ }).click();
  await fillReflection(page, requirement, {
    ids: ["review-before", "review-after"],
    judgment: "partial",
  });
  await nav.getByRole("button", { name: /核对回答/ }).click();
  await review.getByLabel("如果再试一次，你会怎样修改指令？").fill(" ");
  await expect(nav.getByRole("button", { name: /换个情境/ })).toBeDisabled();
  await review
    .getByLabel("如果再试一次，你会怎样修改指令？")
    .fill("继续核对来源。");
  await expect(nav.getByRole("button", { name: /换个情境/ })).toBeEnabled();
  await nav.getByRole("button", { name: /标出改动/ }).click();
  await review.getByLabel("引用新增或改写的要求").fill("");
  await expect(nav.getByRole("button", { name: /核对回答/ })).toBeDisabled();
  await expect(nav.getByRole("button", { name: /换个情境/ })).toBeDisabled();
  await expect(review.getByRole("status")).toContainText("已保存");
  await page.reload();
  await expect(nav.getByRole("button", { name: /换个情境/ })).toBeDisabled();
});

test("恢复停留在后续步骤的未完成草稿时回到最早待完成步骤", async ({ page }) => {
  await fixture(page, { restoredStep: 3 });
  const review = page.getByTestId("conversation-review");
  await expect(
    review.getByRole("combobox", { name: "第一次尝试", exact: true }),
  ).toBeEnabled();
  await expect(review.getByRole("button", { name: /换个情境/ })).toBeDisabled();
  await expect(review.getByLabel("给 Agent 补充一条要求")).toHaveCount(0);
});

test("正式复盘保存精确重复引用，刷新恢复，提交冻结且历史可定位", async ({
  page,
}) => {
  const state = await fixture(page);
  const review = page.getByTestId("conversation-review");
  const before = review.getByRole("combobox", {
    name: "第一次尝试",
    exact: true,
  });
  for (const id of [
    "review-failed",
    "review-demo",
    "review-other",
    "review-empty",
  ])
    await expect(before.locator(`option[value='${id}']`)).toHaveCount(0);
  await fillReflection(page, requirement, {
    ids: ["review-before", "review-after"],
    judgment: "partial",
  });
  await review.getByRole("button", { name: /核对回答/ }).click();
  await review
    .getByRole("textbox", { name: "第一次回答的依据", exact: true })
    .fill("日期未知");
  await review
    .getByRole("combobox", { name: "引用位置（第一次）", exact: true })
    .selectOption("6");
  await review
    .getByRole("textbox", { name: "改进后回答的依据", exact: true })
    .fill("日期已列");
  await review
    .getByRole("combobox", { name: "引用位置（改进后）", exact: true })
    .selectOption("6");
  await expect(review.getByRole("status")).toContainText("复盘草稿已保存");
  await page.reload();
  await expect(
    review.getByRole("combobox", { name: "引用位置（第一次）", exact: true }),
  ).toHaveValue("6");
  await expect(
    review.getByRole("combobox", { name: "第一次引用消息", exact: true }),
  ).toHaveValue("2");
  await review.getByRole("button", { name: /换个情境/ }).click();
  await review.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("本关已通关");
  await page.getByText("查看详细验收记录", { exact: true }).click();
  const history = page.getByTestId("reflection-submitted");
  await expect(history).toContainText("日期未知");
  await expect(history).toContainText("码点 6");
  const snapshot = structuredClone(state.submissions[0].answers);
  expect(snapshot).toMatchObject({
    kind: "reflection",
    evidence: {
      before: {
        message_id: "message-review-before",
        event_seq: 2,
        start_offset: 6,
      },
      after: { start_offset: 6 },
    },
    judgment: "partial",
  });
  const link = history.getByRole("link", { name: "定位这段原文" }).first();
  const target = (await link.getAttribute("href"))!.slice(1);
  await link.click();
  await expect(page.locator(`[id='${target}']`)).toBeFocused();
  await review
    .getByLabel("给 Agent 补充一条要求")
    .fill("修改草稿不会覆盖提交。");
  await expect(review.getByRole("status")).toContainText("复盘草稿已保存");
  await page.getByText("历史提交（1）", { exact: true }).click();
  await page.locator(".history-item").click();
  await page.getByText("查看详细验收记录", { exact: true }).click();
  await expect(page.getByTestId("reflection-submitted")).not.toContainText(
    "修改草稿不会覆盖提交。",
  );
  expect(state.submissions[0].answers).toEqual(snapshot);
});

test("自动保存串行处理慢请求，不丢失最后修改", async ({ page }) => {
  const state = await fixture(page, { delay: 900, prepared: true });
  const review = page.getByTestId("conversation-review");
  await review.getByRole("button", { name: /换个情境/ }).click();
  const input = review.getByLabel("给 Agent 补充一条要求");
  await input.fill("第一次填写");
  await expect.poll(() => state.writes.length).toBe(1);
  await input.fill("最后一次填写");
  await expect
    .poll(() => state.draft().draft?.instruction)
    .toBe("最后一次填写");
  expect(state.maximumWrites()).toBe(1);
  expect(state.writes.map((write) => write.expected_revision)).toEqual([1, 2]);
  await expect(review.getByRole("status")).toContainText("复盘草稿已保存");
  await page.reload();
  await expect(review.getByLabel("给 Agent 补充一条要求")).toHaveValue(
    "最后一次填写",
  );
});

for (const conflict of [true, false])
  test(`保存${conflict ? "冲突" : "失败"}保留本地修改，停止覆盖并提供备份`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      conflict,
      saveFailure: !conflict,
      prepared: true,
    });
    const review = page.getByTestId("conversation-review");
    await review.getByRole("button", { name: /换个情境/ }).click();
    await review.getByLabel("给 Agent 补充一条要求").fill("保留我的修改");
    await expect(review.getByRole("alert")).toContainText("草稿未保存");
    if (conflict)
      await expect(review.getByRole("alert")).toContainText("不会覆盖");
    await review.getByLabel("给 Agent 补充一条要求").fill("继续修改也不覆盖");
    const unexpectedDialogs: string[] = [];
    const downloadDialog = async (dialog: Dialog) => {
      unexpectedDialogs.push(dialog.message());
      await dialog.dismiss();
    };
    page.on("dialog", downloadDialog);
    const downloadPromise = page.waitForEvent("download");
    await review.getByRole("button", { name: "下载当前草稿备份" }).click();
    const saved = await downloadPromise;
    expect(await readFile((await saved.path())!, "utf8")).toContain(
      "继续修改也不覆盖",
    );
    expect(unexpectedDialogs).toEqual([]);
    page.off("dialog", downloadDialog);
    expect(state.writes).toHaveLength(1);
    const dialogPromise = page.waitForEvent("dialog");
    const navigation = page.locator(".back-link").click();
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("尚未保存");
    await dialog.dismiss();
    await navigation;
    await expect(page).toHaveURL(/practice\/review-fixture/);
  });

for (const width of [1440, 390])
  test(`四步正式复盘适应桌面及手机（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    await fillReflection(page, requirement, {
      ids: ["review-before", "review-after"],
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "提交验收", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("本关已通关");
  });

test("空实训不会伪造两轮，历史实训读取草稿但禁止编辑", async ({ page }) => {
  await fixture(page, { empty: true });
  await expect(page.getByTestId("conversation-review")).toContainText(
    "还需要至少两轮完整对话",
  );
  await expect(
    page.getByRole("button", { name: "下一步", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.locator(".validation-summary")).toContainText(
    "先完成至少两轮",
  );
  await page.unrouteAll();
  await fixture(page, { historical: true });
  await expect(
    page.getByRole("combobox", { name: "第一次尝试", exact: true }),
  ).toBeDisabled();
});

test("旧版实训保留单选提交与新版导读入口", async ({ page }) => {
  const created = await page.request.post("/api/v1/attempts", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { lesson_id: "01-task", lesson_version: "1.0.0", mode: "demo" },
  });
  expect(created.status()).toBe(201);
  const attempt = await created.json();
  await page.goto(`/practice/${attempt.id}`);
  await expect(page.getByTestId("conversation-review")).toHaveCount(0);
  await expect(
    page.getByText("这是旧版 1.0.0 实训，沿用原规则，不含正式模型内容验收。", {
      exact: false,
    }),
  ).toBeVisible();
  const link = page.getByRole("link", {
    name: "阅读最新导读并新建包含模型验收的实训 →",
  });
  await expect(link).toHaveAttribute("href", "/lessons/01-task");
  await page
    .getByRole("radio", { name: "说明目标、约束和输出要求，再检查结果。" })
    .check();
  await page.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("演示检查未通过");
  await page.getByRole("button", { name: "留在当前关卡", exact: true }).click();
  await link.click();
  await expect(
    page.getByText("完成两轮先后进行、各有完整回答的对话。", { exact: true }),
  ).toBeVisible();
});

test("自由说明要求填写但不按长度或关键词评判", async ({ page }) => {
  const state = await fixture(page);
  const review = page.getByTestId("conversation-review");
  await fillReflection(page, requirement, {
    ids: ["review-before", "review-after"],
  });
  await review.getByLabel("给 Agent 补充一条要求").fill("   ");
  await review.getByRole("button", { name: "提交验收", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText(
    "给新情境补充一条具体要求",
  );
  expect(state.submissions).toHaveLength(0);
  await review.getByRole("button", { name: /核对回答/ }).click();
  await review.getByLabel("结合引用，说说你的判断").fill("  ");
  await expect(
    review.getByRole("button", { name: "下一步", exact: true }),
  ).toBeEnabled();
  await review.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(review.getByLabel("结合引用，说说你的判断")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(review.getByLabel("结合引用，说说你的判断")).toBeFocused();
  await review.getByLabel("结合引用，说说你的判断").fill("是");
  await expect(
    review.getByRole("button", { name: "下一步", exact: true }),
  ).toBeEnabled();
});

for (const width of [1440, 390]) {
  test(`下一步和提交标记具体缺失项并聚焦，修正自动清除且不误提交（${width}px）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    const review = page.getByTestId("conversation-review");
    const next = review.getByRole("button", { name: "下一步", exact: true });
    const before = review.getByRole("combobox", {
      name: "第一次尝试",
      exact: true,
    });
    const after = review.getByRole("combobox", {
      name: "改进后的尝试",
      exact: true,
    });
    await next.click();
    await expect(before).toHaveAttribute("aria-invalid", "true");
    await expect(before).toBeFocused();
    await expect(before).toBeInViewport();
    await before.selectOption("review-before");
    await expect(before).not.toHaveAttribute("aria-invalid", "true");
    await expect(after).toHaveAttribute("aria-invalid", "true");
    await after.selectOption("review-after");
    await expect(review.locator(".validation-summary")).toHaveCount(0);
    await next.click();
    await next.click();
    const category = review.getByRole("combobox", {
      name: "主要改动是什么？",
      exact: true,
    });
    await expect(category).toBeFocused();
    await category.selectOption("constraint");
    const change = review.getByLabel("引用新增或改写的要求");
    await change.fill("不是原文");
    await expect(change).toHaveAttribute("aria-invalid", "true");
    await next.click();
    await expect(change).toBeFocused();
    await change.fill(requirement);
    await expect(change).not.toHaveAttribute("aria-invalid", "true");
    await next.click();
    await next.click();
    const beforeMessage = review.getByRole("combobox", {
      name: "第一次引用消息",
      exact: true,
    });
    await expect(beforeMessage).toBeFocused();
    await beforeMessage.selectOption({ index: 1 });
    await review
      .getByLabel("第一次回答的依据", { exact: true })
      .fill("日期未知");
    await review
      .getByRole("combobox", { name: "改进后引用消息", exact: true })
      .selectOption({ index: 1 });
    await review
      .getByLabel("改进后回答的依据", { exact: true })
      .fill("日期已列");
    await review.getByRole("radio", { name: "部分满足", exact: true }).check();
    await review
      .getByLabel("结合引用，说说你的判断")
      .fill("还应确认未说明的信息。");
    await next.click();
    const correction = review.getByLabel("如果再试一次，你会怎样修改指令？");
    await expect(correction).toHaveAttribute("aria-invalid", "true");
    await expect(correction).toBeFocused();
    await correction.fill("请列出需要我确认的信息。");
    await next.click();
    const submit = review.getByRole("button", {
      name: "提交验收",
      exact: true,
    });
    await submit.click();
    const start = review.getByRole("combobox", {
      name: "开始时间",
      exact: true,
    });
    await expect(start).toBeFocused();
    await expect(start).toHaveAttribute("aria-invalid", "true");
    await expect(review.locator(".validation-summary")).toContainText(
      "还需补充 5 项",
    );
    await review.screenshot({
      path: testInfo.outputPath(`missing-fields-${width}.png`),
    });
    for (const name of ["开始时间", "集合地点", "结束时间", "是否需要报名"])
      await review
        .getByRole("combobox", { name, exact: true })
        .selectOption(
          name === "开始时间" || name === "集合地点" ? "known" : "confirm",
        );
    await submit.click();
    const instruction = review.getByLabel("给 Agent 补充一条要求");
    await expect(instruction).toBeFocused();
    await expect(instruction).toBeInViewport();
    expect(state.submissions).toHaveLength(0);
    await instruction.fill("请先确认通知没有说明的信息。");
    await expect(review.locator(".validation-summary")).toHaveCount(0);
    await submit.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(state.submissions).toHaveLength(1);
  });
}

test("SPA 后退和前进后恢复未保存填写，恢复时不静默覆盖服务端", async ({
  page,
}) => {
  const state = await fixture(page, { saveFailure: true, prepared: true });
  await page.locator(".back-link").click();
  await expect(page).toHaveURL("/");
  await page.goBack();
  const review = page.getByTestId("conversation-review");
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: /换个情境/ }).click();
  await review
    .getByLabel("给 Agent 补充一条要求")
    .fill("前进后退也保留这段填写");
  await expect(review.getByRole("alert")).toContainText("草稿未保存");
  const writeCount = state.writes.length;
  await page.goForward();
  await expect(page).toHaveURL("/");
  await page.goBack();
  await expect(review.getByLabel("给 Agent 补充一条要求")).toHaveValue(
    "前进后退也保留这段填写",
  );
  await expect(review.getByRole("alert")).toContainText("自动保存已暂停");
  await page.waitForTimeout(700);
  expect(state.writes).toHaveLength(writeCount);
});
