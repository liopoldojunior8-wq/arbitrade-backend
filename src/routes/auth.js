// src/routes/auth.js  (versão completa)
// ─────────────────────────────────────────────────────────
//  POST /api/auth/register
//  POST /api/auth/login
//  POST /api/auth/logout
//  POST /api/auth/logout-all
//  POST /api/auth/refresh
//  GET  /api/auth/me
//  GET  /api/auth/verify-email/:token
//  POST /api/auth/resend-verification
//  POST /api/auth/forgot-password
//  POST /api/auth/reset-password
//  GET  /api/auth/google
//  GET  /api/auth/google/callback
//  POST /api/auth/google/token
//  POST /api/auth/apple/token
//  POST /api/auth/apple/callback
//  GET  /api/auth/sessions
//  DELETE /api/auth/sessions/:id
// ─────────────────────────────────────────────────────────
const router = require("express").Router();
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const authService = require("../services/authService");

const validate = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ errors: errors.array() }); return false; }
  return true;
};

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (result !== undefined) res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Server error" });
  }
};

// ── Register ──────────────────────────────────────────────
router.post("/register", [
  body("name").trim().isLength({ min:2, max:80 }),
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min:8 })
    .matches(/[A-Z]/).withMessage("Must contain an uppercase letter")
    .matches(/[0-9]/).withMessage("Must contain a number"),
  body("country").optional().isLength({ max:100 }),
], handle(async (req, res) => {
  if (!validate(req, res)) return;
  const data = await authService.registerEmail(req.body, req);
  res.status(201).json(data);
}));

// ── Login ─────────────────────────────────────────────────
router.post("/login", [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
], handle(async (req, res) => {
  if (!validate(req, res)) return;
  return authService.loginEmail(req.body, req);
}));

// ── Logout ────────────────────────────────────────────────
router.post("/logout", authenticate, handle(async (req) => {
  await authService.logout(req.user.id, req.body.refreshToken);
  return { message: "Logged out successfully" };
}));

router.post("/logout-all", authenticate, handle(async (req) => {
  await authService.logoutAll(req.user.id);
  return { message: "All sessions terminated" };
}));

// ── Refresh ───────────────────────────────────────────────
router.post("/refresh", [
  body("refreshToken").notEmpty(),
], handle(async (req, res) => {
  if (!validate(req, res)) return;
  return authService.refreshTokens(req.body.refreshToken);
}));

// ── Me ────────────────────────────────────────────────────
router.get("/me", authenticate, (req, res) => {
  res.json({ user: authService.safeUser(req.user) });
});

// ── Email verification ────────────────────────────────────
router.get("/verify-email/:token", handle(async (req) => {
  return authService.verifyEmail(req.params.token);
}));

router.post("/resend-verification", authenticate, handle(async (req) => {
  if (req.user.emailVerified) return { message: "Email already verified" };
  const crypto = require("crypto");
  const { setCache } = require("../utils/redis");
  const emailService = require("../services/emailService");
  const token = crypto.randomBytes(32).toString("hex");
  await setCache(`verify:${token}`, req.user.id, 60 * 60 * 24);
  await emailService.sendVerification(req.user, token);
  return { message: "Verification email sent" };
}));

// ── Password reset ────────────────────────────────────────
router.post("/forgot-password", [
  body("email").isEmail().normalizeEmail(),
], handle(async (req, res) => {
  if (!validate(req, res)) return;
  return authService.requestPasswordReset(req.body.email);
}));

router.post("/reset-password", [
  body("token").notEmpty(),
  body("password").isLength({ min:8 })
    .matches(/[A-Z]/).withMessage("Must contain uppercase")
    .matches(/[0-9]/).withMessage("Must contain a number"),
], handle(async (req, res) => {
  if (!validate(req, res)) return;
  return authService.resetPassword(req.body.token, req.body.password);
}));

// ── Google OAuth (web server-side) ────────────────────────
router.get("/google", (req, res) => {
  res.redirect(authService.getGoogleAuthUrl(req.query.state));
});

router.get("/google/callback", handle(async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`${process.env.FRONTEND_URL}/auth/login?error=google_denied`);
  }
  try {
    const { token, refreshToken, user } = await authService.googleCallback(code, req);
    const params = new URLSearchParams({ token, refreshToken, userId: user.id });
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?${params}`);
  } catch {
    res.redirect(`${process.env.FRONTEND_URL}/auth/login?error=google_failed`);
  }
}));

// Google token verify (mobile / frontend SDK)
router.post("/google/token", [
  body("idToken").notEmpty(),
], handle(async (req, res) => {
  if (!validate(req, res)) return;
  return authService.verifyGoogleToken(req.body.idToken, req);
}));

// ── Apple Sign In ─────────────────────────────────────────
router.post("/apple/token", [
  body("identityToken").notEmpty(),
], handle(async (req, res) => {
  if (!validate(req, res)) return;
  return authService.verifyAppleToken(req.body.identityToken, req.body.user, req);
}));

router.post("/apple/callback", handle(async (req, res) => {
  const { id_token, user, error } = req.body;
  if (error) return res.redirect(`${process.env.FRONTEND_URL}/auth/login?error=apple_denied`);
  try {
    const { token, refreshToken } = await authService.verifyAppleToken(id_token, user, req);
    const params = new URLSearchParams({ token, refreshToken });
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?${params}`);
  } catch {
    res.redirect(`${process.env.FRONTEND_URL}/auth/login?error=apple_failed`);
  }
}));

// ── Session management ────────────────────────────────────
router.get("/sessions", authenticate, handle(async (req) => {
  const { prisma } = require("../utils/prisma");
  const sessions = await prisma.session.findMany({
    where: { userId: req.user.id, expiresAt: { gt: new Date() } },
    select: { id:true, ipAddress:true, userAgent:true, createdAt:true, expiresAt:true },
    orderBy: { createdAt: "desc" },
  });
  return { sessions };
}));

router.delete("/sessions/:id", authenticate, handle(async (req) => {
  const { prisma } = require("../utils/prisma");
  await prisma.session.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  return { message: "Session revoked" };
}));

module.exports = router;
