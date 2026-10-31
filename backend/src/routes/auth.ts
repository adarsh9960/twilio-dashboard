// Admin authentication routes — login, logout, CSRF, session validation.
import { Router } from "express";
import { pool, query } from "../db.ts";
import { env } from "../config.ts";
import { getClientIp, isLoginAllowed, recordLoginAttempt, createSession, getSession, revokeSession, getCsrfToken, setCsrfTokens, csrfProtection, validateSession, hashPassword, verifyPassword } from "../middleware.ts";
import { AppError } from "../types.ts";
import { SESSION_COOKIE, CSRF_COOKIE } from "../middleware.ts";

const router = Router();
const SESSIONS_TABLE = "admin_sessions";
const ATTEMPTS_TABLE = "login_attempts";

// ─── GET /login ──────────────────────────────────────────────────────────────
router.get("/login", async (req, res) => {
  const token = getCsrfToken(req);
  res.setHeader("Content-Type", "text/html");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ITZ Twilio Control Center — Sign in</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
<style>
body { background: #0b1120; color: #e2e8f0; }
.card { background: #111827; border: 1px solid #374151; }
.card h1 { color: #10b981; }
.form-control { background: #1f2937; border-color: #374151; color: #e2e8f0; }
.form-control::placeholder { color: #6b7280; }
.error { color: #ef4444; }
.bi { width: 1.2em; }
</style>
</head>
<body>
<div class="container py-5">
  <div class="row justify-content-center">
    <div class="col-md-4">
      <div class="card p-4">
        <h1><i class="bi bi-phone"></i> ITZ Twilio Control Center</h1>
        <p class="text-muted mb-3">Sign in to your dashboard</p>
        <form method="POST" action="/login" id="loginForm">
          <input type="hidden" name="_csrf" value="${token}">
          <div class="mb-3">
            <label class="form-label small text-muted">Email</label>
            <input name="email" class="form-control" type="email" value="admin@itzadarsh.co.in" required autofocus autocomplete="username">
          </div>
          <div class="mb-3">
            <label class="form-label small text-muted">Password</label>
            <input name="password" class="form-control" type="password" autocomplete="current-password" required>
          </div>
          <div class="mb-3" id="captchaRow" style="display:none">
            <div class="g-recaptcha" data-sitekey="${env.turnstileSiteKey}"></div>
          </div>
          <button class="btn btn-success w-100" type="submit">Sign in</button>
        </form>
        <div class="mt-3 text-center small text-muted">First login: change your password on <a href="/settings">Settings</a></div>
      </div>
    </div>
  </div>
</div>
<script src="https://www.google.com/recaptcha/api.ts" async defer></script>
<script>
let ticking = false;
function checkCaptcha() {
  const r = grecaptcha.getResponse();
  if (r) { ticking = false; document.getElementById("loginForm").submit(); }
  else { ticking = true; requestAnimationFrame(checkCaptcha); }
}
if (document.querySelector('.g-recaptcha')) {
  grecaptcha.ready(() => { grecaptcha.execute(); });
}
</script>
</body>
</html>`);
});

// ─── POST /login ─────────────────────────────────────────────────────────────
router.post("/login", async (req, res, next) => {
  try {
    const email = (req.body?.email || "").toLowerCase().trim();
    const password = req.body?.password || "";
    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";

    // Rate limit
    if (!isLoginAllowed(email, ip)) {
      recordLoginAttempt(email, ip, false, "rate_limited");
      return res.status(429).json({ error: "Too many attempts. Try again later.", code: "RATE_LIMITED" });
    }

    const row = await pool.query(
      `SELECT id, email, password_hash, display_name, totp_enabled, role
       FROM admin_users WHERE email = $1`, [email]
    );
    const user = row.rows[0];
    if (!user) {
      recordLoginAttempt(email, ip, false, "invalid_credentials");
      return res.status(401).json({ error: "Invalid email or password.", code: "INVALID_CREDENTIALS" });
    }

    const pwOk = await verifyPassword(password, user.password_hash);
    if (!pwOk) {
      recordLoginAttempt(email, ip, false, "invalid_credentials");
      return res.status(401).json({ error: "Invalid email or password.", code: "INVALID_CREDENTIALS" });
    }

    // TOTP step
    if (user.totp_enabled) {
      const totpToken = req.body?.totp || "";
      if (!totpToken) {
        return res.status(401).json({ error: "Two-factor authentication required.", code: "TOTP_REQUIRED" });
      }
      const valid = await verifyTotp(totpToken, user.id, ip, userAgent);
      if (!valid) {
        recordLoginAttempt(email, ip, false, "invalid_totp");
        return res.status(401).json({ error: "Invalid two-factor code.", code: "INVALID_TOTP" });
      }
    }

    // Session
    const sessionToken = cryptoRandom();
    const session = await createSession(user.id, sessionToken, ip, userAgent, "web");
    await pool.query(`UPDATE admin_users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    setCsrfTokens(res, sessionToken);

    res.json({
      ok: true,
      admin: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
      csrf_token: sessionToken,
      session: { id: sessionToken, expires_at: session.expiresAt },
    });
  } catch (err: any) {
    next(err);
  }
});

// ─── POST /logout ─────────────────────────────────────────────────────────────
router.post("/logout", validateSession, async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE] || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
  if (token) {
    await revokeSession(token);
    await query(`INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address, user_agent)
                 VALUES ($1, 'logout', 'session', NULL, '{"ip":$2}', $3, $4)`,
      [req.adminUser?.id ?? null, ip, req.headers["x-forwarded-for"] || req.ip, req.headers["user-agent"]]);
  }
  res.clearCookie(SESSION_COOKIE);
  res.clearCookie(CSRF_COOKIE);
  res.json({ ok: true });
});

// ─── GET /api/csrf ────────────────────────────────────────────────────────────
router.get("/api/csrf", (req, res) => {
  const token = getCsrfToken(req);
  res.json({ csrf_token: token });
});

// ─── GET /api/session ─────────────────────────────────────────────────────────
router.get("/api/session", validateSession, (req, res) => {
  const u = req.adminUser!;
  res.json({ ok: true, admin: u });
});

// ─── Helper: TOTP ─────────────────────────────────────────────────────────────
import crypto from "node:crypto";
function base32Decode(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bits: number[] = [];
  for (const ch of cleaned) {
    let v: number;
    if (ch >= "A" && ch <= "Z") v = ch.charCodeAt(0) - 65;
    else if (ch >= "2" && ch <= "7") v = ch.charCodeAt(0) - 50;
    else throw new Error(`Invalid base32 char: ${ch}`);
    bits.push(v);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 5 <= bits.length; i += 8) {
    bytes.push((bits[i] << 3) | (bits[i + 1] << 1) | (bits[i + 2] >> 4));
    if (i + 6 < bits.length) bytes.push((bits[i + 2] & 0x0F) << 4 | (bits[i + 3] >> 1));
    if (i + 7 < bits.length) bytes.push((bits[i + 3] & 0x07) << 5 | bits[i + 4] << 2 | (bits[i + 5] >> 3));
    if (i + 8 < bits.length) bytes.push((bits[i + 5] & 0x1F) << 3 | (bits[i + 6] >> 2));
    if (i + 9 < bits.length) bytes.push((bits[i + 6] & 0x03) << 6 | bits[i + 7]);
  }
  return Buffer.from(bytes);
}

async function verifyTotp(code: string, secret: string, window = 1): Promise<boolean> {
  const key = base32Decode(secret);
  const now = Math.floor(Date.now() / 30000);
  for (let offset = -window; offset <= window; offset++) {
    const t = now + offset;
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(t), 0);
    const h = crypto.createHmac("sha1", key).update(buf).digest();
    const off = h[h.length - 1] & 0x0F;
    const codeNum = Number((h.readUInt32BE(off) >> 24) & 0x7FFFFFFF);
    if (String(codeNum).padStart(6, "0") === code.toUpperCase().slice(0, 6)) return true;
  }
  return false;
}

function cryptoRandom(): string {
  return crypto.randomUUID();
}

export default router;
