# Database schema

Source of truth: `migrations/001_init.sql`. All ids are UUID text, all times are UTC milliseconds, all tenant tables have `org_id`.

| Area | Tables |
|---|---|
| Tenancy | `organizations` (time zone, calendar, SLA/escalation thresholds, retention, assignment method), `holidays`, `departments`, `locations` |
| Identity | `users`, `roles`, `role_permissions`, `sessions` |
| Cases | `complaints`, `complaint_events` (timeline: notes, messages, status changes, SLA/escalation events), `assignments`, `attachments`, `tasks`, `approvals`, `surveys` |
| Policy | `categories` (SLA targets, sensitivity, keywords), `workflow_transitions`, `message_templates` |
| Operations | `escalations`, `notifications`, `outbox` (email/SMS queue and communication history), `rate_limits`, `counters` |
| Knowledge & saved | `kb_articles`, `saved_views`, `saved_reports` (reserved), `ai_recommendations` |
| Governance | `audit_events` (hash-chained, append-only) |

Integrity features
* Foreign keys on (`PRAGMA foreign_keys=ON`); CHECK constraints on enumerations (priority, channel, approval status, rating 1-5).
* `UNIQUE (org_id, ref)` for complaint references; `UNIQUE (complaint_id, rule_key, level)` for escalations; unique idempotency key on `outbox`; unique `(user_id, dedupe_key)` on notifications.
* Triggers block UPDATE/DELETE on `complaint_events`, `assignments`, `audit_events`.
* `complaints.version` provides optimistic concurrency: a stale status change is rejected with 409.
* Multi-step operations (submission, assignment, transitions, approvals) run in transactions.
* Indexes on (org, status), (org, assignee, status), (org, created), (org, due), department and category.

Retention
* `organizations.retention_days` (default 2,555 = 7 years). The worker hourly removes complainant name/email/phone from complaints closed longer ago than that, keeping the case, history and statistics. Hard deletion of whole cases is intentionally not offered: complaint history and audit records are not deletable through the application.
* Soft deletion is used only for users (`is_active=0`), departments/categories (`active=0`) so history stays intact.
