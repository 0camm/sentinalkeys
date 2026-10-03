const express = require("express");
const rateLimit = require("express-rate-limit");
const redis = require("../lib/redis");

const router = express.Router();

// Public endpoint used by Sentinel.exe. Tight limit so keys can't be guessed.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many attempts, try again later" }
});

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
  // Fallback for keys seeded before key_index existed.
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

router.post("/", verifyLimiter, async (req, res) => {
  try {
    const { key, device } = req.body || {};
    if (typeof key !== "string" || typeof device !== "string") {
      return res.status(400).json({ error: "key and device are required" });
    }
    const cleanKey = key.trim();
    const cleanDevice = device.trim();
    if (!cleanKey || cleanKey.length > 64 || !/^[a-f0-9]{16,64}$/.test(cleanDevice)) {
      return res.status(401).json({ error: "invalid key" });
    }

    const id = await findIdByKey(cleanKey);
    const entry = id ? parse(await redis.hget("keys", id)) : null;
    if (!entry) {
      return res.status(401).json({ error: "invalid key" });
    }

    if (entry.device && entry.device !== cleanDevice) {
      return res.status(403).json({ error: "this key is already activated on another PC" });
    }

    if (!entry.device) {
      entry.device = cleanDevice;
      entry.activatedAt = new Date().toISOString();
      await redis.hset("keys", { [id]: JSON.stringify(entry) });
      console.log(`[verify] Key "${id}" activated`);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[verify] failed:", err);
    res.status(500).json({ error: "server error, try again" });
  }
});

module.exports = router;
