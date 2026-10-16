# Job Scout

A personal, local job-search workspace built from [plan.md](plan.md). React and TypeScript run in your browser; one Node server owns the local JSON file, documents, and background tasks. No account or database is required.

## Start on Windows

Install Node.js 24 LTS (minimum 22.16), then open PowerShell in this folder:

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
4. **Companies:** add a public Greenhouse or Lever board, or follow a starter company. Refresh to verify connectivity and retrieve jobs. Unfollow a company to stop refreshes while retaining its jobs and drafts; follow it again at any time. Failed or partial results never establish closure; a job must be absent from two complete successful refreshes before becoming inactive.
5. **Discover:** search and filter, save or dismiss jobs, and inspect the evidence behind each score. Unsupported sites can be added through **Add a job** by pasting a description; their freshness is explicitly unknown. Save filters to persist them.
6. Open a role's **Evidence** tab. Local requirement extraction and a controlled skill-alias list work offline. Optional AI analysis extracts verbatim requirement passages. Scores use the documented 40/25/15/10/10 rubric and show separate coverage. Partial evidence never establishes an employment duration, credential, or responsibility merely from a skill mention.
7. In **Application workspace**, choose the provider/model for that draft or create drafts from confirmed facts without AI. AI selects and orders fact IDs; factual wording is copied from the immutable confirmed profile. Edit, save a revision, inspect warnings and references, and mark your review complete before exporting PDF or text. Unsupported edited lines require explicit acknowledgment before export. PDF uses a clean single column; if characters cannot be represented by the built-in font, use UTF-8 plain text.
8. Apply yourself through the visible company-site link. Record the actual application date and status. No applications or messages are submitted automatically.

AI extraction sends resume text; analysis sends the job description; drafting sends the job and confirmed career facts to the chosen provider. Recognized email addresses, likely phone numbers, and profile links are removed from resume/profile prompts. This is not a complete personal-data detector: inspect your content first. Manual profile review, saved jobs, matching, existing drafts, and exports work without external AI access.

## Local storage, recovery, and deletion

- State: `data/job-scout.json`; referenced originals: `data/uploads/`; generated downloads: `data/exports/`.
- Every state change is serialized, schema/reference validated, flushed to a same-directory temporary file, and atomically replaced. Stale browser revisions are rejected. An exclusive lock rejects a second server instance using the same folder. Dead-process locks are reclaimed on startup.
- The eight most recent JSON snapshots are kept in `data/backups/`. Settings → Download local backup creates a ZIP with JSON and every referenced original document. It excludes API keys and regenerable exports. Store downloaded backups securely: they contain personal information.
- Settings → Restore validates archive paths, decompressed limits, schema, and document references before replacement. Type RESTORE to proceed. Tasks pause, a complete `before-restore-*.zip` safety archive is saved locally, and imported unfinished tasks require explicit retry. Conflicting document IDs with different bytes are rejected; restore those archives in a fresh empty workspace.
- Malformed state never silently resets. Stop the app and run `npm run recover -- --list`, then `npm run recover -- <listed-filename> --confirm`. Recovery preserves the damaged original. The original documents must still exist; otherwise use a downloaded complete ZIP in a fresh workspace. Only schema version 1 is supported; unknown versions are rejected rather than guessed.
- Settings → Delete local workspace requires typing DELETE and removes profiles, jobs, drafts, uploads, exports, tasks, and local backups. Running work is stopped before removal. Downloaded backups/exports and `.env.local` are outside this deletion. Removing a current fact retains historical profile and draft snapshots; delete the local workspace to erase those copies.
- Ordinary local files are not encrypted by this application. Protection at rest depends on OS permissions and device encryption.

Startup refreshes overdue sources. The optional daily refresh operates only while the server runs. AI work is serialized, snapshotted to its selected model, cached by input/provider/model/prompt/schema versions, and bounded by UTC daily request/token budgets. Failed calls retain a conservative token reservation when usage is uncertain. Restarted AI calls are marked interrupted and require an explicit retry, because they may have been billed.

## Verify

```powershell
npm test                 # mocked provider, storage, sources, matching, draft and HTTP tests
npm run build            # strict type checks and production build
npm run benchmark        # creates/removes a synthetic 10,000-job dataset under .cache/
npm run test:live         # opt-in small calls, only for providers with configured keys
```

For repeatable browser tests, install the test browser into this project and run:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.cache\playwright"
npx playwright install chromium
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

Job sources only use their public GET endpoints. No employer application-submission API, private board, login scraping, or general crawling is implemented.
