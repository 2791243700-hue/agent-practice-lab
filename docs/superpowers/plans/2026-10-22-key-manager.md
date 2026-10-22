# Key manager implementation plan

**Status (2026-10-22):** Implemented and verified locally; delivery branch: `feat/key-manager-review-fixes`, merged into main via PR #6; follow-up workspace changes merged via PR #7. See [current project status](../../project-status.md) for the merged baseline and remaining limitations.

**Goal:** Let beginners paste a Key, choose a discovered model, and add, switch, rename or delete multiple in-memory Keys.

**Architecture:** Reuse model profiles and the current memory-only credential store. Add one connection-import operation and one per-profile model-list operation; list models before committing a new profile. Preserve connection checks and the application approval boundary.

**Tech Stack:** Existing FastAPI, httpx, JSON/OpenAPI contracts, Next.js and React.

**Spec:** User request and confirmed scope in this chat: DeepSeek, OpenAI and compatible services; credentials remain memory-only.

## Decisions

- Provider hints are suggestions. Ambiguous formats require provider selection before a request. A Key is sent only to the selected destination, without probing other providers or following redirects.
- Official provider addresses are filled automatically. Compatible services retain an address field and an explicit manual-model fallback when discovery is unavailable.
- Model lists come from GET /models. Discovery does not imply text/tool compatibility and does not run paid inference automatically.
- Existing profiles remain usable after upgrade. Names and model preferences persist; Keys never do. Deleting one profile clears its credential without affecting other profiles or historical learning records.
- Renaming preserves a valid connection check; changing the model invalidates it. Active profiles cannot be modified or deleted while in use.

## Tasks

- [x] Add contract definitions, provider-scoped discovery, connection import, and backend tests for privacy, idempotency, failures, busy state and independent deletion.
- [x] Replace the settings flow with Key-first addition, provider hints, a model picker, and Key management; retain advanced compatible-provider configuration and explicit connection-check consent.
- [x] Update browser provider fixtures and regression flows; cover adding multiple Keys, switching models, rename/delete/clear, missing credentials after restart, and desktop/mobile layouts.
- [x] Run contract generation/validation, backend tests and Ruff, frontend checks/build, and browser regressions in an isolated test checkout. Preserve the user's unrelated UI edits.

## Verification of the initial Key manager implementation

197 contract checks, 58 backend tests, 8 frontend tests and 14 browser tests pass. Ruff, formatting, TypeScript and production build pass. Local application restarted after confirming there was no active training run. External providers were documented but not called using private credentials in this change; automated tests use MockTransport and a local scripted provider.

Browser verification used the locally installed Chrome and an isolated production build. Earlier DeepSeek backend validation on 2026-10-19 is documented [separately](../../live-model-validation.md); it does not verify this new import/catalog UI. The fourth lesson still requires better public task ID guidance, and real-provider browser/novice acceptance remains outstanding.

## Review focus

- Provider errors or model metadata must never echo credentials to responses, logs, storage or exports.
- Failed imports must not leave configured profiles or memory credentials; retries must not duplicate successful imports.
- A model change must not reuse an older compatibility result. Rename-only changes must not require extra inference calls.
- Restarts leave clearly marked configuration cards requiring credential re-entry. Demo completion and existing learning history remain unaffected.
- No private credentials are needed for automated tests; use local scripted services and MockTransport.

## Follow-up review fixes

The initial 58/8/14 results above are historical. The subsequent review fixes pass 91 backend tests, 8 frontend tests and 15 browser tests, with 197 contract checks. See the [review closure](../../code-review-2026-10-22.md) for the added scenarios and current local status.
