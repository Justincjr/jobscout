# Job Scout — MVP implementation plan

## 1. Product goal

Build a web application that helps a job seeker find relevant openings on company career sites, understand how each role matches their experience, and prepare accurate, tailored application materials.

The core journey is: **confirm career profile → follow companies → discover jobs → review ranked matches → generate and edit application drafts → apply on the company website**.

This document is a plan only. The first implementation is a local application for your personal use, with JSON file storage and both Anthropic and OpenAI support.

## 2. Working assumptions and boundaries

- Run on your computer, accessed through a browser on localhost. No accounts, sign-in, or user management.
- Store application state in a local JSON file and uploaded/exported documents in local folders. No database or cloud storage service.
- Support Anthropic and OpenAI from the first version; either provider can be used independently with its own API key.
- Local storage does not mean offline AI: extraction and drafting send the necessary content to the selected provider. Saved jobs, profile editing, and existing drafts remain usable offline.
- “Verified” means explicitly reviewed and confirmed by the user; it does not mean independently checked with an employer or credential issuer.
- Discover openings from a user-selected company list and a small curated starter list. Internet-wide company discovery is outside the MVP.
- Start with public Greenhouse and Lever job boards linked from company career sites. Clearly label unsupported sites and allow users to paste a job description for matching and drafting.
- Offer manual refresh, refresh overdue sources at startup, and optionally refresh daily while the app is running. Nothing runs while the app is closed.
- Generate an editable tailored resume and cover letter. Users review, export, and submit applications themselves.
- Initial planning scale: one user, up to 50 company boards, and 10,000 active postings. These are capacity targets, not forecasts.

**Excluded initially:** accounts, authentication services, multi-user access, hosted deployment, databases, cloud storage, automatic application submission, recruiter outreach, scraping login-protected sites, CAPTCHA bypass, general-purpose browser crawling, billing, mobile apps, interview coaching, and employer-facing candidate ranking.

## 3. MVP features and acceptance criteria

| Area | MVP behavior | Acceptance criteria |
| --- | --- | --- |
| Local setup | Start the app and open it in a browser | No sign-in; state survives stopping and restarting the app. |
| AI settings | Choose Anthropic or OpenAI and configure a model | Either provider works without configuring the other; missing keys and invalid models produce actionable errors. |
| Career profile | Paste resume text or upload a text-based PDF; edit extracted experience, skills, education, and achievements | Extracted facts remain unverified until confirmed; unsupported or scanned files receive a clear message and paste-text fallback. |
| Verification | Review facts individually or confirm a reviewed selection | Each fact records its source, verification state, and confirmation time; edits revoke confirmation for the affected fact. |
| Preferences | Set desired roles, locations, remote preference, seniority, compensation, and optional work-authorization constraints | Preferences distinguish hard constraints from soft preferences and allow unknown values. |
| Companies | Add a supported board URL or choose a curated company | Show provider, last successful refresh, and any source error; unsupported URLs do not appear successfully connected. |
| Discovery | Retrieve, normalize, deduplicate, and refresh jobs | Repeated refreshes do not duplicate postings; source failures never mass-close jobs. |
| Matching | Rank active jobs and explain each score | Each explanation identifies supporting profile facts, missing evidence, and unknown requirements. |
| Job review | Search/filter jobs; save, dismiss, and mark applied | Filters and saved state persist; official posting and application links are visible. |
| Drafting | Generate a tailored resume and cover letter for one job | Generated factual claims trace to confirmed profile facts; unsupported claims block draft readiness. |
| Export | Edit, copy, and download materials as PDF or plain text | Export preserves user edits, warns about unsupported edited claims, and uses a clean single-column layout. |

## 4. Screens and user flow

