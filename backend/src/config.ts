import "dotenv/config";
import path from "node:path";

export const rootDir = path.resolve(import.meta.dirname, "..");

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  appUrl: process.env.APP_URL || "https://dashboard.instatool.in",
  dbHost: process.env.DB_HOST || "127.0.0.1",
  dbPort: Number(process.env.DB_PORT || 5432),
  dbName: process.env.DB_NAME || "appdb",
  dbUser: process.env.DB_USER || "appuser",
  dbPassword: process.env.DB_PASSWORD || "",
  databaseConfigFile: process.env.DATABASE_CONFIG_FILE,
  adminEmail: process.env.ADMIN_EMAIL || "admin@itzadarsh.co.in",
  adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioApiKey: process.env.TWILIO_API_KEY || "",
  twilioApiSecret: process.env.TWILIO_API_SECRET || "",
  twimlAppSid: process.env.TWILIO_TWIML_APP_SID || "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
  turnstileSiteKey: process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || "",
  turnstileSecretKey: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || "",
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "1mb",
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
  loginAttemptWindowSeconds: Number(process.env.LOGIN_ATTEMPT_WINDOW_SECONDS || 900),
  rateLimitWindowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60),
  corsOrigins: (process.env.CORS_ORIGINS || "https://dashboard.instatool.in")
    .split(",").map((s) => s.trim()).filter(Boolean),
  corsCredentials: process.env.CORS_CREDENTIALS !== "false",
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, "..", "uploads"),
  recordingsBaseUrl: process.env.RECORDINGS_BASE_URL || "/recordings",
} as const;

const requiredEnv = [
  "APP_URL", "SESSION_SECRET", "ADMIN_EMAIL",
  "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
  "TWILIO_ACCOUNT_SID", "TWILIO_API_KEY", "TWILIO_API_SECRET", "TWILIO_TWIML_APP_SID"
];

const missing = requiredEnv.filter((v) => !env[v as keyof typeof env]);
if (missing.length > 0) {
  console.warn(`[config] WARN: Missing env vars: ${missing.join(", ")}`);
  if (env.nodeEnv === "production") {
    console.error("[config] ERROR: missing required env var(s). See .env.example");
    process.exit(1);
  }
}

for (const k of ["TWILIO_API_KEY", "TWILIO_API_SECRET", "SESSION_SECRET"]) {
  const v = env[k as keyof typeof env];
  if (v === "" || v === "CHANGE_ME") {
    if (env.nodeEnv === "production") {
      console.error(`[config] ERROR: ${k} is empty or a placeholder.`);
      process.exit(1);
    }
    console.warn(`[config] WARN: ${k} empty — app will not function until set.`);
  }
}
