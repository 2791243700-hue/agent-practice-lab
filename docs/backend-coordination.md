# 前后端接入协调记录

2026-10-18。前端基于后端 `d908e01`，契约 v0.1.0；课程、接口和评分规则保持不变。

## 已修复：普通流式回答的完整正文为空

状态：用户于 2026-10-18 明确同意最小修复并补测；已应用，保留独立提交 `fix(api): preserve complete streamed assistant replies`。未变更接口、事件结构或评分。

浏览器截图检查发现正式第一关运行完成后，助手气泡为空。服务端持久化事件实际包含非空 `message.delta`，随后 `message.completed.payload.content` 却是空字符串。前端按契约用完整正文替换增量，因此不能擅自保留旧增量假装完整回答。

定位到 `AgentScopeRuntime.stream`：AgentScope 2.0.10 的普通 `TextBlockEndEvent.text` 默认 `None`，代表最终正文使用先前增量的拼接；SDK 只有需要替换正文的特殊场景才填写该字段。现有转换 `event.text or ""` 将普通完整正文清空，也使后续对话历史丢失助手内容。

修复按 block_id 累积 TextBlockDeltaEvent；结束时 `text is None` 则使用累计值，否则尊重明确的 text（包括显式空文本），脱敏后发布现有 `message.completed`。取消、失败时不生成伪造的完整回答。现有 SDK + HTTP 提供商测试已补正文断言，41 项后端回归、Ruff 与 7 项浏览器流程全部通过，密钥遮盖测试未退化。

复现：使用 `apps/web/tests/serve.mjs` 的本地脚本模型，配置其测试凭据，第一关运行完成后查看事件历史；非空增量后出现空完整正文。测试提供商使用占位测试凭据，不是外部真实模型。

## 生成的 TypeScript discriminator 与线上值不符

状态：前端已隔离适配，等待契约维护者后续修正生成方式。

`contracts/types.d.ts` 中部分联合类型的 discriminator 被生成器改成 schema 名称，例如 `ChoiceForm.kind = "ChoiceForm"`、`RunStartedEvent.kind = "RunStartedEvent"`，而 JSON 契约和后端实际发送 `choice`、`run.started`。工具调用的 name 也有类似问题。

前端 `src/lib/types.ts` 复用原始 payload，只在接入边界替换这些字面量，未改 contracts 文件。测试直接核对 JSON 契约常量。建议后端维护者调整 OpenAPI discriminator mapping 或生成器选项后重新导出类型，再删除前端适配。

## 启动器就绪提示

原后端 PR 已记录启动器只等待 API 健康、没有等待前端 HTTP 就绪。本次不修改启动脚本；使用说明让学生等待页面加载，Windows 前端冒烟测试单独轮询前端代理就绪后再验证四关。若首开短暂无法访问，稍等后刷新。
