#!/usr/bin/env python3
"""Server-side helper: generates .env for the twilio-dashboard backend."""
import os
import secrets
import sys

ADMIN_PASSWORD = "rjpivifkre4lngh5ai22xr6n6l5jdizl"

def main():
    db_password = secrets.token_urlsafe(18)
    session_secret = secrets.token_urlsafe(24)

    lines = [
        "# ITZ Twilio Control Center - server .env (PRODUCTION)",
        "# Server-side secrets. Never commit. chmod 600",
        "",
        "# App",
        "APP_URL=https://dashboard.instatool.in",
        "NODE_ENV=production",
        "SESSION_SECRET=" + session_secret,
        "ADMIN_EMAIL=admin@itzadarsh.co.in",
        "ADMIN_INITIAL_PASSWORD=" + ADMIN_PASSWORD,
        "",
        "# Database (PostgreSQL appdb)",
        "DB_HOST=127.0.0.1",
        "DB_PORT=5432",
        "DB_NAME=appdb",
        "DB_USER=appuser",
        "DB_PASSWORD=" + db_password,
        "",
        "# Twilio (configured after approval)",
        "TWILIO_ACCOUNT_SID=CHANGE_ME",
        "TWILIO_AUTH_TOKEN=CHANGE_ME",
        "TWILIO_API_KEY=CHANGE_ME",
        "TWILIO_API_SECRET=CHANGE_ME",
        "TWILIO_TWIML_APP_SID=CHANGE_ME",
        "TWILIO_PHONE_NUMBER=CHANGE_ME",
        "",
        "# Cloudflare Turnstile (optional)",
        "CLOUDFLARE_TURNSTILE_SITE_KEY=CHANGE_ME",
        "CLOUDFLARE_TURNSTILE_SECRET_KEY=CHANGE_ME",
        "",
        "# Storage",
        "UPLOAD_DIR=/home/ubuntu/itz-twilio-dashboard/uploads",
        "RECORDINGS_BASE_URL=/recordings",
    ]
    content = "\n".join(lines) + "\n"
    with open("/home/ubuntu/.itz-twilio-dashboard/.env", "w") as f:
        f.write(content)
    os.chmod("/home/ubuntu/.itz-twilio-dashboard/.env", 0o600)
    print("Wrote /home/ubuntu/.itz-twilio-dashboard/.env")
    print("DB_PASSWORD: " + db_password)
    print("SESSION_SECRET: " + session_secret)
    print("ADMIN_PASSWORD: [seeded, not printed]")

if __name__ == "__main__":
    main()
