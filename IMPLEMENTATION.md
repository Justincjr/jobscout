# Implementation and acceptance status

Implementation date: **2026-10-16**. `plan.md` includes the requested change to approval-based application submission.

## Implemented

- Local React/TypeScript interface and one loopback Node/TypeScript server; production and development start commands.
- Versioned JSON state with strict schema/reference checks, serialized writes, revision conflict checks, flush/atomic rename, bounded previous snapshots, instance locking, explicit corruption recovery, and complete document ZIP backup/restore.
- Independent official Anthropic and OpenAI SDK adapters with structured output, response validation, usage normalization, explicit errors, immutable task provider selections, and no automatic paid retry/fallback.
- Pasted/text-PDF profile input; signature and size checks; isolated PDF parser with memory/time/page limits; exact source excerpts; user confirmation; confirmation invalidation; immutable confirmed profile values.
- Hard/soft/unknown preferences; supported URL parsing; public Greenhouse and global/EU Lever boards; Lever pagination; source completeness checks; safe links and markup stripping; hashes/deduplication; bounded historical snapshots; complete-refresh lifecycle handling.
- Search, pagination, persistent feed filters, evidence/coverage/scoring, missing/partial evidence, application states/dates, source health, and conservative local matching.
- Fact-selection-based tailored resume/letter generation, local manual draft fallback, claim-to-fact references, immutable revisions, edit validation, reviewed text/PDF downloads, and explicit acknowledgment of unsupported edits.
- Persisted background queues, idempotency keys, safe fetch retries, visible interrupted AI work, daily usage limits, startup and optional running-app daily refresh, safe restore/deletion.
- In-app application preparation, editable employer questions, immutable resume/letter attachments, per-application approval, form-change checks, isolated Edge automation, public-address-pinned proxy, explicit receipts and uncertain-outcome reconciliation. No approval or submission is scheduled automatically.
- Local session token, Host/Origin checks, no permissive CORS, production CSP, dev server filesystem restrictions, public source destination allowlist, redirect rejection, private DNS rejection, input limits, and redacted failure messages.

## Verification completed

- **162 automated tests passed** across storage, matching, ranking deduplication/restart/budgets, both provider contracts, sources, drafts, task execution, HTTP security, document parsing, approved submissions, browser network boundaries and end-to-end API workflows.
- **20 synthetic labeled evaluation cases:** strong/partial/weak alignment, aliases, unknown requirements, and hard conflicts. Generated extractive drafts produced zero unsupported factual lines across these cases. The set is a regression gate, not a quality guarantee for arbitrary input or freeform prose.
- **Strict TypeScript check and production build passed.**
- **Browser workflow inspected in an isolated test workspace:** manual experience/skill entry, explicit confirmation, pasted job, scores/evidence, local resume/letter creation, unsupported edited-claim warning, revision retention, reviewed-export controls, application date/status, persistence after page reload, and desktop/mobile layouts. At 390 px viewport width, page width was 390 px with no horizontal overflow. Form labeling and collapsed navigation accessibility defects found during this check were fixed. PDF/TXT bytes and backup/restore were checked through the automated API suite.
- **Synthetic 10,000-job measurement:** 50.81 MB JSON; initial matching/save 3,937 ms; reload 253 ms; 25 feed requests p95 324 ms (target <2,000 ms). Hardware and record size affect these figures. AI latency was not included.
- **Updated benchmark including 10,000 saved LLM assessments:** 58.40 MB JSON; initial fixture matching/save 6,401 ms; reload 791 ms; 25 feed requests p95 507 ms. The scores were synthetic; no model requests were made.
- Browser inspection of the ranking update verified saved LLM scores, model/profile metadata, exact evidence quotes, stale-input warnings, and the disabled completed-ranking button in an isolated synthetic workspace. The expanded company setup exposes Workday, Shopee and public website import.
- Filesystem failure tests inject disk-full/access/rename failures before the atomic replacement boundary, verifying that current state survives. Actual physical disk-full, power-loss, and antivirus locking scenarios still require device-level rehearsal.

## Release gates that still require follow-through

- Live provider smoke checks were not run: the sandboxed TypeScript runner failed during Windows user-information lookup and escalation was declined. Both providers have mocked SDK contract/error coverage. Configure your own key and run Test provider or the opt-in live command to establish actual account/model compatibility.
- **Four browser tests passed** using installed Microsoft Edge, avoiding the earlier blocked browser download. Synthetic tests verify PDF uploads, a single submission, changed-form rejection and Ashby custom controls; the UI workflow covers reviewed drafts, export and tracking. No real employer submission has been tested or sent.
- A live read-only source check imported all 200 Shopee postings for `level=4` with location/level metadata, and verified a public Workday listing plus full posting detail. The Workday source reported a capped total of 2,000. These endpoints are public website interfaces rather than guaranteed stable vendor APIs; other tenants and sites still require verification.
- Personal acceptance needs your reviewed profile, preferred geography, real shortlist, and inspection of usable drafts from each provider you intend to use.

## Deliberate conservative limits

- New jobs use a persisted LLM score and cited relevance assessment. Each posting is sent once within configured budgets. Completed rankings survive refreshes, restarts and task-history pruning. Profile/preference or posting changes are labeled stale, without new paid calls. Existing jobs are never automatically backfilled. Local aliases/constraint checks remain separate. Rank evidence citations are checked for exact source passages; model judgments still require human review.
- AI selects/order facts; it does not freely rewrite achievements, dates, metrics, credentials, or employment claims. This provides a narrow usable workflow with enforceable grounding. More fluent prose can be edited locally and is flagged if unsupported by exact confirmed facts. This is stricter than the plan's proposed semantic claim validator.
- PDF export uses built-in Latin fonts. Unsupported characters get an explicit UTF-8 text fallback, rather than being silently replaced. OCR and DOCX remain out of scope.
- Schema version 1 is the only shipped format. No historical migration exists to test yet; unsupported schemas fail closed. Automatic snapshots are JSON-only; downloadable and pre-restore archives include documents.
- Current-fact removal retains historical snapshots intentionally. Whole-workspace deletion erases all local copies, including backups. Manage downloaded files and environment keys separately.
- Workday imports up to 100 new details per refresh and treats 2,000 reported results as a potential cap. Existing detail text is cached. Shopee preserves listing filters and full pagination. Generic company-site imports use JSON-LD/readable HTML, honor robots, stay on-origin, and are always partial; JavaScript-only sites require an adapter or paste fallback. No universal crawler is claimed.
- Schema version 1 has additive default ranking records, so older state files load without creating paid ranking candidates for existing jobs.
- Application automation requires explicit approval for each exact saved payload. It supports readable single-page public forms, including Greenhouse embeds and Ashby custom questions, and stops on unsupported controls, conditional form changes, account/login flows, CAPTCHA and unclear confirmation. Generic Workday/Shopee account applications are not claimed supported. No hosted deployment, app accounts, database, unapproved applications, outbound recruiter messages, or work while the server is stopped.
