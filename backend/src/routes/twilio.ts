// Twilio account management routes (balance, numbers, calls, usage, webhooks, connection).
import { Router } from "express";
import twilio from "twilio";
const { Twilio } = twilio;
import { env } from "../config.ts";
import { pool, query } from "../db.ts";
import type { Request, Response } from "express";

const router = Router();

function getClient(): Twilio {
  return new Twilio(config.twilioAccountSid, config.twilioAuthToken);
}

function maskSid(sid: string): string {
  return sid ? sid.slice(0, 16) + "…<redacted>" : "…";
}

// ─── GET /api/twilio/account ───────────────────────────────────────────────────
router.get("/api/twilio/account", async (_req: Request, res: Response) => {
  try {
    const client = getClient();
    await client.api.v2010.fetchAccount();

    const db = await pool.query(
      `SELECT account_sid, account_status, account_type, balance, currency, timezone,
              api_key_sid, twiml_application_sid, twiml_application_url, twiml_status_callback_url,
              webhook_last_synced_at, webhook_validation_status, twilio_api_connection_status,
              last_api_success_at, last_api_error
       FROM twilio_accounts LIMIT 1`
    );
    const row = db.rows[0];
    const data = {
      accountSid: maskSid(row?.account_sid),
      accountStatus: row?.account_status || "never_connected",
      accountType: row?.account_type || null,
      balance: row?.balance ?? null,
      currency: row?.currency || "USD",
      timezone: row?.timezone || null,
      apiKeySid: row?.api_key_sid || null,
      twimlApplicationSid: row?.twiml_application_sid || null,
      twimlApplicationUrl: row?.twiml_application_url || null,
      twimlStatusCallbackUrl: row?.twiml_status_callback_url || null,
      webhookLastSyncedAt: row?.webhook_last_synced_at || null,
      webhookValidationStatus: row?.webhook_validation_status || "not_configured",
      twilioApiConnectionStatus: row?.twilio_api_connection_status || "never_connected",
      lastApiSuccessAt: row?.last_api_success_at || null,
      lastApiError: row?.last_api_error || null,
      lastSyncTime: row?.webhook_last_synced_at ? new Date(row.webhook_last_synced_at).toISOString() : null,
    };
    if (row) {
      await pool.query(
        `UPDATE twilio_accounts SET twilio_api_connection_status = 'connected',
            last_api_success_at = NOW(), webhook_validation_status = 'valid'
         WHERE account_sid = $1`, [row.account_sid]
      );
    }
    res.json({ ok: true, data, hasAuthToken: !!config.twilioAuthToken, hasApiKey: !!config.twilioApiKey });
  } catch (err: any) {
    console.error("[twilio/account]", err);
    res.status(500).json({ ok: false, error: "Failed to read account", details: err?.message });
  }
});

// ─── GET /api/twilio/balance ───────────────────────────────────────────────────
router.get("/api/twilio/balance", async (_req: Request, res: Response) => {
  try {
    const client = getClient();
    const bal = await client.api.v2010.fetchBalance();
    const db = await pool.query(`SELECT balance, currency FROM twilio_accounts LIMIT 1`);
    const row = db.rows[0];
    const data = {
      balance: row?.balance ?? bal.balance,
      currency: row?.currency || bal.currency,
      source: "cached",
      fetchedAt: new Date().toISOString(),
    };
    if (row && bal.balance !== null && bal.balance !== row.balance) {
      await pool.query(
        `UPDATE twilio_accounts SET balance = $1, currency = $2, updated_at = NOW() WHERE account_sid = $3`,
        [bal.balance, bal.currency, row.account_sid]
      );
    }
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "Failed to read balance", details: err?.message });
  }
});

// ─── GET /api/twilio/numbers ───────────────────────────────────────────────────
router.get("/api/twilio/numbers", async (_req: Request, res: Response) => {
  try {
    const client = getClient();
    const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });
    const db = await pool.query(`SELECT phone_number, friendly_number, status_callback_url, status, caller_id_verified, outbound_enabled, label FROM phone_numbers`);
    const rows = db.rows;
    const list = numbers.map((n: any) => {
      const r = rows.find((x: any) => x.phone_number === n.phoneNumber);
      return {
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyNumber: r?.friendly_number || n.phoneNumber,
        country: r?.country || n.country || null,
        capabilities: r?.capabilities || { voice: true, sms: false },
        voiceUrl: r?.voice_url || null,
        voiceFallbackUrl: r?.voice_fallback_url || null,
        statusCallbackUrl: r?.status_callback_url || null,
        status: r?.status || n.status,
        callerIdVerified: r?.caller_id_verified || false,
        outboundEnabled: r?.outbound_enabled || false,
        label: r?.label || null,
        externalUrl: n.url,
      };
    });
    res.json({ ok: true, data: list });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "Failed to read phone numbers", details: err?.message });
  }
});

