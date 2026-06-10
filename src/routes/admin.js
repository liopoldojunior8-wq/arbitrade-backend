// src/routes/admin.js
const router = require("express").Router();
const { authenticate, requireAdmin } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");

router.use(authenticate, requireAdmin);

// Platform stats
router.get("/stats", async (req, res) => {
  const [users, subs, payments, products, opportunities, scanJobs] = await Promise.all([
    prisma.user.count(),
    prisma.subscription.groupBy({ by: ["plan"], _count: true }),
    prisma.payment.aggregate({ where: { status: "COMPLETED" }, _sum: { amount: true } }),
    prisma.product.count(),
    prisma.arbitrageOpportunity.count({ where: { isActive: true } }),
    prisma.scanJob.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
  ]);
  res.json({ users, subscriptions: subs, totalRevenue: payments._sum.amount || 0, products, activeOpportunities: opportunities, recentJobs: scanJobs });
});

// User management
router.get("/users", async (req, res) => {
  const { q, plan, page = 1, limit = 50 } = req.query;
  const where = {};
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }];
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { subscription: true, _count: { select: { payments: true, products: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page-1) * parseInt(limit), take: parseInt(limit),
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ users, total });
});

router.patch("/users/:id", async (req, res) => {
  const { isActive, isAdmin, plan } = req.body;
  const updates = {};
  if (typeof isActive !== "undefined") updates.isActive = isActive;
  if (typeof isAdmin  !== "undefined") updates.isAdmin  = isAdmin;
  const user = await prisma.user.update({ where: { id: req.params.id }, data: updates });
  if (plan) {
    await prisma.subscription.update({ where: { userId: req.params.id }, data: { plan } });
  }
  res.json({ user });
});

// Revenue by period
router.get("/revenue", async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { status: "COMPLETED" },
    select: { amount: true, currency: true, method: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
  res.json({ payments });
});

module.exports = router;

// ─────────────────────────────────────────────────────────
// src/routes/users.js
// ─────────────────────────────────────────────────────────
