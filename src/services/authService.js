// src/services/authService.js
// ─────────────────────────────────────────────────────────
//  Handles: Email/Password, Google OAuth, Apple Sign In,
//           Email Verification, Password Reset
// ─────────────────────────────────────────────────────────
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const crypto  = require("crypto");
const axios   = require("axios");
const { prisma }     = require("../utils/prisma");
const { setCache, getCache, delCache } = require("../utils/redis");
const emailService   = require("./emailService");
const logger         = require("../utils/logger");

/* ── Token helpers ───────────────────────────────────────── */
const signAccess = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

const signRefresh = (userId) =>
  jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: "30d",
  });

const randomToken = () => crypto.randomBytes(32).toString("hex");

/* ── Build safe user response ────────────────────────────── */
function safeUser(user) {
  return {
    id:           user.id,
    name:         user.name,
    email:        user.email,
    avatarUrl:    user.avatarUrl,
    country:      user.country,
    phone:        user.phone,
    telegramId:   user.telegramId,
    emailVerified:user.emailVerified,
    isAdmin:      user.isAdmin,
    plan:         user.subscription?.plan  || "FREE",
    subStatus:    user.subscription?.status || "ACTIVE",
    createdAt:    user.createdAt,
  };
}

/* ── Create session record ───────────────────────────────── */
async function createSession(userId, req) {
  const refresh = signRefresh(userId);
  await prisma.session.create({
    data: {
      userId,
      token:     refresh,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
    },
  });
  return refresh;
}

/* ══════════════════════════════════════════════════════════
   EMAIL / PASSWORD
══════════════════════════════════════════════════════════ */
async function registerEmail({ name, email, password, country }, req) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw Object.assign(new Error("Email already registered"), { status: 409 });

  const passwordHash = await bcrypt.hash(password, 12);
  const verifyToken  = randomToken();

  const user = await prisma.user.create({
    data: {
      name, email, passwordHash, country,
      subscription: { create: { plan: "FREE" } },
    },
    include: { subscription: true },
  });

  // Cache verify token (expires 24h)
  await setCache(`verify:${verifyToken}`, user.id, 60 * 60 * 24);

  // Send verification email
  await emailService.sendVerification(user, verifyToken);

  const access  = signAccess(user.id);
  const refresh = await createSession(user.id, req);

  logger.info(`Registered: ${email}`);
  return { token: access, refreshToken: refresh, user: safeUser(user) };
}

async function loginEmail({ email, password }, req) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { subscription: true },
  });

  if (!user || !user.passwordHash) {
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw Object.assign(new Error("Invalid credentials"), { status: 401 });

  if (!user.isActive) {
    throw Object.assign(new Error("Account suspended. Contact support@arbitrageai.com"), { status: 403 });
  }

  const access  = signAccess(user.id);
  const refresh = await createSession(user.id, req);

  logger.info(`Login: ${email}`);
  return { token: access, refreshToken: refresh, user: safeUser(user) };
}

/* ── Verify email ────────────────────────────────────────── */
async function verifyEmail(token) {
  const userId = await getCache(`verify:${token}`);
  if (!userId) throw Object.assign(new Error("Invalid or expired verification link"), { status: 400 });

  await prisma.user.update({
    where: { id: userId },
    data:  { emailVerified: true },
  });
  await delCache(`verify:${token}`);

  logger.info(`Email verified: user ${userId}`);
  return { message: "Email verified successfully" };
}

/* ── Password reset ──────────────────────────────────────── */
async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always return success to prevent email enumeration
  if (!user) return { message: "If that email exists, a reset link was sent." };

  const token = randomToken();
  await setCache(`reset:${token}`, user.id, 60 * 60); // 1 hour

  await emailService.sendPasswordReset(user, token);
  logger.info(`Password reset requested: ${email}`);
  return { message: "If that email exists, a reset link was sent." };
}

async function resetPassword(token, newPassword) {
  const userId = await getCache(`reset:${token}`);
  if (!userId) throw Object.assign(new Error("Invalid or expired reset link"), { status: 400 });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Invalidate all existing sessions
  await prisma.session.deleteMany({ where: { userId } });
  await delCache(`reset:${token}`);

  logger.info(`Password reset completed: user ${userId}`);
  return { message: "Password updated. Please login." };
}

