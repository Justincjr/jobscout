# Project Structure

Job Scout is a local, single-user job-search workspace: a React client served by one Node/Express server that owns a local JSON file, uploaded documents, and background tasks. See [README.md](README.md) for usage and [plan.md](plan.md) / [IMPLEMENTATION.md](IMPLEMENTATION.md) for design intent and verification status.

```
src/
├── client/          React UI (Vite build)
├── server/          Express app wiring and process entrypoint
├── modules/          Domain logic, grouped by feature
│   ├── sources/      Job board integrations (Greenhouse/Lever/Ashby/Workday/Shopee/website)
│   ├── matching/      Local keyword/constraint matching + AI ranking staging
│   ├── drafts/        Resume/cover-letter draft generation and PDF export
│   ├── profile/      Career profile facts and uploaded documents
│   └── applications/ Browser-driven application submission
├── providers/        OpenAI/Anthropic provider abstraction
├── storage/           JSON repository, atomic writes, backups
├── shared/            Zod schema (single source of truth for State) + errors
└── tasks/             Background task queue/engine (refresh, rank, extract, etc.)
```

## Client — `src/client/`

- [main.tsx](src/client/main.tsx) — app shell, routing between screens, bootstrap loading.
- [api.ts](src/client/api.ts) — typed `request()` helper and shared row types (`JobRow`, `Bootstrap`) built from `shared/schema`.
- [ui.tsx](src/client/ui.tsx) — shared UI primitives (icons, generic widgets).
- [styles.css](src/client/styles.css) — global styles.
- [screens/](src/client/screens/) — one component per top-level view:
  - [Feed.tsx](src/client/screens/Feed.tsx) — job discovery/search/filter feed.
  - [Companies.tsx](src/client/screens/Companies.tsx) — followed sources, refresh status.
  - [Profile.tsx](src/client/screens/Profile.tsx) — career profile facts, resume upload/extraction.
  - [RankingView.tsx](src/client/screens/RankingView.tsx) — AI alignment scores and evidence.
  - [ApplicationReview.tsx](src/client/screens/ApplicationReview.tsx) (+ `.css`) — draft review, submission prep/approval.
  - [Workspace.tsx](src/client/screens/Workspace.tsx) — per-job application workspace.
  - [Settings.tsx](src/client/screens/Settings.tsx) — provider/model config, backup/restore/delete.

## Server — `src/server/`

- [index.ts](src/server/index.ts) — process entrypoint: loads `.env.local`, resolves data dir, starts Express.
- [app.ts](src/server/app.ts) — builds the Express app: routes, auth token middleware, request validation (zod), error handling.

## Domain modules — `src/modules/`

