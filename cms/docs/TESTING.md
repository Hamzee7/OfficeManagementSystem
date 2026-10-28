# Testing

```bash
npm run typecheck      # TypeScript
npm test               # unit + integration tests (Vitest, in-memory SQLite)
npm run build && npm run test:e2e   # real browser journey (Playwright, real server and database)
```
`npm run test:e2e` needs Chromium. Install with `npx playwright install chromium`, or point `PW_CHROMIUM` at an existing Chromium binary.

What is covered
* **Calendar & SLA** (`tests/calendar-sla.test.ts`): working hours, weekends, holidays, time zones, a daylight-saving transition, pause/resume, at-risk/breached/completed.
* **Lifecycle & access** (`tests/lifecycle.test.ts`): full submit → assign → investigate → propose → approve → resolve → close with history; invalid transitions; mandatory comments; optimistic concurrency; SLA pause on "Awaiting Complainant"; escalation once only; sensitive routing; reopen and repeated-reopen escalation; portal privacy (no internal notes, no unapproved resolution, no staff names); rate-limited guessing; anonymity; feedback once; handlers see only their own; cross-organization isolation; auditors read-only; complainants see only theirs; conflict-of-interest.
* **Platform** (`tests/platform.test.ts`): audit tamper detection and append-only triggers; no passwords in logs; lockout, session expiry, deactivation; user/role administration and privilege-escalation limits; workflow protections; upload validation and visibility; email retries, back-off and duplicate prevention; KPI definitions with known data; report permissions; CSV PII and formula injection; data retention; AI only suggests and respects the organization switch; **20,000-complaint scale test** (list ≈ 0.1 s, search ≈ 0.03 s, dashboard ≈ 0.6 s); verified backup and restore.
* **End-to-end** (`tests/e2e/journey.mjs`, 10 steps, also visits every page as admin, manager, handler and auditor and exercises the configuration forms): a complainant files a complaint in the browser (consent enforced), tracks it (wrong code refused), a manager notes and messages, the assigned handler investigates and proposes (cannot approve), another manager approves, the complainant sees the outcome without internal text and leaves feedback, unauthorized/cross-site requests are refused, reports and audit integrity render.

Not tested automatically: real SMTP delivery, SMS, Docker image build, behaviour under PostgreSQL (not supported yet), accessibility with real screen readers (keyboard and semantics were built in; an assistive-technology audit is still needed), load from many simultaneous users.

* **Two-step sign-in and branding** (`tests/mfa-theme.test.ts` and the last three e2e steps): TOTP official vectors, drift and replay, recovery codes single-use and regenerable, lockout, challenge expiry, admin reset, organization requirement and self-lockout guard, readable button/link colours for any brand colour, logo and colours on public and staff pages.

Current results when this was written: 66 unit/integration tests passing, 13 end-to-end steps passing, TypeScript clean, production build succeeds, axe-core (WCAG 2.0/2.1/2.2 A and AA rules) reported no violations on the 20 pages scanned. Automated checks find only part of the accessibility problems; manual keyboard and screen-reader testing is still required.