1. **Local setup:** choose Anthropic or OpenAI, select a model, show whether the relevant API key is configured, and explain what content AI requests send externally.
2. **Profile setup:** paste/upload a resume, review extracted facts beside source excerpts, resolve ambiguous dates, and confirm selected facts.
3. **Preferences and companies:** choose search constraints and connect initial company boards.
4. **Job feed:** show title, company, location, match score, evidence coverage, freshness, and save/dismiss actions. Include clear loading, empty, and failed-refresh states.
5. **Job detail:** show the source description, requirement-by-requirement evidence, gaps, unknowns, and official application link.
6. **Application workspace:** display resume and cover-letter drafts, evidence references, editable content, revision history, and export controls.
7. **Saved applications and settings:** track saved/drafting/applied/archived states, maintain the profile and sources, change AI provider/model, and back up or restore local data.

The profile must contain confirmed experience and skills before personalized ranking and drafting are enabled. Browsing jobs remains available during onboarding.

## 5. Proposed architecture

Use a React/TypeScript interface and a single local Node.js/TypeScript server. The server serves the built interface, handles API requests, owns JSON persistence, and runs background tasks. Use a development frontend server only during development. Provide a documented Windows-compatible start command. No database, separate queue service, or hosted infrastructure is required.

| Component | Responsibility |
| --- | --- |
| React interface | Profile review, company management, job feed, match explanations, draft editor, and settings |
| Local Node.js server | Validated endpoints, filesystem access, AI requests, and background task execution |
| JSON repository | Persist profile facts, preferences, jobs, matches, drafts, settings, and task state in `data/job-scout.json` |
| Local document folders | Store uploads and exports under `data/` using generated file IDs |
| Anthropic adapter | Claude Messages API integration using the official SDK |
| OpenAI adapter | Responses API integration using the official SDK |
| In-process scheduler | Manual/startup refreshes and optional daily refresh while the server is running |

Keep API keys in server-side environment variables (`ANTHROPIC_API_KEY` and `OPENAI_API_KEY`) or an ignored `.env.local` file loaded by the local server. Store only provider/model selections in JSON. Never put keys in browser storage, frontend bundles, exported backups, or logs. Commit an example environment file with placeholders only.

Both adapters implement the same contract for profile extraction, job requirement extraction, evidence mapping, and application drafting. Normalize structured results, usage, refusals, timeouts, and rate-limit errors. Use schema-constrained output where supported and validate every result locally. Select supported model IDs during implementation rather than hardcoding a speculative model name.

Use [OpenAI structured outputs with the Responses API](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) and the [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create) as implementation references. Provider-specific request and response handling stays inside the adapters.

The default provider/model applies to new tasks, with an optional override when generating a draft. Snapshot the selection when a task starts. Record provider, model, prompt version, and usage with each result. Switching providers preserves existing drafts and never silently sends data to a second provider on failure. Cache keys include input versions, provider, model, prompt, and schema version.

Background tasks use unique task keys and persisted states: queued, running, completed, failed, or interrupted. A browser refresh does not cancel a task. After a server restart, safe fetch tasks can resume; interrupted AI requests require a visible retry because the previous request may already have been billed. Use bounded retries and concurrency limits.

Suggested repository layout:

```text
src/client/              React screens and components
src/server/              Local HTTP server and endpoints
src/modules/profile/     Extraction, confirmation, and profile versions
src/modules/sources/     Provider adapters and refresh orchestration
src/modules/jobs/        Normalization, snapshots, and lifecycle
src/modules/matching/    Requirements, scoring, and explanations
src/modules/drafts/      Grounded generation, validation, and exports
src/providers/           Anthropic/OpenAI adapters and shared contracts
src/storage/             JSON validation, atomic saves, backups, migrations
src/tasks/               In-process task handlers and scheduler
data/                    Local JSON, uploads, exports, and backups (gitignored)
tests/                   Unit, integration, evaluation, and browser tests
```

## 6. Data model

Use one versioned root JSON document containing settings, profile facts/versions, preferences, companies/sources, jobs/snapshots, matches, applications, drafts/revisions, and tasks. Records use stable IDs and references; no user or owner IDs are needed.

### File persistence rules

