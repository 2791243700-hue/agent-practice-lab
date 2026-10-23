import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/ui";

test("model comparison Markdown renders a scrollable table with intact cell content", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "两次结果比较：\n\n| 项目 | 第一次（简单要求） | 第二次（补充目标与限制） |\n| --- | --- | --- |\n| 输出内容 | 两项任务及截止日期 | 目标、边界和批准要求 |\n| 信息完整性 | 较简略 | **更完整**，保留 `source_id` |",
    }),
  );
  assert.match(html, /class="table-scroll"/);
  assert.match(html, /<table>/);
  assert.equal((html.match(/<th(?:\s[^>]*)?>/g) ?? []).length, 3);
  assert.equal((html.match(/<td(?:\s[^>]*)?>/g) ?? []).length, 6);
  assert.match(html, /<strong>更完整<\/strong>/);
  assert.match(html, /<code>source_id<\/code>/);
});

test("Markdown preserves code examples and keeps active HTML and unsafe links inert", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: "```text\n| 项目 | 第一次 |\n| --- | --- |\n```\n\n<script>alert(1)</script>\n\n[链接](javascript:alert%281%29)\n\n![外部图片](https://example.invalid/pixel)",
    }),
  );
  assert.doesNotMatch(html, /<table>|<script>|<img|href="javascript:/);
  assert.match(html, /<pre><code/);
  assert.match(html, /\| 项目 \| 第一次 \|/);
});
