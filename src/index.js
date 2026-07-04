// src/index.js — ArbitrageAI Express Server
require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const rateLimit = require("express-rate-limit");

const logger   = require("./utils/logger");
const { connectRedis } = require("./utils/redis");
const { startJobs }    = require("./jobs");

// Routes
const authRoutes     = require("./routes/auth");
const userRoutes     = require("./routes/users");
const productRoutes  = require("./routes/products");
const scannerRoutes  = require("./routes/scanner");
const alertRoutes    = require("./routes/alerts");
const paymentRoutes  = require("./routes/payments");
const adminRoutes    = require("./routes/admin");
const webhookRoutes  = require("./routes/webhooks");

const app  = express();
const PORT = process.env.PORT || 4000;

// ── SECURITY ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: ["http://localhost:3000", process.env.FRONTEND_URL].filter(Boolean),
}));

// ── RATE LIMITING ─────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"),
  max:      parseInt(process.env.RATE_LIMIT_MAX || "100"),
  message:  { error: "Too many requests. Please try again later." },
});
app.use("/api/", limiter);

// ── BODY PARSING ──────────────────────────────────────────
// Webhook routes need raw body for signature verification
app.use("/api/webhooks", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── HEALTH CHECK ──────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ArbitrageAI API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ── API ROUTES ────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/users",    userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/scanner",  scannerRoutes);
app.use("/api/alerts",   alertRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/webhooks", webhookRoutes);

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`${err.message}`, { stack: err.stack, path: req.path });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
});

// ── START ─────────────────────────────────────────────────
async function start() {
  try {
    await connectRedis();
    logger.info("✅ Redis connected");

    app.listen(PORT, () => {
      logger.info(`🚀 ArbitrageAI API running on port ${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
    });

    // Start background cron jobs
    startJobs();
    logger.info("⚡ Background jobs started");

  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
