# Model Tips Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development, task by task.

**Goal:** Keep task replies concise; lazily generate and persist model coaching behind a collapsed Tips control.

**Architecture:** Separate single-call, tool-free coaching from execution. Existing run events and versioned public lesson goals provide evidence. GET /runs/{run_id}/tips reads an optional saved result; POST with profile_id and expected_profile_revision generates once with the selected checked profile. Cache is per immutable terminal run, shared across retries and page reloads; formal grading is unchanged.

**Tech Stack:** Existing FastAPI, httpx, SQLite JSON records, Next.js, React.

**Spec:** User-approved chat design of 2026-10-23: result-only main reply; collapsed Tips shows gaps and next steps; explicit model request on click, persisted reuse; historical raw replies remain available.

## Global constraints

- No API Key persistence or logging; sanitize provider failures and generated content.
- No extra model call on page load, collapse/reopen, or replay; no automatic retry.
- No hidden evaluation while a run is active; global execution slot and busy profile protect concurrent work.
- Tips are model advice, never formal pass/fail; goals and actual tool outcomes, not model claims, supply context.
- Keep archived lesson content and existing events intact; old replies remain readable.

## Review focus

- Concurrent clicks with different idempotency keys must still trigger only one request.
- Restart must preserve saved Tips even when Key is gone; failed requests must release slots.
- Wrong-owner/run, active run, deleted profile, revision changes and missing Key fail safely.
- Invalid model JSON, timeout, oversized response, secret echo and injected instructions cannot corrupt grades or disclose credentials.
- Streamed replies and original history must remain complete; collapse must work on phone and desktop.

### Task 1: Contract and backend
- [x] Add GET/POST operations, schemas, examples and generated types; validate.
- [x] Add failing tests for generation/cache, failures, concurrency and evidence scope.
- [x] Implement bounded evidence, one-call JSON coaching and durable result cache; apply concise reply instruction to new execution only.
- [x] Run backend regressions and contract checks.

### Task 2: Frontend
- [x] Build collapsed Tips panel, explicit cost notice and generation action, cache read on expansion, safe errors/retry.
- [x] Use selected profile and revision; disable new generation during active work; preserve original reply and tool history.
- [x] Add browser coverage: no eager POST, lazy request, reopen/reload reuse, error retry, mobile.

### Task 3: Verification and docs
- [x] Run formatting, types, unit tests, isolated production build and browser tests.
- [x] Independent review; fix verified findings, document current local status and limitations.

Initial implementation did not publish. The user later explicitly requested documentation updates and GitHub upload; deliver through feat/practice-tips-and-feedback without merging main.

## Verification results

134 backend tests; 12 frontend tests; 34 browser tests; 204 contract checks passed. Ruff, formatting, TypeScript and isolated production build passed. Reviewer-reported malformed nested provider envelopes were corrected and covered. Local instance restarted while idle; HTTP homepage and Tips GET returned 200. Memory keys need re-entry after restart. No real provider/key calls, initially no GitHub submission; later delivery uses feat/practice-tips-and-feedback. Main answer brevity is prompt-driven; saved historical text remains intact.
