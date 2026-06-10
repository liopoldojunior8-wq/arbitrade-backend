// src/routes/alerts.js
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");

router.get("/", authenticate, async (req, res) => {
  const alerts = await prisma.alert.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ alerts });
});

router.post("/rules", authenticate, async (req, res) => {
  const { channel, type, minROI, minProfit, marketplace, category, targetPrice } = req.body;
  const rule = await prisma.alertRule.create({
    data: { userId: req.user.id, name: req.body.name || "My Alert", channel, type, minROI, minProfit, marketplace, category, targetPrice },
  });
  res.status(201).json({ rule });
});

router.get("/rules", authenticate, async (req, res) => {
  const rules = await prisma.alertRule.findMany({ where: { userId: req.user.id } });
  res.json({ rules });
});

router.delete("/rules/:id", authenticate, async (req, res) => {
  await prisma.alertRule.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  res.json({ success: true });
});

module.exports = router;
