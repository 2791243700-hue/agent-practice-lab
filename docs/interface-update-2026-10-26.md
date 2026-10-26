# 接口一致性更新

日期：2026-10-26。基于已合并 main af36497；本页描述该基线之后的接口与文档增量，随本次修复提交交付。

## 修复内容

OpenAPI 的 AnswerForm、ToolCall、Evidence、StoredEvent 只有 propertyName，缺少 discriminator.mapping。openapi-typescript 7.10.1 因此按引用的 schema 名推断判别值，例如生成 ChoiceForm.kind="ChoiceForm"，实际 JSON 却是 "choice"。前端此前使用手写边界类型修正部分值，其他契约消费者仍会拿到错误类型。

本次在 OpenAPI 源定义补齐四组映射，覆盖 5 种表单、4 种工具调用、4 种证据及 11 类事件；同步独立事件/课程 schema 并重新生成 types.d.ts。前端 types.ts 直接引用共享类型，删除 Tagged/Omit 适配。未修改任何实际 kind/name 值、请求字段、路径或状态码；仍为 v0.1.0，41 个操作、102 个 schema。

文档同步草稿双 revision、正式答案与证据的区别、Unicode 码点引用、Tips 缓存与错误、导出和版本兼容；OpenAPI 修正把 409/422 写成“成功”的说明。HTTP 示例的 challenge_id 对齐第一关 1.1.0 的 activity-notice。

## 验证方法

新增生成类型回归直接解析实际 types.d.ts，逐项比对全部 24 种判别值。修复前复现 ChoiceForm/choice 不一致，补齐映射并重新生成后通过。契约校验同时检查映射是否完整、是否重名及独立事件映射是否一致，防止新增成员后再次漂移。

本次验证结果：193 项后端、19 项前端单元及 231 项契约结构检查通过，严格 TypeScript 与前端格式检查通过；30 份文档、217 个本地链接及 41 个操作清单核对通过。与 main 基线逐项比较，三个契约文件除说明和 discriminator 元数据外，请求/响应结构及校验约束完全一致。

复现命令：在 contracts 执行 npm run types、npm run validate；在 apps/web 执行 npm test、npm run typecheck、npm run format:check；后端使用 uv run --project apps/api pytest apps/api/tests -q。验证采用本地测试服务，不使用真实模型 Key。原 main 的 52 项浏览器记录属于上一轮合并验证，本次不把旧结果算作新测试。
