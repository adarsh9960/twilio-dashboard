// Entry point for ITZ Twilio Control Center backend.

import { startServer } from "./app.ts";
import { env } from "./config.ts";

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "127.0.0.1";

console.log(`[server] Starting ITZ Twilio Control Center on ${HOST}:${PORT} (NODE_ENV=${env.nodeEnv})`);

startServer(PORT, HOST).on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${PORT} is already in use. Try a different PORT.`);
  } else {
    console.error("[server] Server error:", err.message);
  }
  process.exit(1);
});
