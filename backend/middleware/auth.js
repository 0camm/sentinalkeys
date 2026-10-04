const redis = require("../lib/redis");

const TOKEN_RE = /^[a-f0-9]{64}$/;

// The admin panel is hosted on a different domain than this API. Mobile browsers
// (iOS Safari, recent Android Chrome) block third-party cookies, so the panel sends
// its session token in the X-Admin-Token header. The cookie is still accepted for
// older sessions.
function getToken(req) {
  const header = String(req.get("x-admin-token") || "").trim();
  const token = header || req.cookies.sentinel_session || "";
  return TOKEN_RE.test(token) ? token : "";
}

async function requireAuth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) {
      return res.redirect("/login.html");
    }
    const session = await redis.get(`session:${token}`);
    if (!session) {
      res.clearCookie("sentinel_session");
      return res.redirect("/login.html");
    }
    next();
  } catch (err) {
    console.error("[auth] requireAuth failed:", err);
    res.redirect("/login.html");
  }
}

async function requireAuthApi(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ error: "not authenticated" });
    }
    const session = await redis.get(`session:${token}`);
    if (!session) {
      return res.status(401).json({ error: "not authenticated" });
    }
    next();
  } catch (err) {
    console.error("[auth] requireAuthApi failed:", err);
    res.status(500).json({ error: "auth check failed" });
  }
}

module.exports = { requireAuth, requireAuthApi, getToken };