/* ── Refresh token rotation ──────────────────────────────── */
async function refreshTokens(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
  }

  const session = await prisma.session.findUnique({ where: { token: refreshToken } });
  if (!session || session.expiresAt < new Date()) {
    throw Object.assign(new Error("Session expired. Please login again."), { status: 401 });
  }

  const newAccess  = signAccess(payload.userId);
  const newRefresh = signRefresh(payload.userId);

  await prisma.session.update({
    where: { token: refreshToken },
    data: {
      token:     newRefresh,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return { token: newAccess, refreshToken: newRefresh };
}

/* ══════════════════════════════════════════════════════════
   GOOGLE OAUTH
══════════════════════════════════════════════════════════ */

// Step 1 — Build the Google authorization URL
function getGoogleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${process.env.BACKEND_URL}/api/auth/google/callback`,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "offline",
    state:         state || "login",
    prompt:        "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Step 2 — Exchange code for tokens, get user profile
async function googleCallback(code, req) {
  // Exchange code for access token
  const tokenRes = await axios.post("https://oauth2.googleapis.com/token", {
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  `${process.env.BACKEND_URL}/api/auth/google/callback`,
    grant_type:    "authorization_code",
  });

  const { access_token, id_token } = tokenRes.data;

  // Get user profile
  const profileRes = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  const profile = profileRes.data;
  // profile: { sub, name, email, picture, email_verified }

  return handleOAuthUser({
    googleId:  profile.sub,
    email:     profile.email,
    name:      profile.name,
    avatarUrl: profile.picture,
    emailVerified: profile.email_verified,
  }, req);
}

// Verify Google ID Token directly (for mobile apps / frontend SDK)
async function verifyGoogleToken(idToken, req) {
  const res = await axios.get(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
  );
  const profile = res.data;

  if (profile.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw Object.assign(new Error("Invalid Google token"), { status: 401 });
  }

  return handleOAuthUser({
    googleId:  profile.sub,
    email:     profile.email,
    name:      profile.name,
    avatarUrl: profile.picture,
    emailVerified: profile.email_verified === "true",
  }, req);
}

/* ══════════════════════════════════════════════════════════
   APPLE SIGN IN
══════════════════════════════════════════════════════════ */
async function verifyAppleToken(identityToken, user, req) {
  // Fetch Apple's public keys
  const keysRes = await axios.get("https://appleid.apple.com/auth/keys");
  const keys    = keysRes.data.keys;

  // Decode the token header to find the right key
  const header  = JSON.parse(Buffer.from(identityToken.split(".")[0], "base64").toString());
  const appleKey = keys.find(k => k.kid === header.kid);

  if (!appleKey) throw Object.assign(new Error("Apple key not found"), { status: 401 });

  // Build PEM from JWK
  const jwkToPem = require("jwk-to-pem");
  const pem = jwkToPem(appleKey);

  let payload;
  try {
    payload = jwt.verify(identityToken, pem, { algorithms: ["RS256"] });
  } catch {
    throw Object.assign(new Error("Invalid Apple token"), { status: 401 });
  }

  if (payload.aud !== process.env.APPLE_CLIENT_ID) {
    throw Object.assign(new Error("Apple token audience mismatch"), { status: 401 });
  }

  // Apple only sends name on first login — use what we get
  const appleUser = typeof user === "string" ? JSON.parse(user) : user;
  const name = appleUser?.name
    ? `${appleUser.name.firstName || ""} ${appleUser.name.lastName || ""}`.trim()
    : payload.email?.split("@")[0] || "Apple User";

  return handleOAuthUser({
    appleId:   payload.sub,
    email:     payload.email,
    name,
    emailVerified: !!payload.email_verified,
  }, req);
}

/* ── Shared OAuth user handler ───────────────────────────── */
async function handleOAuthUser({ googleId, appleId, email, name, avatarUrl, emailVerified }, req) {
  // Try to find existing user
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        googleId ? { googleId } : undefined,
        appleId  ? { appleId  } : undefined,
        { email },
      ].filter(Boolean),
    },
    include: { subscription: true },
  });

  if (user) {
    // Update OAuth IDs and avatar if needed
    const updates = {};
    if (googleId && !user.googleId) updates.googleId = googleId;
    if (appleId  && !user.appleId)  updates.appleId  = appleId;
    if (avatarUrl && !user.avatarUrl) updates.avatarUrl = avatarUrl;
    if (emailVerified && !user.emailVerified) updates.emailVerified = true;

    if (Object.keys(updates).length) {
      user = await prisma.user.update({
        where: { id: user.id }, data: updates,
        include: { subscription: true },
      });
    }
  } else {
    // Create new user
    user = await prisma.user.create({
      data: {
        email, name,
        googleId:      googleId || undefined,
        appleId:       appleId  || undefined,
        avatarUrl:     avatarUrl || undefined,
        emailVerified: emailVerified || false,
        subscription:  { create: { plan: "FREE" } },
      },
      include: { subscription: true },
    });

    await emailService.sendWelcome(user);
    logger.info(`New OAuth user: ${email}`);
  }

  if (!user.isActive) {
    throw Object.assign(new Error("Account suspended"), { status: 403 });
  }

  const access  = signAccess(user.id);
  const refresh = await createSession(user.id, req);

  return { token: access, refreshToken: refresh, user: safeUser(user) };
}

/* ══════════════════════════════════════════════════════════
   LOGOUT
══════════════════════════════════════════════════════════ */
async function logout(userId, refreshToken) {
  if (refreshToken) {
    await prisma.session.deleteMany({ where: { token: refreshToken } });
  }
  logger.info(`Logout: user ${userId}`);
}

async function logoutAll(userId) {
  await prisma.session.deleteMany({ where: { userId } });
  logger.info(`Logout all sessions: user ${userId}`);
}

module.exports = {
  registerEmail,
  loginEmail,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  refreshTokens,
  getGoogleAuthUrl,
  googleCallback,
  verifyGoogleToken,
  verifyAppleToken,
  logout,
  logoutAll,
  safeUser,
};
