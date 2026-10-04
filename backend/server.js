require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { requireAuthApi } = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const keysRoutes = require("./routes/keys");
const verifyRoutes = require("./routes/verify");

const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const requiredEnvVars = ["ADMIN_USER", "ADMIN_PASSWORD", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "FRONTEND_ORIGINS"];
const missingEnvVars = requiredEnvVars.filter((name) => !process.env[name]);
if (missingEnvVars.length) {
  console.error(`[startup] Missing required env vars: ${missingEnvVars.join(", ")}`);
}

const app = express();
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[cors] Rejected origin: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use((req, res, next) => {
  console.log(`[request] ${req.method} ${req.path}`);
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/verify", verifyRoutes);  // public: used by Sentinel.exe
app.use("/api", requireAuthApi, keysRoutes);

app.get("/", (req, res) => {
  res.json({ ok: true, service: "sentinel-keysite api" });
});

app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.path}`);
  res.status(404).json({ error: "not found" });
});

app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: "internal server error" });
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Sentinel key site running on port ${port}`);
});
