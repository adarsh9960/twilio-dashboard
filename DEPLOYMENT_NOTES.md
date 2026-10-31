# ITZ Twilio Control Center — Deployment Decisions (as of 30 Oct 2026)

## Server facts (verified by SSH into `instatool`)
- Hostname: mail.instatool.in / ubuntu@130.210.42.95 (ssh via `instatool` alias, IdentityFile ~/.ssh/ubuntu20_oci)
- OS: Ubuntu 24.04, Node NOT installed, PostgreSQL 16 installed (1 DB: `appdb` owned by `appuser`)
- Web server: Apache 2.4 + PHP 8.3, serving `instatool.in` from /home/ubuntu/instatool-landing
- Public IP: 42.104.217.76
- Installed: git, curl, python3, psql, sqlite3, dig/nslookup whois (network tools), no nginx installed (Apache only)
- RAM: 954MB total / ~160MB available — light workload, single Node process OK
- PM2 NOT installed; Docker NOT installed. Use `nohup`/systemd-style Node process.
- docs.instatool.in and container.instatool.in do NOT resolve — avoid touching.

## DNS facts (verified by dig/dns)
- instatool.in A -> 172.67.180.181 (Cloudflare proxy, NS harlee/johnathan.ns.cloudflare.com)
- dashboard.instatool.in A = NOT RESOLVING (no A record) -> REQUIRED to be added
- dashboard.itzadarsh.co.in A -> 104.21.15.178 / 172.67.163.151 (Cloudflare)
- domaiN decision: public DNS gap -> add A record dashboard.instatool.in -> 42.104.217.76, with user approval

## Deployment plan (contingency)
- If user can't edit DNS: deploy the app as a standalone Node service + PORT on the
  existing server (any port), leave DNS pending, and document the exact steps.

## Local machine facts (verified on Kali)
- Node v24.21.0, npm 12.0.2, python3 3.14.8, git, ssh/scp, curl available
- Chrome browser running (Chrome/156.0.8078.73, Xorg DISPLAY=:0.0)
- computer_use skill loaded; browser_exec backend NOT running (CDP refused)
- No existing twilio-dashboard repo anywhere; must create fresh
- git://github.com not reachable? (to verify)

## Project structure (dedicated folder, server-side)
server side: /opt/twilio-dashboard (or existing instatool project dir per project brief)
  - backend/  (Node + Express + TypeScript)
  - frontend/ (Bootstrap 5 + TS)
  - shared/   (types + config constants)
  - database/ (SQL migrations)
  - docs/     (INSTALLATION, TWILIO_SETUP, WEBHOOK_CONFIGURATION, SECURITY, DEPLOYMENT, TROUBLESHOOTING, MOBILE_CALLING)
  - scripts/  (setup db, seed admin, rotate tokens)
  - tests/
  - .env.example / .gitignore / README.md / docker-compose.yml

## Authentication (server enforced)
- Argon2id password hashing (scrypt is fine as fallback on Node 24)
- HTTP-only secure session cookies; server-side session store in Postgres
- CSRF double-submit token; rate limiting on login (per IP + account); TOTP optional
- Audit logs table; login attempt tracking
- Admin: admin@itzadarsh.co.in

## Twilio integration (Twilio Node 5.x SDK)
- Access tokens from API Key (sid + secret), correct TWIML app sid, identity = admin email
- Webhooks signed with official Twilio RequestValidator (endpoint exact HTTPS URL)
- Twiml app: voice url = https://dashboard.instatool.in/api/twilio/voice
- Status callback: https://dashboard.instatool.in/api/twilio/status
- Recording status: https://dashboard.instatool.in/api/twilio/recording-status
- Incoming: https://dashboard.instatool.in/api/twilio/incoming
- DO NOT buy numbers / upgrade / charge money without explicit approval
- Account state to read from Twilio REST (balance, phone numbers, usage, calls)

## Call restriction engine (server-side, enforced)
- Per-account country allowlist; destination validation against allowlist
- Max call duration, per-day spend cap, concurrent call cap
- Emergency kill switch (app_settings flag), admin confirmation for config changes
- Suspicious-call telemetry (same destination burst, etc.)
- Frontend-only restrictions are explicitly insufficient.

## Security headers & hardening
- CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- Request size limits; API rate limits (per IP)
- Secret file: .env with 0600; NOT in git; excluded from shared git
- Do NOT store Twilio Auth Token in DB; only API key sid/secret (or env)
- Use PostgreSQL appdb for admin_sessions, audit_logs, twilio_accounts,
  phone_numbers, calls, call_events, call_recordings, webhook_events, app_settings

## Testing (real, executed)
1. Admin login (successful + failed attempts)
2. Unauthorized page access (401)
3. Logout
4. Twilio API connection (balance fetch)
5. Balance / numbers / calls / usage / account reads
6. Voice token + mute/unmute/DTMF
7. Outbound test call (approved test number ONLY — no charge without approval)
8. Ringing/answered/completed/no-answer/busy statuses
9. Webhook signature validation (signature round-trip)
10. WebSocket/SSE reconnection after disconnect
11. Server restart recovery (env var + DB restore)
12. Mobile browser + Bluetooth headset selection (where supported)

## Final deliverable
PRODUCTION URL: https://dashboard.instatool.in (once DNS + HTTPS configured)
Git repo location: local only (no push until user approves)
Server deployment directory: /opt/twilio-dashboard (subject to user approval)
Backup & recovery: pg_dump of appdb + .env stash; documented.