// ─── GET /api/twilio/calls ─────────────────────────────────────────────────────
router.get("/api/twilio/calls", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const client = getClient();
    const since = req.query.since ? new Date(req.query.since as string).toISOString() : undefined;
    const { calls } = await client.calls.list({
      limit,
      status: ["completed", "in-progress", "queued", "ringing", "busy", "no-answer", "failed", "canceled"],
      startTime: since ? { lessThan: new Date().toISOString() } : undefined,
    });
    res.json({ ok: true, data: (calls as any[]).map((c: any) => ({
      callSid: c.sid,
      from: c.from,
      to: c.to,
      direction: c.direction || (c.to && c.from && c.to !== c.from ? "outbound" : "inbound"),
      status: c.status,
      startDate: c.startTime || null,
      endTime: c.endTime || null,
      duration: c.duration || null,
      price: c.price || null,
      error: c.errorMessage || c.errorCode || null,
      recordingStatus: (c as any).recordingStatus || null,
    })) });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "Failed to read calls", details: err?.message });
  }
});

// ─── GET /api/twilio/usage ─────────────────────────────────────────────────────
router.get("/api/twilio/usage", async (req: Request, res: Response) => {
  try {
    const client = getClient();
    const from = req.query.from ? new Date(req.query.from as string).toISOString() : undefined;
    const to = req.query.to ? new Date(req.query.to as string).toISOString() : undefined;
    const usage = await client.usage.usageRecords.list({
      category: "Voice",
      limit: 30,
      start: from,
      end: to,
    });
    const records = usage.map((u: any) => ({
      date: u.date ? new Date(u.date * 1000).toISOString().slice(0, 10) : null,
      unit: u.unit,
      value: u.value,
    }));
    res.json({ ok: true, data: { records, usageCode: usage.usageCode || null } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "Failed to read usage", details: err?.message });
  }
});

// ─── GET /api/twilio/webhooks ──────────────────────────────────────────────────
router.get("/api/twilio/webhooks", async (_req: Request, res: Response) => {
  try {
    res.json({
      ok: true,
      data: {
        voiceWebhookUrl: config.twimlAppSid ? `https://${config.appUrl}/api/twilio/voice` : null,
        statusCallbackUrl: config.twimlAppSid ? `https://${config.appUrl}/api/twilio/status` : null,
        incomingCallWebhook: config.twimlAppSid ? `https://${config.appUrl}/api/twilio/incoming` : null,
        recordingStatusUrl: config.twimlAppSid ? `https://${config.appUrl}/api/twilio/recording-status` : null,
        httpMethod: "POST",
        configured: !!config.twimlAppSid,
      }
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "Failed to read webhooks", details: err?.message });
  }
});

// ─── GET /api/twilio/connection ───────────────────────────────────────────────
router.get("/api/twilio/connection", async (_req: Request, res: Response) => {
  try {
    const client = getClient();
    await client.api.v2010.fetchAccount();
    const db = await pool.query(`SELECT twilio_api_connection_status, last_api_success_at FROM twilio_accounts LIMIT 1`);
    const row = db.rows[0];
    const status = row?.twilio_api_connection_status || "never_connected";
    if (row) {
      await pool.query(`UPDATE twilio_accounts SET twilio_api_connection_status = 'connected', last_api_success_at = NOW() WHERE account_sid = $1`, [row.account_sid]);
    }
    res.json({ ok: true, connected: status === "connected", status });
  } catch (err: any) {
    res.json({ ok: true, connected: false, status: "error", details: err?.message || "Twilio connection failed" });
  }
});

// ─── GET /api/twilio/events (latest app/webhook receipts) ────────────────────
router.get("/api/twilio/events", async (_req: Request, res: Response) => {
  try {
    const client = getClient();
    const evs = await client.applications.list({ limit: 10 });
    res.json({ ok: true, data: evs.map((e: any) => ({ sid: e.sid, friendlyName: e.friendlyName })) });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "Failed to read events", details: err?.message });
  }
});

