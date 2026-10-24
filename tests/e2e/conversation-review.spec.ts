import { test, expect, type Page } from "../../apps/web/tests/browser";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Attempt, Event, Lesson, Run } from "../../apps/web/src/lib/types";

const output = path.resolve(process.cwd(), "../../work/conversation-review");
const settings = {
  system_instruction: "根据通知整理，不猜测缺失信息。",
  temperature: 0.3,
};
const texts = [
  "提交课程总结，日期未列出。",
  "提交课程总结：2026-11-04。实验室预约规则未说明，需要向你确认。",
];
const requirement = "未说明的信息先向我确认。";
const lesson: Lesson = {
  id: "01-task",
  version: "1.0.0",
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
    kind: "choice",
    question_id: "goal-constraints",
    prompt: "怎样的任务说明更容易核查结果？",
    options: [
      { id: "clear-goal", label: "说明目标、约束和输出要求，再检查结果。" },
      { id: "no-check", label: "只说帮我处理，并直接相信结果。" },
    ],
  },
};

async function fixture(
  page: Page,
  options: { empty?: boolean; historical?: boolean } = {},
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
    minute: number,
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
    created_at: `2026-10-24T01:0${minute}:00Z`,
    started_at: null,
    ended_at: `2026-10-24T01:0${minute}:10Z`,
    ...extra,
  });
  const runs = options.empty
    ? []
    : [
        makeRun("review-before", "整理这份通知。", 1),
        makeRun(
          "review-after",
          `整理这份通知。请列出截止日期，${requirement}`,
          2,
        ),
        makeRun("review-failed", "未完成的尝试", 3, { status: "failed" }),
        makeRun("review-demo", "其他模式的尝试", 4, { mode: "demo" }),
        makeRun("review-other", "其他实训的尝试", 5, {
          attempt_id: "other-attempt",
        }),
        makeRun("review-empty", "没有完整回答的尝试", 6),
        makeRun("review-duplicate", "整理这份通知。", 7),
      ];
  let writes = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const uri = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes++;
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "MODEL_UNAVAILABLE",
            message: "测试提交已截获，未发送到后端。",
            request_id: "review-fixture",
            retryable: false,
            fields: [],
          },
        },
      });
    }
    if (uri === `/api/v1/attempts/${attempt.id}`)
      return route.fulfill({ json: attempt });
    if (uri === "/api/v1/lessons/01-task")
      return route.fulfill({ json: lesson });
    if (uri.endsWith(`/attempts/${attempt.id}/runs`))
      return route.fulfill({
        json: { items: [...runs].reverse(), next_cursor: null },
      });
    if (uri.endsWith("/event-history")) {
      const id = uri.split("/").at(-2)!;
      const run = runs.find((r) => r.id === id)!;
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
  return { writes: () => writes };
}

async function selectPair(page: Page) {
  const review = page.getByTestId("conversation-review");
  await review
    .getByRole("combobox", { name: "第一次尝试", exact: true })
    .selectOption("review-before");
  await review
    .getByRole("combobox", { name: "改进后的尝试", exact: true })
    .selectOption("review-after");
  await review.getByRole("button", { name: "下一步", exact: true }).click();
  return review;
}
async function fillChange(page: Page) {
  const review = page.getByTestId("conversation-review");
  await review
    .getByRole("combobox", { name: "主要改动是什么？", exact: true })
    .selectOption("补充限制");
  await review.getByLabel("引用新增或改写的要求").fill(requirement);
  await review.getByRole("button", { name: "下一步", exact: true }).click();
}
async function fillEvidence(page: Page) {
  const review = page.getByTestId("conversation-review");
  await review
    .getByRole("textbox", { name: "第一次回答的依据", exact: true })
    .fill(texts[0]);
  await review
    .getByRole("textbox", { name: "改进后回答的依据", exact: true })
    .fill(texts[1]);
  await review.getByRole("radio", { name: "部分满足", exact: true }).check();
  await review
    .getByLabel("结合引用，说说你的判断")
    .fill("第二次列出了日期，也指出预约规则未知；还需要进一步明确来源。");
  await review
    .getByLabel("如果再试一次，你会怎样修改指令？")
    .fill("请为每个日期注明来源。");
  await review.getByRole("button", { name: "下一步", exact: true }).click();
}
async function fillVariation(page: Page) {
  const review = page.getByTestId("conversation-review");
  for (const name of ["开始时间", "集合地点"])
    await review
      .getByRole("combobox", { name, exact: true })
      .selectOption("known");
  for (const name of ["结束时间", "是否需要报名"])
    await review
      .getByRole("combobox", { name, exact: true })
      .selectOption("confirm");
  await review
    .getByLabel("给 Agent 补充一条要求")
    .fill("只整理已知事项；结束时间和报名规则请先向我确认，不要推测。");
}

