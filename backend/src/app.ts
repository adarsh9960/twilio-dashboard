import express, { type Express, type Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { env } from "./config.ts";
import { query, pool } from "./db.ts";
import { securityHeaders } from "./middleware.ts";
import loginRouter from "./routes/auth.ts";
import twilioRouter from "./routes/twilio.ts";
import type { AdminUserWithId } from "./types.ts";

// ─── Express app factory ────────────────────────────────────────────────────
export function createApp(): Express {
  const app = express();

  // Body parsers
  app.use(express.json({ limit: env.requestBodyLimit, type: ["application/json"] }));
  app.use(express.urlencoded({ extended: true, limit: env.requestBodyLimit, type: ["application/x-www-form-urlencoded"] }));

  // Security headers
  app.use(securityHeaders);

  // CORS (supports browser + server-to-server)
  app.use((req, res, next) => {
    const origin = req.headers.origin as string;
    const allowed = env.corsOrigins;
    if (!origin || allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-CSRF-Token,X-Twilio-Webhook-Id,Twilio-Signature");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Health / readiness
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), nodeEnv: env.nodeEnv });
  });
  app.get("/ready", async (_req, res) => {
    let dbOk = false;
    try { await query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
    res.json({ status: dbOk ? "ready" : "down", database: dbOk ? "ok" : "down" });
  });

  // ── Rate limiters ────────────────────────────────────────────────────────
  const apiGlobalLimiter = rateLimit({
    windowMs: env.rateLimitWindowSeconds * 1000,
    max: env.rateLimitMaxRequests,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later.", code: "RATE_LIMITED" },
  });

  const apiNamespaceLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  // ── Logger ────────────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    const origSend = res.send.bind(res);
    (res as any).send = function (body: any) {
      const ms = Date.now() - start;
      const status = res.statusCode;
      console.log(`[http] ${req.method} ${req.originalUrl} ${status} ${ms}ms ${JSON.stringify(body ?? "")}`);
      return origSend(body);
    };
    next();
  });

  // ── Auth routes ──────────────────────────────────────────────────────────
  app.use("/", loginRouter);

  // ── API namespace ─────────────────────────────────────────────────────────
  app.use("/api", apiGlobalLimiter);

  app.use("/api/twilio", apiNamespaceLimiter, twilioRouter);

  // ── Admin routes (placeholder mount; full pages in frontend) ──────────────
  app.use("/admin", (_req, res) => {
    res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
  });

  // ── 404 handler ──────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
  });

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || 500;
    const message = status >= 500 ? "Internal server error." : err?.message || "Something went wrong.";
    const code = err?.code || "INTERNAL_ERROR";
    console.error(`[error] ${message}`, err?.stack);
    res.status(status).json({ error: message, code });
  });

  return app;
}

// ─── Start server ───────────────────────────────────────────────────────────
export function startServer(port: number, host: string = "127.0.0.1") {
  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`[server] HTTP listening on ${host}:${port}  (NODE_ENV=${env.nodeEnv})`);
  });

  process.on("SIGTERM", async () => {
    console.log("[server] SIGTERM received — shutting down gracefully.");
    server.close(() => {
      console.log("[server] HTTP server closed.");
      pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
    });
    setTimeout(() => {
      console.error("[server] Forcefully terminating.");
      process.exit(1);
    }, 10000).unref();
  });

  return server;
}
