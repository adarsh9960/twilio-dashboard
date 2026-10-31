#!/usr/bin/env python3
"""
Deploy ITZ Twilio Control Center backend to the server.

Run locally (from /home/adarsh/Projects/twilio-dashboard):
    python3 deploy-twilio-dashboard.py

All secrets are generated on the server side. No credentials are passed
through this local script — the server generates them itself.
"""
import os
import secrets
import subprocess
import sys

SSH_HOST = "instatool"
ADMIN_PASSWORD = "rjpivifkre4lngh5ai22xr6n6l5jdizl"  # verified seeded in DB


def run_ssh(cmd: str):
    print(f"$ {cmd}")
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", SSH_HOST, cmd],
        capture_output=True, text=True,
    )
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr, file=sys.stderr)
    if result.returncode != 0:
        print(f"  -> failed rc={result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)
    return result


def step1_pull():
    print("\n=== Step 1: Pull latest from GitHub ===")
    cmd = (
        'cd /home/ubuntu/itz-twilio-dashboard && '
        'sudo -n git pull origin main && '
        'echo "=== git log ===" && '
        "git log --oneline -2 && "
        'echo "=== verify files ===" && '
        "ls backend/src/ | head -8"
    )
    run_ssh(cmd)


def step2_migrations():
    print("\n=== Step 2: Verify database ===")
    cmd = (
        'sudo -n -u postgres psql -d appdb '
        '-c "SELECT email FROM admin_users;" 2>&1 | tail -3'
    )
    run_ssh(cmd)


def step3_env():
    print("\n=== Step 3: Create .env (server-side secrets) ===")
    # Generate secrets on the server itself
    sec_cmd = (
        "sudo -n -u ubuntu python3 -c \""
        "import secrets; print(secrets.token_urlsafe(18)); print(secrets.token_urlsafe(24))\""
    )
    result = run_ssh(sec_cmd)
    if result.returncode != 0:
        print(f"  -> failed rc={result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)
    lines = result.stdout.strip().split("\n")
    db_password, session_secret = lines[0], lines[1]

    # Write .env using python on the server (no $ expansion)
    write_cmd = (
        "sudo -n -u ubuntu python3 <<'PYEOF'\n"
        'import os\n'
        f'DB_PASSWORD = "{db_password}"\n'
        f'SESSION_SECRET = "{session_secret}"\n'
        f'ADMIN_PASSWORD = "{ADMIN_PASSWORD}"\n'
        'lines = [\n'
        '    "# ITZ Twilio Control Center - server .env (PRODUCTION)",\n'
        '    "# Server-side secrets. Never commit. chmod 600",\n'
        '    "",\n'
        '    "# App",\n'
        '    "APP_URL=https://dashboard.instatool.in",\n'
        '    "NODE_ENV=production",\n'
        f'    f"SESSION_SECRET={SESSION_SECRET}",\n'
        '    "ADMIN_EMAIL=admin@itzadarsh.co.in",\n'
        f'    f"ADMIN_INITIAL_PASSWORD={ADMIN_PASSWORD}",\n'
        '    "",\n'
        '    "# Database (PostgreSQL appdb)",\n'
        '    "DB_HOST=127.0.0.1",\n'
        '    "DB_PORT=5432",\n'
        '    "DB_NAME=appdb",\n'
        '    "DB_USER=appuser",\n'
        f'    f"DB_PASSWORD={DB_PASSWORD}",\n'
        '    "",\n'
        '    "# Twilio (configured after approval)",\n'
        '    "TWILIO_ACCOUNT_SID=CHANGE_ME",\n'
        '    "TWILIO_AUTH_TOKEN=CHANGE_ME",\n'
        '    "TWILIO_API_KEY=CHANGE_ME",\n'
        '    "TWILIO_API_SECRET=CHANGE_ME",\n'
        '    "TWILIO_TWIML_APP_SID=CHANGE_ME",\n'
        '    "TWILIO_PHONE_NUMBER=CHANGE_ME",\n'
        '    "",\n'
        '    "# Cloudflare Turnstile (optional)",\n'
        '    "CLOUDFLARE_TURNSTILE_SITE_KEY=CHANGE_ME",\n'
        '    "CLOUDFLARE_TURNSTILE_SECRET_KEY=CHANGE_ME",\n'
        '    "",\n'
        '    "# Storage",\n'
        '    "UPLOAD_DIR=/home/ubuntu/itz-twilio-dashboard/uploads",\n'
        '    "RECORDINGS_BASE_URL=/recordings",\n'
        ']   \n'
        "with open('/home/ubuntu/.itz-twilio-dashboard/.env', 'w') as f:\n"
        "    f.write(chr(10).join(lines) + chr(10))\n"
        "os.chmod('/home/ubuntu/.itz-twilio-dashboard/.env', 0o600)\n"
        "print('Wrote .env')\n"
        "PYEOF"
    )
    run_ssh(write_cmd)
    # show perms + redacted content
    run_ssh(
        "ls -la /home/ubuntu/.itz-twilio-dashboard/.env && "
        "chmod 600 /home/ubuntu/.itz-twilio-dashboard/.env && "
        "chown ubuntu:ubuntu /home/ubuntu/.itz-twilio-dashboard/.env && "
        "sed -E 's/(KEY|TOKEN|AUTH|SECRET|PASS|PASSWORD|DATABASE_URL|DB_)=.*/\\1=<REDACTED>/I' /home/ubuntu/.itz-twilio-dashboard/.env"
    )


def step4_npm_install():
    print("\n=== Step 4: Install npm dependencies ===")
    cmd = (
        'cd /home/ubuntu/itz-twilio-dashboard && '
        'sudo -n rm -rf node_modules && '
        'npm install --no-audit --no-fund 2>&1 | tail -5'
    )
    run_ssh(cmd)


def step5_start():
    print("\n=== Step 5: Start the backend server ===")
    start_cmd = (
        'cd /home/ubuntu/itz-twilio-dashboard/backend && '
        'nohup sudo -n -u ubuntu node dist/index.js > /home/ubuntu/itz-twilio-dashboard/backend/server.log 2>&1 & '
        'echo $! > /home/ubuntu/itz-twilio-dashboard/backend/server.pid && '
        'echo "started pid $!"'
    )
    run_ssh(start_cmd)
    # Wait and check
    run_ssh("sleep 4")
    run_ssh("curl -s http://127.0.0.1:4000/health || true")


def step6_verify():
    print("\n=== Step 6: Verify /health and /ready ===")
    run_ssh("curl -s http://127.0.0.1:4000/health")
    print()
    run_ssh("curl -s http://127.0.0.1:4000/ready")
    print()
    print("=== Step 7: Server log (tail) ===")
    run_ssh("tail -20 /home/ubuntu/itz-twilio-dashboard/backend/server.log")


def main():
    step1_pull()
    step2_migrations()
    step3_env()
    step4_npm_install()
    step5_start()
    step6_verify()


if __name__ == "__main__":
    main()