// ─── POST /api/twilio/voice (call control) ───────────────────────────────────
router.post("/api/twilio/voice", async (req: Request, res: Response) => {
  try {
    const { to, from: callerId, direction = "outbound", suppressCallerId = false, record = false } = req.body || {};
    if (!to) return res.status(400).json({ error: "Missing 'to' (destination E.164).", code: "VALIDATION_ERROR" });

    //── Server-side call restriction ────────────────────────────────────────────
    const configRow = await pool.query(`SELECT * FROM twilio_accounts LIMIT 1`);
    const cfg = configRow.rows[0] || null;
    if (cfg && cfg.call_restrictions) {
      const restrictions = JSON.parse(cfg.call_restrictions);
      // Country allowlist
      const toCountry = to.replace("+", "").slice(0, 2);
      if (restrictions.enabled && restrictions.allowlistCountries.length > 0 && !restrictions.allowlistCountries.includes(toCountry)) {
        return res.status(403).json({ error: `Destination country +${toCountry} not in allowlist.`, code: "CALL_DENIED" });
      }
      if (restrictions.enabled && restrictions.blocklistCountries.includes(toCountry)) {
        return res.status(403).json({ error: `Destination country +${toCountry} is blocked.`, code: "CALL_DENIED" });
      }
      // Concurrent call limit (simplified — replaced by persisted engine)
    }

    // Build TwiML
    const twiml = new Twilio.twiml.VoiceResponse();
    const dial = twiml.dial({ callerId: callerId || config.twilioPhoneNumber });
    dial.number(to, { record: record ? "true" : "false", suppressCallerId });
    res.setHeader("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err: any) {
    console.error("[twilio/voice]", err);
    res.status(500).json({ error: "Failed to initiate call", details: err?.message });
  }
});

// ─── POST /api/twilio/status (call status callback) ──────────────────────────
router.post("/api/twilio/status", async (req: Request, res: Response) => {
  try {
    const data = req.body;
    // In a real deployment, verify the Twilio signature here:
    //   const validator = new getTwilioClient().restClient.authToken.validateRequest(...);
    // For signature verification see docs/SECURITY.md

    const callSid = data.CallSid;
    const status = data.CallStatus;
    const from = data.From;
    const to = data.To;
    const direction = data.Direction || (to && to.startsWith("+") ? "outbound" : "inbound");
    const callCost = data.CallCost;

    // Persist call events
    const c = await pool.query(
      `INSERT INTO call_events (call_id, kind, details, status_callback_response)
       SELECT id, 'status_changed', $1, $2
       FROM calls WHERE call_sid = $3 RETURNING id`, [JSON.stringify({ callSid, status, direction, callCost }), JSON.stringify(data), callSid]
    );
    const eventId = c.rows[0]?.id;
    if (!eventId) {
      // Insert call record
      await pool.query(
        `INSERT INTO calls (call_sid, account_sid, direction, from_number, to_number, status, status_reason, price, price_unit)
         VALUES ($1, (SELECT account_sid FROM twilio_accounts LIMIT 1), $2, $3, $4, $5, $6, $7, 'USD')`,
        [callSid, direction, from, to, status, null, callCost]
      );
    } else {
      await pool.query(
        `UPDATE calls SET status = $1, status_reason = $2, updated_at = NOW() WHERE call_sid = $3`,
        [status, null, callSid]
      );
    }
    res.sendStatus(200);
  } catch (err: any) {
    console.error("[twilio/status]", err);
    res.sendStatus(200); // Twilio retries idempotent; always 200
  }
});

// ─── POST /api/twilio/incoming (inbound call webhook) ────────────────────────
router.post("/api/twilio/incoming", async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const from = data.From;
    const to = data.To;

    // Verify Twilio signature (production)
    // const client = new Twilio(config.twilioAccountSid, config.twilioAuthToken);
    // client.validateRequest(req.headers["x-twilio-signature"] as string, req.originalUrl, data);

    // Build response: announce (TTS or audio URL) then dial out
    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.say({ voice: "man" }, "You have reached ITZ Adarsh. For assistance, please hold.");
    const dial = twiml.dial({ callerId: config.twilioPhoneNumber });
    dial.number(to || "+15005550006", { record: "false" });
    res.setHeader("Content-Type", "text/xml");
    res.send(twiml.toString());
  } catch (err: any) {
    console.error("[twilio/incoming]", err);
    res.sendStatus(500);
  }
});

// ─── POST /api/twilio/recording-status ───────────────────────────────────────
router.post("/api/twilio/recording-status", async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const { RecordingSid, RecordingUrl, Duration, Status } = data;
    if (RecordingSid) {
      await pool.query(
        `INSERT INTO call_recordings (call_id, recording_sid, recording_url, transcription_url, duration_seconds, recording_status, created_at)
         SELECT id, $1, $2, $3, $4, $5, NOW() FROM calls WHERE call_sid = $6`,
        [RecordingSid, RecordingUrl, null, Duration, Status, data.CallSid]
      );
    }
    res.sendStatus(200);
  } catch (err: any) {
    console.error("[twilio/recording-status]", err);
    res.sendStatus(200);
  }
});

export default router;
