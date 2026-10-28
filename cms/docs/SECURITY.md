# Security notes

Implemented and tested
* Passwords hashed with scrypt; minimum length and complexity enforced; accounts lock for 15 minutes after 5 failures; login is rate limited per IP and per email; unknown users and wrong passwords give the same message and similar timing.
* Server-side sessions (random 256-bit token, only its hash stored), 12-hour maximum and 2-hour idle limits, HttpOnly + SameSite=Lax cookies (`Secure` when `APP_URL` is https). Deactivating a user or changing their role ends their sessions immediately. Changing a password ends other sessions.
* Authorization in the service layer for every operation; row-level visibility; other tenants and other people's complaints return 404. Custom roles; the approval and closing gates cannot be switched off.
* CSRF: same-origin check on every state-changing API request plus SameSite cookies.
* Input validation with zod (API) and explicit checks (services); parameterised SQL everywhere; React escapes output; downloads are served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`; CSV exports neutralise spreadsheet formulas.
* Uploads: type decided from file contents (not name), allow-list, 10 MB limit, 25 files per complaint, random private storage names outside any web root, permission-checked downloads, every staff download audited.
* Public portal: unguessable access code (60 bits, hashed), rate limits, uniform errors, signed 10-minute download links, honeypot field against bots.
* Audit log: append-only, hash-chained, verified on the Audit page; never stores passwords, tokens or complaint text.
* Security headers (nosniff, frame deny, referrer, permissions policy).
* Data retention: complainant personal data removed after the organization's retention period.

Not implemented (see LIMITATIONS.md)
* Multi-factor authentication, single sign-on, malware scanning of uploads, encryption at rest by the app, per-field encryption, external secrets manager, content-security-policy for pages, external penetration test.
* No claim is made of compliance with GDPR, HIPAA, ISO 27001 or any other standard. Those need a review of your processes, not only the software.

Reporting a problem: treat any bypass of permission checks as a critical bug and fix it before release.