test("复盘验收替换旧单选，关联真实引用且不生成正式提交", async ({ page }) => {
  const network = await fixture(page);
  const review = page.getByTestId("conversation-review");
  await expect(
    review.getByRole("button", { name: "下一步", exact: true }),
  ).toBeDisabled();
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
    await expect(before.locator(`option[value="${id}"]`)).toHaveCount(0);
  await before.selectOption("review-before");
  await expect(
    review
      .getByRole("combobox", { name: "改进后的尝试", exact: true })
      .locator('option[value="review-duplicate"]'),
  ).toHaveAttribute("disabled", "");
  await selectPair(page);
  await review
    .getByRole("combobox", { name: "主要改动是什么？", exact: true })
    .selectOption("补充限制");
  await review
    .getByLabel("引用新增或改写的要求")
    .fill("这句话没有出现在实际指令中。");
  await expect(review.getByRole("alert")).toBeVisible();
  await expect(
    review.getByRole("button", { name: "下一步", exact: true }),
  ).toBeDisabled();
  await review.getByLabel("引用新增或改写的要求").fill("整理这份通知。");
  await expect(
    review.getByRole("button", { name: "下一步", exact: true }),
  ).toBeDisabled();
  await fillChange(page);
  await review
    .getByRole("textbox", { name: "第一次回答的依据", exact: true })
    .fill(texts[0]);
  await review
    .getByRole("textbox", { name: "改进后回答的依据", exact: true })
    .fill("模型没有说过的结论。");
  await expect(review.getByRole("alert")).toContainText(
    "未在这轮完整回答中找到引用",
  );
  await review
    .getByRole("textbox", { name: "改进后回答的依据", exact: true })
    .fill(texts[1]);
  await review.getByRole("radio", { name: "部分满足", exact: true }).check();
  await review
    .getByLabel("结合引用，说说你的判断")
    .fill("已经标出了未知信息，但还需要来源。");
  await expect(
    review.getByRole("button", { name: "下一步", exact: true }),
  ).toBeDisabled();
  await fillEvidence(page);
  await fillVariation(page);
  await review
    .getByRole("combobox", { name: "结束时间", exact: true })
    .selectOption("known");
  await review.getByRole("button", { name: "核对并完成复盘" }).click();
  await expect(review.getByRole("alert")).toContainText("结束时间");
  await expect(
    review.getByRole("button", { name: "下载复盘记录" }),
  ).toHaveCount(0);
  await review
    .getByRole("combobox", { name: "结束时间", exact: true })
    .selectOption("confirm");
  await review.getByRole("button", { name: "核对并完成复盘" }).click();
  await expect(review.getByRole("status")).toContainText("不代表正式通过");
  await expect(page.locator(".completion-pill")).toHaveText("未通关");
  expect(network.writes()).toBe(0);
  const downloadPromise = page.waitForEvent("download");
  await review.getByRole("button", { name: "下载复盘记录" }).click();
  const download = await downloadPromise;
  const content = await readFile((await download.path())!, "utf8");
  expect(content).toContain("review-before / 事件 #2");
  expect(content).toContain("review-after / 事件 #2");
  expect(content).toContain("部分满足");
  expect(content).toContain("本地预览，不计正式成绩");
  expect(content).not.toContain("api_key");
  expect(network.writes()).toBe(0);
  await review.getByLabel("给 Agent 补充一条要求").fill("再修改一次要求。");
  await expect(
    review.getByRole("button", { name: "下载复盘记录" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("radio", {
      name: "说明目标、约束和输出要求，再检查结果。",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "提交验收", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "现行课程验收", exact: true }),
  ).toHaveCount(0);
  expect(network.writes()).toBe(0);
  await page.reload();
  await expect(
    review.getByRole("combobox", { name: "第一次尝试", exact: true }),
  ).toHaveValue("");
});

for (const width of [1440, 390]) {
  test(`复盘四步与原文标亮，桌面及手机布局（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    const review = await selectPair(page);
    await review
      .getByRole("combobox", { name: "主要改动是什么？", exact: true })
      .selectOption("补充限制");
    await review.getByLabel("引用新增或改写的要求").fill(requirement);
    await expect(review.locator("mark")).toHaveText(requirement);
    await mkdir(output, { recursive: true });
    await review.screenshot({ path: path.join(output, `change-${width}.png`) });
    await fillChange(page);
    await review
      .getByRole("textbox", { name: "第一次回答的依据", exact: true })
      .fill(texts[0]);
    await review
      .getByRole("textbox", { name: "改进后回答的依据", exact: true })
      .fill(texts[1]);
    await review.screenshot({
      path: path.join(output, `evidence-${width}.png`),
    });
    await fillEvidence(page);
    await fillVariation(page);
    await review.getByRole("button", { name: "核对并完成复盘" }).click();
    await expect(review.getByRole("status")).toContainText("复盘已整理");
    await review.screenshot({
      path: path.join(output, `summary-${width}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("空实训不伪造对话，历史实训不编辑复盘", async ({ page }) => {
  await fixture(page, { empty: true });
  const review = page.getByTestId("conversation-review");
  await expect(review).toContainText("还需要至少两轮完整对话");
  await expect(
    review.getByRole("button", { name: "下一步", exact: true }),
  ).toBeDisabled();
  await page.unrouteAll();
  await fixture(page, { historical: true });
  await expect(
    review.getByRole("combobox", { name: "第一次尝试", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "提交验收", exact: true }),
  ).toHaveCount(0);
});
