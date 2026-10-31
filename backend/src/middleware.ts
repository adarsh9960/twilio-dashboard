// Security & auth middleware.

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import argon2 from "argon2";
import { pool, query } from "./db.ts";
import { env } from "./config.ts";
import { AppError } from "./types.ts";

// ─── Client IP ────────────────────────────────────────────────────────────
export function getClientIp(req: Request): string {
  let ip = req.headers["x-forwarded-for"] as string | undefined;
  if (ip) ip = ip.split(",")[0]!.trim();
  else ip = req.headers["x-real-ip"] as string | undefined;
  if (!ip) ip = (req.connection?.remoteAddress || req.socket?.remoteAddress || "unknown");
  return (ip as string).replace(/^::ffff:/, "") || "unknown";
}

// ─── Session store (Postgres) ────────────────────────────────────────────────
const SESSIONS_TABLE = "admin_sessions";

export async function createSession(adminId: string, token: string, ipAddress: string, userAgent: string, loginSource: string) {
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO ${SESSIONS_TABLE} (admin_id, session_token, ip_address, user_agent, login_source, expires_at, revoked)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
    [adminId, token, ipAddress, userAgent || null, loginSource, expiresAt]
  );
  return { token, expiresAt };
}

export async function getSession(token: string) {
  const res = await pool.query(
    `SELECT s.*, a.email, a.display_name, a.role, a.totp_enabled
     FROM ${SESSIONS_TABLE} s JOIN admin_users a ON a.id = s.admin_id
     WHERE s.session_token = $1 AND s.revoked = FALSE`, [token]
  );
  return res.rows[0] || null;
}

export async function revokeSession(token: string) {
  await pool.query(`UPDATE ${SESSIONS_TABLE} SET revoked = TRUE, last_activity_at = NOW() WHERE session_token = $1`, [token]);
}

export async function updateSessionLastActivity(token: string) {
  await pool.query(`UPDATE ${SESSIONS_TABLE} SET last_activity_at = NOW() WHERE session_token = $1`, [token]);
}

// ─── Login rate limiting (in-memory) ────────────────────────────────────────
const loginBuckets = new Map<string, { count: number; windowStart: number }>();

export function isLoginAllowed(email: string, ip: string): boolean {
  const now = Date.now();
  const windowMs = env.loginAttemptWindowSeconds * 1000;
  const key = email.toLowerCase();
  const existing = loginBuckets.get(key);
  if (existing && now - existing.windowStart < windowMs) {
    return existing.count < env.maxLoginAttempts;
  }
  // Cleanup
  loginBuckets.forEach((v, k) => {
    if (now - v.windowStart >= windowMs) loginBuckets.delete(k);
  });
  return true;
}

export function recordLoginAttempt(email: string, ip: string, success: boolean, reason: string) {
  const key = email.toLowerCase();
  const existing = loginBuckets.get(key) || { count: 0, windowStart: Date.now() };
  if (Date.now() - existing.windowStart >= env.loginAttemptWindowSeconds * 1000) {
    existing.count = 0;
    existing.windowStart = Date.now();
  }
  existing.count++;
  loginBuckets.set(key, existing);
}

// ─── Auth helpers ────────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 1 << 16, timeCost: 3, parallelism: 4 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(password, hash);
}

export function secureRandomToken(len = 32) {
  return crypto.randomBytes(len).toString("base64url");
}

// ─── CSRF (double-submit via cookies) ────────────────────────────────────────
export const SESSION_COOKIE = "itz_twilio_session";
export const CSRF_COOKIE = "itz_twilio_csrf";

export function setCsrfTokens(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: env.nodeEnv === "production",
    maxAge: 14 * 24 * 60 * 60 * 1000, path: "/",
  });
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, sameSite: "lax", secure: env.nodeEnv === "production",
    maxAge: 14 * 24 * 60 * 60 * 1000, path: "/",
  });
}

export function getCsrfToken(req: Request): string {
  return (req as any).session?.session_token || req.cookies?.[SESSION_COOKIE] || crypto.randomUUID();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const method = req.method || "GET";
  if (["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) return next();

  const sessionToken = (req as any).session?.session_token || req.cookies?.[SESSION_COOKIE];
  const headerToken = req.headers["x-csrf-token"] as string | undefined;
  const bodyToken = req.body?._csrf;

  if (req.headers["content-type"]?.includes("application/json")) {
    if (!headerToken) return next(new AppError("CSRF token missing.", "CSRF_MISSING", 403));
    if (!secureEqual(headerToken, sessionToken)) return next(new AppError("CSRF token mismatch.", "CSRF_INVALID", 403));
  } else {
    const tokenToCheck = headerToken || bodyToken;
    if (!tokenToCheck) return next(new AppError("CSRF token missing.", "CSRF_MISSING", 403));
    if (!secureEqual(tokenToCheck, sessionToken)) return next(new AppError("CSRF token mismatch.", "CSRF_INVALID", 403));
  }
  next();
}

function secureEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Session validation (must be called BEFORE body parsing for routes that need CSRF) ─
export async function validateSession(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
  if (!token) return next(new AppError("No session token provided.", "AUTHENTICATION_ERROR", 401));

  const session = await getSession(token);
  if (!session) {
    return next(new AppError("Session invalid.", "AUTHENTICATION_ERROR", 401));
  }

  // Refresh if expired
  if (Date.now() > new Date(session.expires_at).getTime()) {
    await revokeSession(token);
    return next(new AppError("Session expired.", "AUTHENTICATION_ERROR", 401));
  }

  (req as any).adminUser = { id: session.admin_id, email: session.email, role: session.role };
  (req as any).session = session;
  await updateSessionLastActivity(token);
  next();
}

// ─── Security headers ────────────────────────────────────────────────────────
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (env.nodeEnv === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
}

// ─── Path traversal protection ────────────────────────────────────────────────
export function safeResolve(baseDir: string, relativePath: string): string {
  const resolved = path.resolve(baseDir, "..", path.normalize(relativePath));
  if (!resolved.startsWith(path.resolve(baseDir, ".."))) {
    throw new AppError("Access denied.", "PATH_TRAVERSAL", 403);
  }
  return resolved;
}
