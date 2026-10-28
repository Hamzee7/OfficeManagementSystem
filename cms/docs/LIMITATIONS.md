# Known limitations and remaining production-readiness work

Read this before going live. Nothing here is hidden: the app shows "Not configured" where something is not wired up.

## Integrations that need credentials or code
| Item | Status |
|---|---|
| Email (SMTP) | Implemented via nodemailer. **Needs** `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`. Without them emails are queued and only logged, not delivered. Real delivery has not been tested in the development environment. |
| SMS | Outbox supports the channel; **no provider adapter exists**. Contact method "text message" is accepted but nothing is sent. |
| Single sign-on / LDAP / Azure AD / Google | Not implemented. |
| Webhooks, CRM, helpdesk, BI, document storage, external ticketing | Not implemented (extension points documented). |
| External AI model | Not connected. The built-in assistant is rule-based (keywords, extractive summaries, templated drafts, word-overlap duplicate detection) and is much weaker than a language model. |
| Malware scanning of uploads | Not implemented. Uploads are type-checked by content only. |

## Functional gaps against the full specification
* **Two-step sign-in** (authenticator app, recovery codes, optional organization-wide requirement) is implemented. Not implemented: hardware security keys / passkeys, SMS codes, remembering trusted devices.
* **Scheduled / distributed reports** (email PDF/CSV on a schedule) are not implemented. Reports can be saved as named filters and exported to CSV on demand. **PDF export** is not implemented.
* **Server-side drafts / autosave for signed-in users**: the public form autosaves in the browser (this device only), not on the server. Complaint status "Draft" exists but is unused.
* **Rich notifications**: in-app and email only. No push, no messaging-app integrations. Users cannot yet set per-channel notification preferences.
* **Checklists** inside tasks, and an "SLA pause" rule editor (only "Awaiting Complainant" pauses) are not configurable in the UI. Escalation *levels* and recipients are fixed (assignee, people with `complaint.escalation.manage`, administrators), thresholds are configurable.
* **Department-scoped managers**: managers see the whole organization. Restricting a manager to one department is not implemented (custom roles are organization-wide).
* **Subcategories** exist in the schema (`parent_id`) but the interface does not use them.
* **Conflict-of-interest rules** cover "not your own complaint" and previous handlers; named-party conflicts are not modeled.
* **Cross-tenant platform views** (reports across all organizations) are not built.
* **Search** uses SQL `LIKE` (fast to ~20k complaints in tests). Beyond roughly 100k records add SQLite FTS5 or PostgreSQL full-text search.
* The complaint list does not offer inline editing; bulk actions cover assign and status change.

## Engineering follow-ups
* **Database**: SQLite is a good fit for one organization on one server. For multiple busy tenants, high availability or managed backups, port `src/server/*` SQL to PostgreSQL (statements are plain SQL; `better-sqlite3` calls are synchronous and would become async).
* **Encryption at rest**, secrets management and key rotation are the host's responsibility today.
* **Accessibility**: built for WCAG 2.2 AA (semantic HTML, labels, focus styles, reduced-motion, keyboard operability, text alternatives for charts, contrast tokens) but not formally audited with assistive technology or an automated checker.
* **Load testing** with concurrent users, and an external **penetration test**, have not been done.
* Docker files and the GitHub Actions workflow were written but not executed in the development environment.
* `npm audit --omit=dev` reports 2 remaining advisories, both in PostCSS as bundled by Next.js 15 (build-time CSS tooling, not reachable from user input at runtime). Upgrade Next.js when a patched release is available. nodemailer and zod were upgraded to versions without known advisories.
* One end-to-end run out of roughly eight failed once on the assigned-handler step (the complaint appeared unassigned) and did not reproduce in the next three runs; the cause was not identified. Treat intermittent e2e failures as real until explained.
* Legal: no regulatory compliance is claimed. Privacy notice wording in the form is a generic placeholder and must be replaced by your organization's approved text.
