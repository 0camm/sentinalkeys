const redis = require("../lib/redis");

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.sentinel_session;
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
    const token = req.cookies.sentinel_session;
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

module.exports = { requireAuth, requireAuthApi };