- Default location: `data/job-scout.json` inside the project; local uploads, exports, and backups also live under `data/`. Exclude the entire directory from version control and static web serving.
- Validate the root schema on load and before saving; include `schemaVersion`, `revision`, and `updatedAt`.
- One server process owns writes. Acquire an exclusive data-directory lock and reject a second instance. Serialize every read-modify-write operation through one write queue; use revision checks to reject stale edits from multiple browser tabs.
- Write a complete validated snapshot to a temporary file in the same directory, flush it, and atomically replace the live file. Preserve the previous valid snapshot as a backup. Test replacement behavior on Windows, including file locks and disk-full errors.
- Persist each logical update in one snapshot so references and their records change together. Stage document files before referencing them; clean up unreferenced files after interrupted operations.
- On malformed JSON, preserve the damaged file and offer recovery from a validated backup. Never silently reset the user's data to an empty store.
- Back up before schema migrations and support explicit backup/restore of the JSON plus referenced local documents. Exclude secrets. Pause tasks during restore and validate archive paths and references.
- Keep a bounded history of job snapshots and backups, preserving snapshots referenced by drafts. Profile facts and drafts are retained until explicitly deleted.
- Keep an in-memory index for filtering/pagination, while JSON remains the source of truth. Measure load/save performance at the target size before adding storage complexity.

| Entity | Important fields |
| --- | --- |
| Settings | Selected provider/model, refresh preference, generation limits, schema version |
| Profile / ProfileVersion | Version, structured confirmed snapshot, creation time |
| ProfileFact | Kind, value, source document/excerpt, verification status, confirmed time |
| Document | Generated ID, relative local path, MIME type, processing state |
| SearchPreferences | Target roles, hard constraints, soft preferences, version |
| Company / JobSource | Company name, provider, board identifier, approved URL, refresh status |
| Job / JobSnapshot | Provider ID, source, canonical URL, title, description, location, compensation if disclosed, content hash, first/last seen, lifecycle status |
| JobRequirement | Snapshot, requirement, required/preferred/unclear label, source excerpt |
| Match | Profile/preferences/job versions, scoring version, component scores, eligibility state, evidence links, gaps |
| Application | Job, saved/drafting/applied/archived status, user-entered application date |
| Draft / DraftRevision | Application, source versions, document type, text, claim-to-fact references, validation status, provider/model/prompt version |
| Task / RefreshRun | Task key, status, attempts, next retry, safe error code, provider/model where relevant, timestamps |

Use unique provider/source/external-ID keys for ingestion. Flag possible cross-source duplicates using normalized company, title, location, and application URL; do not merge distinct requisitions solely because titles match.

## 7. Job discovery pipeline

1. Validate a supported source URL and resolve its board identifier. Construct requests to known provider endpoints rather than fetching arbitrary user-supplied URLs.
2. Retrieve public postings with request timeouts, response-size limits, provider-specific pagination, rate limits, and retry backoff.
3. Normalize fields into a common schema; preserve source URLs and description excerpts. Treat omitted location, salary, and posting dates as unknown.
4. Strip unsafe markup and calculate a content hash. Create a new job snapshot only when relevant content changes.
5. Extract structured requirements once per changed snapshot, with evidence excerpts and schema validation. Do not infer undisclosed salary, sponsorship, or remote eligibility.
6. Enqueue matching against your confirmed profile for followed companies.
7. Record source completeness and refresh health. Mark a posting inactive only after absence from two consecutive complete successful refreshes; an explicit closure can mark it inactive immediately. Failed or partial fetches cannot establish absence.

