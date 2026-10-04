const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const redis = require("../lib/redis");
const { getToken } = require("../middleware/auth");

const router = express.Router();

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_ATTEMPTS = 8;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

const loginLimiter = rateLimit({
  windowMs: LOCKOUT_WINDOW_SECONDS * 1000,
  max: MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many attempts, try again later" }
});

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ""));
  const bBuf = Buffer.from(String(b || ""));
  // Compare against a fixed-length buffer first so the length of the
  // caller-supplied value can't be inferred from response timing, then
  // do the real comparison only when lengths match.
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function clientKey(req) {
  return req.ip || req.headers["x-forwarded-for"] || "unknown";
}

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "username and password are required" });
    }

    const attemptsKey = `login_attempts:${clientKey(req)}`;
    const attempts = Number((await redis.get(attemptsKey)) || 0);
    if (attempts >= MAX_ATTEMPTS) {
      console.warn(`[auth] Lockout in effect for ${clientKey(req)}`);
      return res.status(429).json({ error: "too many attempts, try again later" });
    }

    const validUser = timingSafeEqual(username, process.env.ADMIN_USER);
    const validPass = timingSafeEqual(password, process.env.ADMIN_PASSWORD);
    if (!validUser || !validPass) {
      const next = attempts + 1;
      await redis.set(attemptsKey, next, { ex: LOCKOUT_WINDOW_SECONDS });
      console.warn(`[auth] Failed login attempt ${next}/${MAX_ATTEMPTS} from ${clientKey(req)}`);
      return res.status(401).json({ error: "invalid credentials" });
    }

    await redis.del(attemptsKey);
    const token = crypto.randomBytes(32).toString("hex");
    await redis.set(`session:${token}`, username, { ex: SESSION_TTL_SECONDS });
    res.cookie("sentinel_session", token, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: SESSION_TTL_SECONDS * 1000
    });
    console.log(`[auth] Login succeeded for username "${username}"`);
    // The token is also returned so the panel can send it as a header (mobile browsers
    // block the cross-site cookie above).
    res.json({ ok: true, token });
  } catch (err) {
    console.error("[auth] /login failed:", err);
    res.status(500).json({ error: "login failed" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const token = getToken(req);
    if (token) {
      await redis.del(`session:${token}`);
    }
    res.clearCookie("sentinel_session", { sameSite: "none", secure: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("[auth] /logout failed:", err);
    res.status(500).json({ error: "logout failed" });
  }
});

module.exports = router;
