# HTTP API

JSON over HTTP. Staff endpoints need the session cookie from `POST /api/auth/login`. State-changing requests must come from the same origin (cross-site requests get 403). Errors: `{ "error": "plain-language message" }` with status 400/401/403/404/409/413/415/422/429. Validation messages are written for end users.

## Public (no sign-in)
| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness + database check |
| `GET /api/portal/options?org=slug` | Categories, departments, locations for the form |
| `POST /api/portal/submit` | Submit a complaint → `{ref, accessCode}` (code shown once). Rate limited, honeypot, consent required |
| `POST /api/portal/track {ref, code}` | Public view of one complaint (no internal data) with 10-minute download links |
| `POST /api/portal/message {ref, code, body}` | Complainant reply (resumes a paused SLA) |
| `POST /api/portal/upload` (multipart `ref`, `code`, `file`) | Add evidence |
| `POST /api/portal/reopen {ref, code, reason}` | Reopen a resolved complaint |
| `POST /api/portal/feedback {ref, code, rating 1-5, comment}` | Satisfaction survey (once) |
| `GET /api/portal/file?t=<signed token>` | Download a public attachment |

## Authentication
`POST /api/auth/login {email,password}` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password {current,next}`

## Complaints (staff and signed-in complainants; row-level scope applies)
| Method & path | Permission |
|---|---|
| `GET /api/complaints?q&status&priority&categoryId&departmentId&locationId&assigneeId&scope=mine\|assigned\|unassigned\|escalated\|awaiting_approval&from&to&sort&page&pageSize` | view (scoped) |
| `POST /api/complaints` | `complaint.create` (log on behalf of someone) |
| `GET /api/complaints/{id}` | view (scoped); internal data only for staff |
| `POST /api/complaints/{id}/transition {to, comment?, expectedVersion?}` | per workflow rule |
| `POST /api/complaints/{id}/assign {userId, reason}` · `GET …/recommendations` | `complaint.assign` |
| `POST /api/complaints/{id}/note {body}` | `complaint.note.internal` |
| `POST /api/complaints/{id}/message {body, kind: update\|request_info}` | `complaint.message.external` |
| `POST /api/complaints/{id}/propose {text}` | `complaint.transition` (assigned handler or manager) |
| `POST /api/approvals/{id} {approve, comment}` | `complaint.approve`, not the proposer |
| `POST /api/complaints/{id}/task {title, ownerId, dueAt}` · `POST /api/tasks/{id}/complete` | `complaint.note.internal` |
| `POST /api/complaints/{id}/evidence` (multipart `file`, `visibility`) | `complaint.evidence.upload` |
| `GET /api/attachments/{id}` | view; internal files staff only; every download audited |
| `POST /api/complaints/{id}/link {otherId}` | `complaint.note.internal` |
| `POST /api/complaints/bulk {ids≤50, action: assign\|transition, …, confirm:true}` | each item checked individually |
| `POST /api/complaints/{id}/ai {kind}` · `POST /api/ai/{id} {accept}` | `ai.use`, only if the organization enabled AI |
| `POST /api/escalations/{id}/ack` | `complaint.escalation.manage` |
| `GET/POST /api/notifications` | own notifications |
| `GET/POST/DELETE /api/saved-views` | own saved filters |

## Reports and audit
`GET /api/reports/dashboard?from&to&departmentId&categoryId&locationId` (`report.view`) · `GET /api/reports/export?<complaint filters>` (`report.export`, CSV, 10,000-row cap, PII only with `complainant.pii.view`, audited) · `GET /api/audit?page` (`audit.view`, includes chain verification)

## Administration
`POST /api/admin/users`, `PATCH /api/admin/users/{id}` (`users.manage`) · `…/departments`, `…/locations` (`departments.manage`) · `…/categories` (`categories.manage`) · `…/settings`, `…/holidays`, `…/templates` (`org.manage`) · `…/workflow` (`workflow.manage`) · `…/roles` (`roles.manage`) · `…/kb` (`kb.manage`) · `…/organizations`, `…/switch-org` (`platform.manage`)
