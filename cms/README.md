# Complaint Management System

A complete complaint-handling platform: public submission and tracking portal, case workspace, controlled workflow with approvals, SLA clocks on business calendars, automatic escalation, assignment engine, role-based access, audit trail, dashboards, reports and an optional rule-based assistant.

> This `cms/` folder is a new, self-contained application (Next.js + TypeScript + SQLite). It replaces nothing in the older Laravel code at the repository root.

## Try it in 3 minutes
```bash
cd cms
npm install
cp .env.example .env
npm run build
npm run seed:demo        # clearly labelled sample organization, people and complaints
npm start                # open http://localhost:3000
npm run worker           # in a second terminal: SLA checks, escalations, email delivery
```
Sign in at `/login` with `manager@demo.test`, `handler@demo.test`, `admin@demo.test` or `auditor@demo.test`, password `Demo-Passw0rd!`. The public pages are `/submit` and `/track`.

For a real installation follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (uses `npm run create-admin` instead of the demo data).

## What you get
| Area | Implemented |
|---|---|
| Public portal | 3-step form with immediate validation, browser autosave, anonymous option with plain explanation, consent, upload with progress, reference + private access code, rate limiting, honeypot; secure tracking, replies, files, reopen request, satisfaction survey |
| Roles | Super administrator, organization administrator, manager, handler, auditor, complainant, plus **custom roles**. Permissions enforced on the server; navigation shows only what a role may use |
| Workflow | 14 statuses; transition rules stored per organization (who, comment/evidence required); approval gate; closing restricted; optimistic concurrency |
| Assignment | Workload-balanced, round-robin, rules-based, manual; recommendations with reasons; sensitive cases always go to a manager; conflict-of-interest; full assignment history |
| SLA & escalation | Per-category targets, priority scaling, business hours/days/holidays/time zone/DST, pause & resume, At Risk / Breached / Paused / Completed; background worker escalates six conditions exactly once and notifies the right people |
| Case workspace | Timeline with staff-only vs public entries, tasks, @mentions, evidence (staff-only or shared), related complaints, approvals, SLA panel, assistant |
| Communication | Templates, outbox with retries/back-off/idempotency, in-app notifications, communication history; internal notes can never reach complainants |
| Dashboards & reports | Precise KPI definitions, period comparison, filters, charts with text alternatives, department performance, workload, recurring themes, CSV export (audited, capped, PII-aware), saved reports |
| Search & lists | Global search, filters, sorting, pagination, saved views, bulk actions with confirmation |
| Branding & security | Per-organization brand colour (text colours auto-adjusted for readability), pill buttons, logo upload; two-step sign-in with authenticator apps and recovery codes, optionally required for all staff |
| Governance | Hash-chained append-only audit log with integrity check, data retention, backups verified by test |
| Assistant | Rule-based suggestions: category, priority/sensitivity flag, summary, tone, draft replies, similar complaints, knowledge articles. Suggestions only; decisions recorded; can be switched off |

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Deployment & backup](docs/DEPLOYMENT.md) · [Security](docs/SECURITY.md) · [Testing](docs/TESTING.md) · [**Limitations and what is still needed for production**](docs/LIMITATIONS.md)