Use the [Greenhouse Job Board API](https://docs.greenhouse.io/job-board) and [Lever public Postings API](https://github.com/lever/postings-api) as the first integrations. These provide access to published board postings; the MVP uses their job-reading capabilities. Review each source's access requirements before enabling collection.

Manual pasted jobs are private to the user and labeled “manually added; freshness unknown.” They participate in the same matching and drafting pipeline without automated refresh claims.

## 8. Explainable matching

Use an explicit scoring rubric instead of asking a model to invent an overall score.

**Step A — eligibility:** evaluate only user-selected hard constraints against explicit posting data. A known conflict is labeled ineligible and hidden from the default feed; missing information is labeled needs review and remains visible. Never infer work authorization from name, nationality, or location.

**Step B — evidence:** map each extracted requirement to confirmed profile facts using a controlled skill-alias list and constrained semantic matching. Preserve requirement excerpts and supporting fact IDs. Lack of profile evidence means “not demonstrated,” not a claim that the user lacks the skill.

**Step C — score:** use these starting weights, subject to calibration against your relevance feedback:

| Component | Weight |
| --- | ---: |
| Required skills and responsibilities | 40% |
| Relevant experience and seniority | 25% |
| Preferred skills and domain experience | 15% |
| Role/title alignment | 10% |
| Soft location, work-mode, and compensation preferences | 10% |

For each assessable requirement, assign supported = 1, partial = 0.5, and not demonstrated = 0. Calculate component means and a weighted score from 0–100. A component that cannot be assessed is excluded from the denominator and lowers the separately displayed evidence coverage. If nothing can be assessed, show “insufficient information” rather than a score. Low-coverage matches sort below adequately evidenced matches by default.

Show component scores, supporting evidence, missing required skills, unknown constraints, and a short explanation. The score measures profile alignment, not probability of an interview or offer. Recompute when the profile, preferences, job snapshot, or scoring rubric changes; mark cached results stale until refreshed.

## 9. Accurate application drafting

1. Load an immutable confirmed-profile snapshot, job snapshot, and matching evidence.
2. Select relevant experience and achievements while preserving employers, titles, dates, credentials, and metrics.
3. Generate structured resume sections and a cover letter with internal references from factual claims to confirmed fact IDs.
4. Validate schema, reference existence, dates, employers, and numerical claims. Check whether cited facts actually support the wording; a valid fact ID alone is insufficient.
5. Reject or flag unsupported statements and allow one bounded repair attempt. If validation still fails, show a recoverable error rather than a ready draft.
6. Let the user edit and save revisions. Revalidate edits and label unsupported additions; offer profile confirmation for new facts.
7. Export reviewed content without internal citation markers. Keep the evidence view inside the application workspace.

Do not invent achievements, employment duration, technologies, certifications, metrics, or personal enthusiasm based on nonexistent experience. Avoid calculating experience by summing overlapping employment periods. Draft generation must remain usable when the model fails: retain prior revisions and allow manual editing.

## 10. Security, privacy, and reliability

- Bind the server to loopback only. Validate Host and Origin, reject cross-origin state-changing requests, and do not enable permissive CORS. This is a personal local app, not a publicly exposed service.
- Validate requests and use local limits for uploads, refreshes, and generation. Resolve document IDs to known paths; never accept arbitrary filesystem paths from the browser.
- Restrict network destinations to supported providers. Validate redirect targets and block private, loopback, link-local, and metadata addresses to prevent SSRF.
- Treat resume text and job descriptions as untrusted data, including instructions embedded in them. Extraction and drafting have no browsing, shell, or external write tools.
- Validate uploaded file signatures and size; parse in an isolated worker with time and memory limits. Never execute embedded content or macros.
- Render job descriptions and generated content safely, and redact private content and API keys from logs.
- Explain model processing before sending profile data; exclude contact details from model prompts unless needed and explicitly supplied for the draft.
- Use HTTPS for external requests. Local JSON and documents are ordinary files; at-rest protection relies on OS permissions and any device encryption you enable. Do not claim application-level encryption.
- Provide explicit local-data deletion with confirmation, including selected documents, drafts, queued tasks, and backups. Prevent running tasks from recreating deleted data.
- Track refresh failures, stale sources, task latency, extraction failures, unsupported-claim failures, and model usage without recording resume text in telemetry.
- Set configurable daily usage budgets, cache job extraction by content hash, and pause new model tasks with a clear message when limits are reached.

## 11. Implementation milestones

Estimate: **3–4 weeks for one full-time experienced engineer** for the local MVP, subject to integration and export complexity. Re-estimate after the JSON persistence and dual-provider spike.

| Milestone | Work | Completion gate |
| --- | --- | --- |
| 1. Local foundation — week 1 | React UI, local server, JSON repository, atomic saves/recovery, provider settings, Anthropic/OpenAI adapters | Start without sign-in; data survives restart; both providers pass the same contract tests and a configured live smoke check |
| 2. Verified profile and discovery — week 2 | Resume extraction/review, confirmation, preferences, company sources, Greenhouse/Lever adapters, refresh, job feed | Unconfirmed facts stay out of matching/drafting; both sources normalize correctly; repeated refreshes do not duplicate jobs |
| 3. Matching and drafting — week 3 | Explainable scores, filters, saved jobs, grounded drafts, editing, revisions, provider override | Expected relevance ordering and evidence pass evaluation; both AI providers produce validated drafts using the same workflow |
| 4. Exports and local readiness — week 4 | PDF/text exports, application tracking, backup/restore, restart recovery, error handling, documentation | Complete workflow works locally; restore works; interrupted saves and provider failures preserve previous data |

Sequence dependencies: profile confirmation and job snapshots must exist before matching; matching evidence and immutable profile versions must exist before drafting. Ship a narrow complete workflow before adding another source provider.

## 12. Verification and release checklist

- **Unit tests:** normalization, skill aliases, score arithmetic, absent components, unknown constraints, overlapping employment dates, claim checks, and lifecycle transitions.
- **Storage tests:** serialized concurrent writes, stale tab edits, interrupted saves, locked files, disk-full failures, corrupted JSON, schema migrations, backup/restore, and second-instance rejection.
- **Integration tests:** source fixtures/pagination, changed postings, partial refreshes, task retry/idempotency, profile invalidation, local exports, and deletion.
- **AI provider tests:** run shared fixtures against both adapters; cover success, malformed output, refusals, invalid keys/models, timeouts, rate limits, truncation, and model switching. Mock routine tests; run a small opt-in live smoke check for each configured provider.
- **Security tests:** cross-origin localhost requests, unexpected Host headers, file path traversal, malicious source URLs/redirects, unsafe HTML, oversized files, secret leakage, and prompt-injection text.
- **Browser tests:** start locally → configure provider → confirm profile → follow company → refresh → inspect match → generate/edit/export → mark applied → restart and verify saved state.
- **Evaluation dataset:** at least 20 synthetic or explicitly consented job/profile pairs covering strong, partial, weak, ineligible, and unknown matches. Human-label expected ordering and evidence before tuning weights.
- **Draft quality gate:** zero unsupported generated factual claims across the release evaluation set; this is a test gate, not a guarantee about unseen outputs. Runtime validation and user review remain required.
- **Personal acceptance gate:** you can complete the workflow with your confirmed profile, inspect why jobs rank highly, and edit usable drafts from either provider.
- **Performance targets:** cached feed p95 under 2 seconds at the target local dataset size; measure AI latency separately for each configured model and show progress/retry controls. No model-independent latency guarantee.
- **Operational gate:** refresh health is visible, local usage limits work, restart recovery preserves state, and backup/restore and deletion have been rehearsed.

## 13. Decisions to finalize during setup

The plan can proceed with these defaults; confirm changes before they materially affect implementation:

- Initial audience and job markets: your personal use, English-language roles, with your preferred geography configured locally.
- Initial sources: Greenhouse and Lever, plus private pasted descriptions.
- Verification standard: user-confirmed facts with provenance.
- Runtime and storage: local Node.js server, React interface, one JSON state file, local upload/export folders; no accounts or database.
- AI providers: both Anthropic and OpenAI are required; choose the default provider/model in settings. Only the selected provider needs a configured key for a given task.
- Document formats: text-based PDF input; PDF and plain-text output. DOCX and scanned-document OCR are later additions.
- Delivery: documented local installation/start/stop instructions, example environment configuration, and backup/restore instructions. No cloud deployment.

## 14. Later iterations

Add more source adapters, broader company discovery, alerts, improved semantic matching, DOCX support, configurable templates, and application analytics after the personal workflow proves useful. Hosting, accounts, and database storage require a separate scope change. Keep application submission under explicit user control.