- **sources/** — job board connectors.
  - [index.ts](src/modules/sources/index.ts) — shared refresh orchestration, `IncomingJob`/`BoardJobs` normalization, `common()` helpers, Greenhouse/Lever requests.
  - [ashby.ts](src/modules/sources/ashby.ts), [workday.ts](src/modules/sources/workday.ts), [shopee.ts](src/modules/sources/shopee.ts), [website.ts](src/modules/sources/website.ts) — per-provider fetch/parse logic.
  - [network.ts](src/modules/sources/network.ts) — hardened HTTP client: public-DNS pinning, private-address blocking, size/time limits (`JsonRead`, `publicUrl`, `privateAddress`).
- **matching/**
  - [index.ts](src/modules/matching/index.ts) — local keyword/constraint matching against confirmed profile facts.
  - [ranking.ts](src/modules/matching/ranking.ts) — stages jobs for AI ranking (`RANK_PROMPT_VERSION`, staleness tracking).
- **drafts/** — [index.ts](src/modules/drafts/index.ts): resume/cover-letter draft assembly from confirmed facts, PDF export via `pdf-lib`.
- **profile/**
  - [index.ts](src/modules/profile/index.ts) — profile fact state transitions (`bumpProfile`).
  - [documents.ts](src/modules/profile/documents.ts) — resume upload handling, PDF text extraction via a worker thread.
  - [pdf-worker.mjs](src/modules/profile/pdf-worker.mjs) — `pdfjs-dist`-based worker invoked by `documents.ts`.
- **applications/** — approved submission pipeline.
  - [service.ts](src/modules/applications/service.ts) — application form state, saved answers, submission records.
  - [browser.ts](src/modules/applications/browser.ts) — Playwright/Edge automation to read and fill employer forms.
  - [proxy.ts](src/modules/applications/proxy.ts) — HTTPS proxy used by the automated browser session, enforcing the same DNS pinning/private-address blocking as `sources/network.ts`.

## Cross-cutting — `src/providers/`, `src/storage/`, `src/shared/`, `src/tasks/`

- [providers/index.ts](src/providers/index.ts) — thin wrapper over the OpenAI and Anthropic SDKs for structured-output calls (extraction, ranking, draft generation); `PROMPT_VERSION` constants live near their callers.
- [storage/repository.ts](src/storage/repository.ts) — `Repository`: loads/validates/persists `State`, serializes writes, atomic temp-file replace, process lock.
- [storage/backup.ts](src/storage/backup.ts) — ZIP backup/restore (`zipSync`/`unzipSync` via `fflate`), `parseState`.
- [shared/schema.ts](src/shared/schema.ts) — zod schemas for the entire persisted `State` (jobs, facts, drafts, tasks, sources, etc.) and derived types; the single source of truth for data shape.
- [shared/errors.ts](src/shared/errors.ts) — `AppError` and `assert()` used throughout the server/modules.
- [tasks/engine.ts](src/tasks/engine.ts) — background task queue: scheduling, retry, daily AI budget enforcement, task history.

## Scripts — `scripts/`

- [live-smoke.ts](scripts/live-smoke.ts) — opt-in smoke test against configured live AI providers (`npm run test:live`).
- [source-smoke.ts](scripts/source-smoke.ts) — opt-in live check of Shopee/Workday sources (`npm run test:sources:live`).
- [benchmark.ts](scripts/benchmark.ts) — generates/removes a synthetic 10,000-job dataset for performance testing (`npm run benchmark`).
- [recover.ts](scripts/recover.ts) — lists/recovers JSON backups after malformed state (`npm run recover`).
- [application-dom.ts](scripts/application-dom.ts), [application-inspect.ts](scripts/application-inspect.ts) — manual inspection helpers for application-form DOM structure.

## Tests — `tests/`

Vitest unit/integration tests mirror the module layout (`matching.test.ts`, `ranking.test.ts`, `drafts.test.ts`, `sources.test.ts`, `ashby.test.ts`, `new-sources.test.ts`, `network.test.ts`, `storage.test.ts`, `providers.test.ts`, `tasks.test.ts`, `api.test.ts`, `application-proxy.test.ts`, `submissions.test.ts`, `evaluation.test.ts`), plus [helpers.ts](tests/helpers.ts) and [setup.ts](tests/setup.ts) for shared fixtures. [tests/browser/](tests/browser/) holds Playwright specs (`submission.spec.ts`, `workflow.spec.ts`) run via `npm run test:browser` (config: [playwright.config.ts](playwright.config.ts)).

## Data — `data/` (gitignored)

- `job-scout.json` — the single persisted `State` document.
- `backups/` — the 8 most recent snapshots, numbered and content-hashed.
- `uploads/` — original uploaded resume files referenced from profile facts.
- `.lock` — exclusive process lock file.

## Build & config

- [vite.config.ts](vite.config.ts) — client build (outputs to `dist/client/`).
- [tsconfig.json](tsconfig.json) / [tsconfig.server.json](tsconfig.server.json) / [tsconfig.tools.json](tsconfig.tools.json) — separate TS configs for client, server (`dist/`), and standalone scripts (`.cache/tools/`).
- [vitest.config.ts](vitest.config.ts) — unit test config.
- [playwright.config.ts](playwright.config.ts) — browser test config (port 4317, isolated `.cache/browser-data/`).
- `.env.local` / `.env.example` — local secrets (AI provider keys); gitignored.

## Request flow (typical)

1. Client calls `request()` ([api.ts](src/client/api.ts)) → Express route in [app.ts](src/server/app.ts).
2. Route validates input (zod), loads `State` via [Repository](src/storage/repository.ts), and calls into the relevant `modules/*` function.
3. Module mutates `State` in place and/or enqueues work on the [task engine](src/tasks/engine.ts) (e.g., source refresh, AI ranking, draft generation).
4. `Repository` persists the updated `State` atomically; the task engine drains queued work asynchronously, calling `providers/` for AI calls or `modules/sources` for refreshes.
5. Client re-polls/bootstraps to reflect updated `State`.
