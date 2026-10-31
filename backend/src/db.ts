import fs from "fs";
import { Pool } from "pg";
import type { PoolConfig } from "pg";

const configFile = process.env.DATABASE_CONFIG_FILE;
let poolConfig: PoolConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "appdb",
  user: process.env.DB_USER || "appuser",
  password: process.env.DB_PASSWORD || "",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

if (configFile && fs.existsSync(configFile)) {
  const loaded = JSON.parse(fs.readFileSync(configFile, "utf8"));
  poolConfig = { ...poolConfig, ...loaded };
}

export const pool = new Pool(poolConfig);

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM — shutting down.");
  await pool.end();
  process.exit(0);
});

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[db] ${text.slice(0, 80)}... ${duration}ms`);
  }
  return res;
}

export function escapeParam(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}
