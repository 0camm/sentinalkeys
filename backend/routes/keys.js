const express = require("express");
const crypto = require("crypto");
const redis = require("../lib/redis");

const router = express.Router();

router.get("/keys", async (req, res) => {
  try {
    const order = await redis.lrange("key_order", 0, -1);
    console.log(`[keys] key_order has ${order.length} entries`);
    if (!order.length) {
      return res.json({ keys: [] });
    }
    const raw = await redis.hmget("keys", ...order);
    const keys = order.map((id) => {
      const entry = raw[id];
      if (!entry) {
        console.warn(`[keys] No hash entry found for id "${id}"`);
        return null;
      }
      try {
        return typeof entry === "string" ? JSON.parse(entry) : entry;
      } catch (parseErr) {
        console.error(`[keys] Failed to parse entry for id "${id}":`, parseErr);
        return null;
      }
    }).filter(Boolean);
    console.log(`[keys] Returning ${keys.length} of ${order.length} keys`);
    res.json({ keys });
  } catch (err) {
    console.error("[keys] GET /keys failed:", err);
    res.status(500).json({ error: "failed to load keys" });
  }
});

router.post("/keys/:id/copy", async (req, res) => {
  try {
    const { id } = req.params;
    const raw = await redis.hget("keys", id);
    if (!raw) {
      console.warn(`[keys] copy requested for unknown id "${id}"`);
      return res.status(404).json({ error: "key not found" });
    }
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
    const now = new Date().toISOString();
    if (!entry.copied) {
      entry.copied = true;
      entry.copiedAt = now;
      await redis.hset("keys", { [id]: JSON.stringify(entry) });
    }
    const historyEntry = { id, key: entry.key, copiedAt: now };
    await redis.lpush("history", JSON.stringify(historyEntry));
    await redis.ltrim("history", 0, 499);
    console.log(`[keys] Key "${id}" marked copied`);
    res.json({ ok: true, key: entry });
  } catch (err) {
    console.error(`[keys] POST /keys/${req.params.id}/copy failed:`, err);
    res.status(500).json({ error: "failed to copy key" });
  }
});

router.get("/history", async (req, res) => {
  try {
    const raw = await redis.lrange("history", 0, 99);
    const history = raw.map((entry) => (typeof entry === "string" ? JSON.parse(entry) : entry));
    res.json({ history });
  } catch (err) {
    console.error("[keys] GET /history failed:", err);
    res.status(500).json({ error: "failed to load history" });
  }
});

// No 0/O/1/I/L so keys are easy to read out and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomGroup(len) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

function newKey() {
  return `SNTL-${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}`;
}

router.post("/keys/generate", async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.body && req.body.count, 10) || 1, 1), 100);
    const created = [];
    for (let i = 0; i < count; i++) {
      const key = newKey();
      const id = `g${crypto.randomBytes(6).toString("hex")}`;
      const entry = { id, key, copied: false, copiedAt: null };
      await redis.hset("keys", { [id]: JSON.stringify(entry) });
      await redis.hset("key_index", { [key]: id });
      await redis.rpush("key_order", id);
      created.push(entry);
    }
    console.log(`[keys] Generated ${created.length} keys`);
    res.json({ ok: true, keys: created });
  } catch (err) {
    console.error("[keys] POST /keys/generate failed:", err);
    res.status(500).json({ error: "failed to generate keys" });
  }
});

router.post("/keys/:id/reset", async (req, res) => {
  try {
    const { id } = req.params;
    const raw = await redis.hget("keys", id);
    if (!raw) return res.status(404).json({ error: "key not found" });
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
    delete entry.device;
    delete entry.activatedAt;
    await redis.hset("keys", { [id]: JSON.stringify(entry) });
    console.log(`[keys] Device binding reset for "${id}"`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[keys] POST /keys/:id/reset failed:", err);
    res.status(500).json({ error: "failed to reset key" });
  }
});

module.exports = router;
