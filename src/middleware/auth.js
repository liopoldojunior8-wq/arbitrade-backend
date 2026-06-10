// src/middleware/auth.js
const jwt = require("jsonwebtoken");
const { prisma } = require("../utils/prisma");

// ── Verify JWT token ──────────────────────────────────────
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = header.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Load fresh user from DB (catches banned/deleted users)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { subscription: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Account not found or suspended" });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ── Admin only ────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// ── Plan guards ───────────────────────────────────────────
function requirePlan(...plans) {
  return (req, res, next) => {
    const userPlan = req.user?.subscription?.plan || "FREE";
    if (!plans.includes(userPlan)) {
      return res.status(403).json({
        error: "Upgrade required",
        requiredPlan: plans[0],
        currentPlan: userPlan,
        upgradeUrl: "/plans",
      });
    }
    next();
  };
}

// Shorthand guards
const requirePro        = requirePlan("PRO", "ENTERPRISE");
const requireEnterprise = requirePlan("ENTERPRISE");

module.exports = { authenticate, requireAdmin, requirePlan, requirePro, requireEnterprise };
