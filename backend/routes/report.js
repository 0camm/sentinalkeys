const express = require("express");
const rateLimit = require("express-rate-limit");
const redis = require("../lib/redis");

const router = express.Router();

// Public endpoint used by Sentinel.exe (like /api/verify). It is NOT behind the
// admin login; instead every report must carry a valid site key that is
// activated on the sending PC, so random callers cannot post to the webhook.
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many reports, try again later" }
});

const MAX_LOG_CHARS = 100000;

function parse(entry) {
  if (!entry) return null;
  try {
    return typeof entry === "string" ? JSON.parse(entry) : entry;
  } catch (err) {
    return null;
  }
}

async function findIdByKey(key) {
  const indexed = await redis.hget("key_index", key);
  if (indexed) return String(indexed);
  const all = (await redis.hgetall("keys")) || {};
  for (const [id, raw] of Object.entries(all)) {
    const entry = parse(raw);
    if (entry && entry.key === key) {
      await redis.hset("key_index", { [key]: id });
      return id;
    }
  }
  return null;
}

router.post("/", reportLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const key = String(body.key || req.get("x-sentinel-key") || "").trim();
    const device = String(body.device || req.get("x-sentinel-device") || "").trim();
    const discordId = String(body.discord_id || "").trim();
    const host = String(body.host || "").slice(0, 64);
    const scan = String(body.scan || "scan").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "scan";
    const text = String(body.log || "").slice(0, MAX_LOG_CHARS);

    if (!key || key.length > 64 || !/^[a-f0-9]{16,64}$/.test(device)) {
      return res.status(401).json({ error: "invalid key" });
    }

    // Same check as /api/verify, plus the key must already be tied to THIS PC.
    const id = await findIdByKey(key);
    const entry = id ? parse(await redis.hget("keys", id)) : null;
    if (!entry || !entry.device || entry.device !== device) {
      return res.status(403).json({ error: "invalid key" });
    }

    if (!/^\d{17,20}$/.test(discordId) || !text) {
      return res.status(400).json({ error: "bad report" });
    }

    const webhook = (process.env.DISCORD_WEBHOOK_URL || "").trim();
    if (!webhook) {
      console.error("[report] DISCORD_WEBHOOK_URL is not set");
      return res.status(503).json({ error: "DISCORD_WEBHOOK_URL not set on server" });
    }

    const form = new FormData();
    form.append("payload_json", JSON.stringify({
      content: `**Sentinel: ${scan}**\nDiscord ID: \`${discordId}\`  |  Host: \`${host.replace(/`/g, "")}\``,
      allowed_mentions: { parse: [] } // logs can never ping anyone
    }));
    form.append("files[0]", new Blob([text], { type: "text/plain" }), `${scan}_${discordId}.txt`);

    const resp = await fetch(webhook, { method: "POST", body: form });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300);
      console.error(`[report] Discord returned ${resp.status}: ${detail}`);
      const hint = resp.status === 401 || resp.status === 404
        ? "webhook rejected by Discord (re-create it and update DISCORD_WEBHOOK_URL)"
        : `webhook returned ${resp.status}`;
      return res.status(502).json({ error: hint });
    }

    console.log(`[report] ${scan} for ${discordId} sent`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[report] failed:", err);
    res.status(500).json({ error: "server error, try again" });
  }
});

module.exports = router;
