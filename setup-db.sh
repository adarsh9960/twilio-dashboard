#!/bin/bash
# Set up PostgreSQL database for ITZ Twilio Control Center on the server.
# Target: itzvpc (Ubuntu) — PostgreSQL 16, database appdb
set -euo pipefail

SSH_HOST="instatool"
SSH_USER="ubuntu"

run_ssh() {
  timeout 120 ssh -o BatchMode=yes "$SSH_HOST" "sudo -n $@"
}

echo "=== 1. Create PostgreSQL role and database ==="
run_ssh "sudo -u postgres psql -c \"SELECT 1 FROM pg_roles WHERE rolname='appuser';\"" 2>/dev/null | grep -q "1" || \
  run_ssh "sudo -u postgres createuser -s appuser" || true

run_ssh "sudo -u postgres createdb -O appuser -E UTF8 appdb" 2>/dev/null || true

echo "=== 2. Set secure permissions on .env (create if missing) ==="
run_ssh "mkdir -p ~/.itz-twilio-dashboard"
run_ssh "cat > ~/.itz-twilio-dashboard/.env <<'ENV_EOF'
# ITZ Twilio Control Center — server-side secrets
# Copy from .env.example and fill real values.
# chmod 600 ~/.itz-twilio-dashboard/.env

# ─── App ─────────────────────────────────────────────────────────────────
APP_URL=https://dashboard.instatool.in
NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@itzadarsh.co.in
ADMIN_INITIAL_PASSWORD=$(openssl rand -base64 32)

# ─── Database ────────────────────────────────────────────────────────────
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=appdb
DB_USER=appuser
DB_PASSWORD=$(openssl rand -base64 32)

# ─── Twilio ──────────────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15005550006
TWILIO_AUTH_TOKEN=your_auth_token_here

# ─── Cloudflare Turnstile ─────────────────────────────────────────────────
CLOUDFLARE_TURNSTILE_SITE_KEY=0x4AAAAAAA
CLOUDFLARE_TURNSTILE_SECRET_KEY=

# ─── Storage ─────────────────────────────────────────────────────────────
UPLOAD_DIR=/home/ubuntu/itz-twilio-dashboard/uploads
RECORDINGS_BASE_URL=/recordings
ENV_EOF"
run_ssh "chmod 600 ~/.itz-twilio-dashboard/.env"
echo "  .env created with secure permissions (600)."

echo "=== 3. Run database migration ==="
run_ssh "sudo -u postgres psql -d appdb -f /home/ubuntu/itz-twilio-dashboard/database/migrations/001_initial_schema.sql" 2>&1 | head -20 || true

echo ""
echo "=== 4. Verify ==="
run_ssh "sudo -u postgres psql -d appdb -c '\dt' 2>&1 | head -20"
run_ssh "sudo -u postgres psql -d appdb -c '\dn' 2>&1" 2>&1
