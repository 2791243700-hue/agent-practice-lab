# Unified Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一实训交互并完成第一关复盘的持久化和正式结构化验收。
**Architecture:** 共享版本化课程与 Submission，独立草稿资源，Tips 保持按运行缓存；前端按照 answer_form.kind 和版本显示表单。
**Tech Stack:** Next.js / TypeScript / FastAPI / SQLite / JSON Schema。
**Spec:** ../specs/2026-10-25-unified-practice-design.md

## Global Constraints
- 保留旧课程 1.0.0，发布 1.1.0，不重算旧成绩。
- 凭据仅内存；不使用真实 Key，不重启用户服务。
- 正式评分只检查约定的客观结构与变式，自由解释反馈不作硬性通关依据。
- 所有写请求来源/归属/revision 校验沿用，草稿不额外调用模型。

## Review Focus
- 中文/emoji/重复段落引用必须定位到实际消息和码点位置。
- 相同时钟和倒序 ID 不能改变运行先后。
- 自动保存的多标签冲突不能静默覆盖；失败离开须提示。
- 旧课程实验继续入口和新版入口明确，不隐式升级。
- 同时保留 Tips、重置模型选择、复盘以及第二至四关正式验收。

### Task 1: 契约与冲突协调
Files: contracts/openapi.json, lesson.schema.json, events.schema.json, types.d.ts；冲突文档、practice 页面。
Interfaces: ReflectionAnswers/ReflectionForm/ReflectionDraftData/ReflectionDraft/Get/PutReflectionDraftRequest；草稿 GET/PUT path 与 design 一致。
- [x] 通过当前 schema 校验新答案失败的样例确认缺口；扩展统一契约、样例和独立事件副本，生成类型。
- [x] 合并 main 并逐处协调重叠页面，保留两方交互；验证没有冲突标记。

### Task 2: 后端复盘与课程
Files: reflection.py, grading.py, lessons.py, service.py, exports.py, content/lessons/01-task-v1.1/, tests/test_reflection.py。
Interfaces: ReflectionService.get_draft/put_draft；Grader reflection_* 分支；固定 design 答案与表单。
- [x] 添加失败测试：新版/旧版、草稿持久化/冲突/归属、引用和先后、正式与演示、导出冻结。
- [x] 观察失败后实现服务、私有课程规则及新版材料；再次运行测试通过。

### Task 3: 前端正式复盘
Files: conversation-review.tsx, feedback.tsx, practice/[id]/page.tsx, lessons/[id]/page.tsx, lib/types.ts, e2e/conversation-review.spec.ts, learning.spec.ts。
Interfaces: 新版 ReflectionForm 与草稿 API；现有 onSubmit(Answers)/onView 回调，提交弹窗由父页面管理。
- [x] 先补浏览器失败测试：新版保存刷新、完整提交、旧版继续、草稿冲突、手机布局。
- [x] 接入服务端题目、精确消息引用、自动保存/冲突提示、提交回看/下载；保留旧版 choice；修复第四关 CI 链接等待竞态。
- [x] 类型、单元和浏览器专项通过。

### Task 4: 整体验证与交付
Files: docs/当前状态/接口/用户指南/交接/验证，以及本计划。
- [x] 后端全量、契约及生成类型、前端单元、格式、类型、隔离生产构建与全浏览器回归。
- [x] 新鲜独立审查，修正实证问题，同步文档实际数字及功能边界。
- [ ] 提交并推送现有 PR #9 分支，核对对应云端 CI，报告结果；main 不自动合并。
