// src/routes/users.js
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { authenticate } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");

// GET /api/users/me/tracked
router.get("/me/tracked", authenticate, async (req, res) => {
  const tracked = await prisma.trackedProduct.findMany({
    where: { userId: req.user.id },
    include: { product: { include: { priceHistory: { orderBy: { recordedAt: "desc" }, take: 7 } } } },
  });
  res.json({ tracked });
});

// PATCH /api/users/me
router.patch("/me", authenticate, async (req, res) => {
  const { name, country, phone, telegramId } = req.body;
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { name, country, phone, telegramId },
  });
  res.json({ user: { id:user.id, name:user.name, email:user.email, country:user.country, phone:user.phone, telegramId:user.telegramId } });
});

// PATCH /api/users/me/password
router.patch("/me/password", authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(422).json({ error: "New password must be at least 8 characters" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(400).json({ error: "Current password is incorrect" });
  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: hash } });
  res.json({ message: "Password updated successfully" });
});

// GET /api/users/me/notifications
router.get("/me/notifications", authenticate, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json({ notifications });
});

// PATCH /api/users/me/notifications/read
router.patch("/me/notifications/read", authenticate, async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id }, data: { read: true } });
  res.json({ success: true });
});

module.exports = router;
