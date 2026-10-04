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

const MAX_LOG_CHARS = 1000000;  // far above any real scan; just a sanity bound
const MAX_BLOCK_CHARS = 1900;   // text per Discord message (limit 2000 incl. the code fence)
const FENCE = "`".repeat(3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Entries are separated by a blank line (the app joins them that way). Multi-line
// entries such as the prefetch ones stay together.
function splitEntries(text) {
  return text
    .split(/\n{2,}/)
    .map((e) => e.replace(/\r/g, "").trim())
    .filter((e) => e && !/^===.*===$/.test(e)); // the "=== SCAN | ... ===" banner is replaced by our header
}

// Packs entries into as few messages as possible: one entry per line inside a code
// block, filling each message up to Discord's limit. Nothing is dropped, and a scan
// with hundreds of hits needs tens of messages instead of hundreds, so it arrives fast.
function packEntries(entries) {
  const messages = [];
  let body = "";
  let prevMulti = false;
  const flush = () => {
    if (body) messages.push(`${FENCE}\n${body}\n${FENCE}`);
    body = "";
  };
  for (const raw of entries) {
    let e = raw.split(FENCE).join("'''");
    if (e.length > MAX_BLOCK_CHARS) e = e.slice(0, MAX_BLOCK_CHARS - 3) + "...";
    const multi = e.includes("\n");
    // multi-line entries (prefetch) get a blank line around them so they stay readable
    const sep = body ? (multi || prevMulti ? "\n\n" : "\n") : "";
    if (body && body.length + sep.length + e.length > MAX_BLOCK_CHARS) flush();
    body += (body ? sep : "") + e;
    prevMulti = multi;
  }
  flush();
  return messages;
}

// Posts one message, respecting Discord's rate limits (429 + the remaining/reset headers).
async function postMessage(webhook, content) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const resp = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) // logs can never ping anyone
    });
    if (resp.status === 429) {
      let wait = 1;
      try { wait = Number((await resp.json()).retry_after) || 1; } catch (e) { /* keep default */ }
      await sleep(Math.min(wait, 10) * 1000 + 100);
      continue;
    }
    if (resp.ok && resp.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(resp.headers.get("x-ratelimit-reset-after")) || 1;
      await sleep(Math.min(reset, 10) * 1000 + 50);
    }
    return resp;
  }
  throw new Error("Discord rate limit not clearing");
}

// Reports are sent one after another, so two scans never interleave in the channel.
let sendChain = Promise.resolve();

router.post("/", reportLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const key = String(body.key || req.get("x-sentinel-key") || "").trim();
    const device = String(body.device || req.get("x-sentinel-device") || "").trim();
    const discordId = String(body.discord_id || "").trim();
    const host = String(body.host || "").slice(0, 64).replace(/`/g, "");
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

    const entries = splitEntries(text);
    const blocks = packEntries(entries);
    const count = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
    const header = `**Sentinel: ${scan}** | Discord ID: \`${discordId}\` | Host: \`${host}\` | ${count}`;

    // The first message goes out before replying, so a bad webhook shows up in the app.
    const first = await postMessage(webhook, header);
    if (!first.ok) {
      const detail = (await first.text()).slice(0, 300);
      console.error(`[report] Discord returned ${first.status}: ${detail}`);
      const hint = first.status === 401 || first.status === 404
        ? "webhook rejected by Discord (re-create it and update DISCORD_WEBHOOK_URL)"
        : `webhook returned ${first.status}`;
      return res.status(502).json({ error: hint });
    }

    // The findings follow in the background so the app is not kept waiting.
    sendChain = sendChain.then(async () => {
      try {
        for (const block of blocks) {
          const r = await postMessage(webhook, block);
          if (!r.ok) {
            console.error(`[report] Discord returned ${r.status} mid-report; stopping`);
            return;
          }
        }
        console.log(`[report] ${scan} for ${discordId}: ${entries.length} entries delivered in ${blocks.length} messages`);
      } catch (err) {
        console.error("[report] background send failed:", err);
      }
    });

    console.log(`[report] ${scan} for ${discordId} accepted (${entries.length} entries)`);
    res.json({ ok: true, entries: entries.length });
  } catch (err) {
    console.error("[report] failed:", err);
    res.status(500).json({ error: "server error, try again" });
  }
});

module.exports = router;
