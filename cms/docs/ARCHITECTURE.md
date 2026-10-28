# Architecture

## Stack and why
| Layer | Choice | Reason |
|---|---|---|
| Web app | Next.js 15 (App Router), React 19, TypeScript | Server-rendered pages read data directly through the permission-checked service layer; small client components handle forms. |
| Data | SQLite (better-sqlite3) with plain SQL migrations | Runs anywhere with zero setup, transactional, fast for tens of thousands of complaints (tested at 20,000). One writer is plenty for a single organization. **For many concurrent tenants or high availability, move to PostgreSQL** (see LIMITATIONS.md). |
| Auth | Built-in: scrypt password hashes, server-side sessions in the database, HttpOnly SameSite cookies | No external dependency. A hosted identity provider (SSO) can replace `server/auth.ts` later. |
| Background | `npm run worker`, a separate process | SLA checks, escalations and email delivery run without anyone having the site open. |
| Styling | Hand-written CSS with design tokens (`src/app/globals.css`) | No build dependency, light/dark themes, accessible by default. |

The repository's older Laravel app in the project root was **not** modified or reused: it targets Laravel 5.5 and cannot run on current PHP.

## Layers
```
src/lib/        Pure business rules. No database, no HTTP. Fully unit tested.
  permissions.ts  permission catalogue + built-in roles + navigation visibility
  workflow.ts     status list and the transition engine (who may move from X to Y, what is required)
  calendar.ts     business-time arithmetic: time zones, DST, working days, holidays
  sla.ts          deadlines, SLA state (On Track / At Risk / Breached / Paused / Completed), pause/resume
  assignment.ts   handler recommendation (workload, round-robin, rules, conflict of interest)
  escalation.ts   which escalation rules apply to a complaint at a moment in time
  ai.ts           rule-based assistant behind an AiProvider interface
src/server/     Services. Every function that touches data takes an AuthContext and enforces permissions.
  db.ts audit.ts auth.ts org.ts complaints.ts portal.ts storage.ts notify.ts escalate.ts reports.ts admin.ts ai.ts backup.ts
  web.ts          route wrapper: origin check, authentication, uniform JSON errors
src/app/api/    Thin HTTP routes. Validate input with zod, call a service.
src/app/        Pages. Server components call services directly; `components/*Client.tsx` hold interactivity.
src/worker/     Background loop.
migrations/     Versioned SQL, applied automatically at start-up.
```

## Key design decisions
* **Authorization lives in the service layer**, not the UI. Hiding a button is cosmetic; every service call re-checks permissions and row visibility (`canView`, `scopeSql`). Records outside your scope return *404*, so their existence is not revealed.
* **Multi-tenancy.** Every table carries `org_id`; every query filters by the session's active organization. Only users with `platform.manage` can switch organization. Tests cover cross-tenant reads, assignment and listing.
* **Workflow is data.** `workflow_transitions` is stored per organization and edited in Settings. Two rules are deliberately not configurable: resolving requires an approval decision by someone other than the proposer, and closing requires `complaint.approve`.
* **Time.** All instants are UTC milliseconds. Deadlines are computed in *business minutes* on the organization's calendar (time zone, working days, hours, holidays). Pausing stores the remaining business minutes and resuming re-places the deadline. Verified across a daylight-saving change.
* **Idempotent background work.** Escalations are unique per (complaint, rule, level); notifications and emails carry dedupe/idempotency keys. Running the worker twice, or two workers, produces no duplicates.
* **Append-only history.** Database triggers refuse UPDATE/DELETE on `complaint_events`, `assignments` and `audit_events`. The audit log is also hash-chained, so edits made by someone with direct database access are detectable (`/audit` shows the verification result).
* **Public portal privacy.** A reference number alone reveals nothing. Tracking needs reference **and** a 12-character random access code (stored only as a hash), is rate limited, and gives one uniform "not found" answer. Public downloads use 10-minute HMAC-signed links. Internal notes, staff names, approvals and unapproved resolutions are never part of the public view (tested).
* **AI is advisory.** The built-in assistant runs locally, proposes (never applies) changes, flags safety/conduct wording for human review, and every suggestion and the human's decision are stored in `ai_recommendations`. It never rejects, closes, disciplines or messages anyone on its own.

## Extension points
* **Email/SMS**: `MailTransport` in `server/notify.ts`. Add an adapter and select it in `worker/run.ts`.
* **AI model**: implement `AiProvider` (`lib/ai.ts`), keep PII out of prompts unless the organization has approved it.
* **Webhooks / CRM / helpdesk / BI**: emit from `recordEvent` and `audit`; none are implemented.
* **Single sign-on**: replace `login()`/`authenticate()` in `server/auth.ts`.
