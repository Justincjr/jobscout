# Job Scout

A personal, local job-search workspace built from [plan.md](plan.md). React and TypeScript run in your browser; one Node server owns the local JSON file, documents, and background tasks. No account or database is required.

## Start on Windows

Install Node.js 24 LTS or later, then open PowerShell in this folder:

```powershell
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4310**. Keep the terminal running. Press **Ctrl+C** there to stop. Run `npm start` again to reopen your saved workspace. `npm run dev` runs the development interface and local API in one process.

For a different port, set `$env:PORT='4311'` before starting. The server always binds to `127.0.0.1`. Do not expose it through a tunnel or reverse proxy: this version is intended for one local user.

## Set up AI (optional for browsing and manual work)

Copy `.env.example` to `.env.local`, fill in either provider's API key using your editor, and restart the server:

```powershell
Copy-Item .env.example .env.local
```

Choose **Settings**, select OpenAI or Anthropic and a model your API account supports, review the processing notice, enable AI processing, and save. **Test provider** performs a small structured-output request and records its status in Background activity. You do not need keys for both providers.

The supplied model suggestions are `gpt-4.1-mini` and `claude-sonnet-5-5`; model availability is account-dependent. Any compatible model ID can be entered. Invalid keys, unsupported models, refusals, incomplete responses, limits, and timeouts produce safe, actionable errors. No provider fallback or automatic paid retry occurs.

Keys are read only by the server. They are excluded from browser responses, logs, JSON state, and ZIP backups. `.env.local` and `data/` are ignored by version control. This project does not contain or create credentials.

## Use the workspace

1. **Career profile:** paste a resume or upload a text-based PDF (5 MB / 40 pages maximum). Save locally, then choose Extract facts if you want AI extraction. Alternatively, enter individual facts manually. Extracted facts must reproduce source passages and start unconfirmed.
2. Review the text and source excerpt for each fact. Select only facts you have checked and confirm them. Personalized matching and drafts require at least one confirmed experience fact and one confirmed skill. An edit revokes that fact's confirmation. Older confirmed snapshots remain attached to older drafts.
3. **Preferences:** set roles, locations, work mode, seniority, annual compensation/currency, and optional authorization constraints. Commas separate acceptable alternatives. Empty values mean no preference. Mark essential preferences as hard constraints; unknown posting information needs review and stays visible.
4. **Companies:** add Greenhouse, Lever, Ashby (`jobs.ashbyhq.com/company`), Workday (`*.myworkdayjobs.com/site`), Shopee, or a public company career page, or follow a starter company. Refresh to verify connectivity and retrieve jobs. Unfollow a company to stop refreshes while retaining its jobs and drafts; follow it again at any time. Failed or partial results never establish closure; a job must be absent from two complete successful refreshes before becoming inactive.
5. **Discover:** search and filter, save or dismiss jobs, and inspect the evidence behind each score. Unsupported sites can be added through **Add a job** by pasting a description; their freshness is explicitly unknown. Save filters to persist them.
6. **LLM ranking:** newly discovered and manually added jobs are sent once to your selected AI provider when you have a confirmed profile, consent, a configured key, and available budget. The model returns a 0–100 alignment score, summary, strengths with exact profile/job excerpts, gaps, and unknowns. Saved AI scores determine feed order. Refreshes, restarts, provider changes, and profile/preference edits never automatically send a completed posting again. Changed inputs are labeled stale. Failed/interrupted requests require an explicit retry. Jobs that existed before this feature are not automatically backfilled; their Evidence tab offers an explicit Rank this job action. Local constraint and keyword checks remain visible separately.
7. In **Application workspace**, choose the provider/model for that draft or create drafts from confirmed facts without AI. AI selects and orders fact IDs; factual wording is copied from the immutable confirmed profile. Edit, save a revision, inspect warnings and references, and mark your review complete before exporting PDF or text. Unsupported edited lines require explicit acknowledgment before export. PDF uses a clean single column; if characters cannot be represented by the built-in font, use UTF-8 plain text.
8. **Approved application submission:** choose **Draft application** inside a role. Generate or create both drafts, review their Resume and Cover letter tabs, and save each as reviewed. Choose **Prepare application** to read the public employer form. Enter contact details and screening answers; select the reviewed resume/letter PDFs for attachment and inspect their previews. Save answers, check the approval statement, and choose **Approve and submit application**. This authorizes only that saved application. Only a visible employer confirmation marks it applied. If the outcome is uncertain, check the employer's receipt/history and explicitly reconcile it before retrying. No recruiter messages are sent.

AI extraction sends resume text; analysis sends the job description; ranking and drafting send the job, confirmed career facts, and relevant preferences to the chosen provider. Recognized email addresses, likely phone numbers, and profile links are removed from resume/profile prompts. This is not a complete personal-data detector: inspect your content first. Manual profile review, saved jobs, local checks, saved AI rankings, existing drafts, and exports work without external AI access.

## Local storage, recovery, and deletion

- State: `data/job-scout.json`; referenced originals: `data/uploads/`; generated downloads: `data/exports/`.
- Every state change is serialized, schema/reference validated, flushed to a same-directory temporary file, and atomically replaced. Stale browser revisions are rejected. An exclusive lock rejects a second server instance using the same folder. Dead-process locks are reclaimed on startup.
- The eight most recent JSON snapshots are kept in `data/backups/`. Settings → Download local backup creates a ZIP with JSON and every referenced original document. It excludes API keys and regenerable exports. Store downloaded backups securely: they contain personal information.
- Settings → Restore validates archive paths, decompressed limits, schema, and document references before replacement. Type RESTORE to proceed. Tasks pause, a complete `before-restore-*.zip` safety archive is saved locally, and imported unfinished tasks require explicit retry. Conflicting document IDs with different bytes are rejected; restore those archives in a fresh empty workspace.
- Malformed state never silently resets. Stop the app and run `npm run recover -- --list`, then `npm run recover -- <listed-filename> --confirm`. Recovery preserves the damaged original. The original documents must still exist; otherwise use a downloaded complete ZIP in a fresh workspace. Only schema version 1 is supported; unknown versions are rejected rather than guessed.
- Settings → Delete local workspace requires typing DELETE and removes profiles, jobs, drafts, uploads, exports, tasks, and local backups. Running work is stopped before removal. Downloaded backups/exports and `.env.local` are outside this deletion. Removing a current fact retains historical profile and draft snapshots; delete the local workspace to erase those copies.
- Ordinary local files are not encrypted by this application. Protection at rest depends on OS permissions and device encryption.

Startup refreshes overdue sources. The optional daily refresh operates only while the server runs. AI work is serialized, snapshotted to its selected model, cached by input/provider/model/prompt/schema versions, and bounded by UTC daily request/token budgets. Failed calls retain a conservative token reservation when usage is uncertain. Restarted AI calls are marked interrupted and require an explicit retry, because they may have been billed.

Greenhouse feeds allow up to 20 MB because they include all full job descriptions in one response; other career requests retain the 5 MB default. Plaid's retired Lever starter is updated to its Ashby board on startup when that source has no imported jobs. The source ID, follow preference, and task history are retained.

## Verify

```powershell
npm test                 # mocked provider, storage, sources, matching, draft and HTTP tests
npm run build            # strict type checks and production build
npm run benchmark        # creates/removes a synthetic 10,000-job dataset under .cache/
npm run test:live         # opt-in small calls, only for providers with configured keys
npm run test:sources:live # opt-in public Shopee pagination and one Workday detail check
```

Application automation and repeatable browser tests use installed Microsoft Edge. Run:

```powershell
npm run build
npm run test:browser
```

The browser suite uses port 4317 and an isolated `.cache/browser-data/` folder. Its synthetic data can be cleared through that instance's Settings before another run. If your organization uses a custom certificate authority, configure its trusted certificate normally; do not disable TLS verification.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for measured verification results, release gates, and current limits. Nothing has been committed, pushed, or deployed.

## Implementation references

- [OpenAI Responses structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [model IDs](https://platform.claude.com/docs/en/models/overview)
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board)
- [Lever public postings](https://github.com/lever/postings-api)

Shopee uses the public job feed referenced by its careers page. Listing filters such as `level=4` are mapped to `employment_ids=4`; pagination parameters do not limit the saved source to one page. The supplied URL therefore follows internships across the locations returned by that feed; it does not impose a Singapore-only location constraint.

Workday uses its public career-site JSON interface (including read-only POST search). Up to 100 new posting details are imported per refresh; repeat refreshes continue the import and reuse existing details. Sources reporting 2,000 results are treated as potentially capped, so missing jobs cannot establish closure. Existing Workday descriptions are cached; changes to their list title/location are updated, but description-only edits are not detected automatically.

Other public company pages support Schema.org JobPosting JSON-LD and a conservative HTML fallback for readable linked job pages. Requests honor robots rules, stay on the approved origin, import at most 25 new linked pages per refresh, pin validated public DNS addresses, reject redirects, and enforce time/size limits. These imports are always partial and cannot automatically close jobs. Existing linked detail text is cached, so description-only edits may not be detected. JavaScript-only sites, login requirements, or blocked pages need a dedicated integration or pasted description; this is not universal website support.

Production requests use the operating system's trusted certificate store through Node's `--use-system-ca`; certificate validation remains enabled. Application preparation uses a separate, temporary Edge session. It does not reuse your signed-in browser. The browser's HTTPS proxy pins validated public DNS addresses and blocks private destinations. Preparation blocks writes except read-only GraphQL queries; applicant answers and attachments are transmitted only after approval. Saved answers, approvals and receipts are personal local data included in backups.

Submission supports readable single-page public forms, including embedded Greenhouse and Ashby's native inputs, yes/no controls and grouped choices. The Stripe Greenhouse embed and a Plaid Ashby form were checked read-only. Searchable employer choices need their exact visible names; unsupported controls, changed/conditional questions, required logins, multi-step applications, CAPTCHA challenges and missing confirmation stop progress or require attention. This is not universal support for every site's application flow; Workday and Shopee account flows may require a dedicated integration. No live employer application was submitted during development; actual submission is tested against synthetic employer pages. Draft PDFs currently require grounded text and supported Latin-font characters.

- [Schema.org JobPosting](https://schema.org/JobPosting)
- [Shopee career listing used for verification](https://careers.shopee.sg/jobs?level=4&limit=50&offset=0)
- [Public Workday career site used for verification](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite)
