# Deployment, backup and recovery

Requirements: Node.js 22+, a writable folder for the database and uploaded files, HTTPS in front of the app for real use.

## 1. First install
```bash
cd cms
npm ci
cp .env.example .env            # then edit: set SESSION_SECRET (openssl rand -hex 32) and APP_URL (your https address)
npm run build
npm run create-admin -- --org "Your Company" --email you@company.com --name "Your Name" --password "A-Str0ng-Password" --timezone Asia/Karachi
npm start                       # web server on port 3000
npm run worker                  # SECOND process: SLA checks, escalations, email delivery
```
The first administrator is a platform administrator. Then sign in, open **Settings** and set the business hours, holidays, categories and SLA targets, add departments and team members, and give people the public link `https://your-address/submit`.

`npm run seed:demo` creates a separate, clearly labelled *Demo Organization (sample data)* with example people and complaints (password printed by the script). Do not use it in production.

## 2. Keep both processes running
Use any process manager. Example systemd units:
```ini
# /etc/systemd/system/cms-web.service
[Service] WorkingDirectory=/opt/cms/cms  EnvironmentFile=/opt/cms/cms/.env  ExecStart=/usr/bin/npm start  Restart=always  User=cms
# /etc/systemd/system/cms-worker.service
[Service] WorkingDirectory=/opt/cms/cms  EnvironmentFile=/opt/cms/cms/.env  ExecStart=/usr/bin/npm run worker  Restart=always  User=cms
```
Or `docker compose up -d --build` (see `docker-compose.yml`; written but untested in the development environment).
**If the worker is not running, no SLA escalations or emails are produced.** Monitor it: its log line `[worker] ... checked=N escalations=N mail_sent=N` appears every minute.

## 3. HTTPS and proxy
Put nginx, Caddy or a cloud load balancer in front, terminate TLS, and forward `X-Forwarded-For`. Set `APP_URL=https://…` so session cookies are marked `Secure`. Do not expose port 3000 directly.

## 4. Environment variables
See `.env.example`. Required: `SESSION_SECRET`, `APP_URL`. Optional: `SMTP_*`/`MAIL_FROM` (without them emails are only logged), `DATABASE_PATH`, `STORAGE_DIR`.

## 5. Backups
* Database: `npm run backup -- /path/to/backups` writes a consistent copy while the app runs and **verifies** it (SQLite integrity check + audit-chain check). Schedule it (cron) at least daily.
* Attachments: copy the `STORAGE_DIR` folder with the same schedule.
* Keep backups off the server, encrypted, and test a restore regularly.

## 6. Restore
1. Stop the web and worker processes.
2. Copy the backup file over `DATABASE_PATH` (and delete any `*-wal` / `*-shm` files next to it); restore the attachments folder.
3. Start the web process (migrations apply automatically) and the worker. Check `/api/health` and the `/audit` integrity banner.
A restore of a backup taken by `npm run backup` is covered by an automated test.

## 7. Upgrading
Back up, pull the new code, `npm ci && npm run build`, restart both processes. Migrations are applied at start-up in order and recorded in `schema_migrations`.

## 8. Encryption
Encryption in transit comes from HTTPS. Encryption at rest is **not** provided by the application: use an encrypted disk/volume (LUKS, BitLocker, cloud volume encryption) for the database and attachments folder.
