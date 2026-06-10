// src/routes/scanner.js
const router = require("express").Router();
const { authenticate, requirePro } = require("../middleware/auth");
const { scanArbitrageOpportunities } = require("../services/scannerService");
const { prisma } = require("../utils/prisma");

// GET /api/scanner/opportunities — top opportunities (free: limit 5, pro: unlimited)
router.get("/opportunities", authenticate, async (req, res) => {
  const { category, minROI = 10, page = 1, limit = 20 } = req.query;
  const isPro = ["PRO","ENTERPRISE"].includes(req.user.subscription?.plan);
  const take  = isPro ? parseInt(limit) : 5;

  const where = { isActive: true, roi: { gte: parseFloat(minROI) } };
  if (category) {
    where.buyProduct = { category };
  }

  const [opps, total] = await Promise.all([
    prisma.arbitrageOpportunity.findMany({
      where,
      orderBy: { aiScore: "desc" },
      skip: (page - 1) * take,
      take,
      include: {
        buyProduct:  { select: { name:true, marketplace:true, currentPrice:true, category:true, imageUrl:true, externalId:true } },
        sellProduct: { select: { name:true, marketplace:true, currentPrice:true } },
      },
    }),
    prisma.arbitrageOpportunity.count({ where }),
  ]);

  res.json({ opportunities: opps, total, page: parseInt(page), isPro });
});

// POST /api/scanner/scan — run a new scan (PRO only)
router.post("/scan", authenticate, requirePro, async (req, res) => {
  const { query = "", buyMarketplace, sellMarketplace, minROI = 10 } = req.body;
  try {
    const results = await scanArbitrageOpportunities({
      query, buyMarketplace, sellMarketplace, minROI, userId: req.user.id,
    });
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────
// src/routes/products.js
// ─────────────────────────────────────────────────────────
const productsRouter = require("express").Router();
const { authenticate, requirePro: requireProP } = require("../middleware/auth");
const { prisma: db } = require("../utils/prisma");

productsRouter.get("/", authenticate, async (req, res) => {
  const { q, category, marketplace, page = 1, limit = 20 } = req.query;
  const where = {};
  if (q)           where.name       = { contains: q, mode: "insensitive" };
  if (category)    where.category   = category;
  if (marketplace) where.marketplace = marketplace;

  const [products, total] = await Promise.all([
    db.product.findMany({
      where, orderBy: { updatedAt: "desc" },
      skip: (page - 1) * parseInt(limit), take: parseInt(limit),
      include: { priceHistory: { orderBy: { recordedAt: "desc" }, take: 7 } },
    }),
    db.product.count({ where }),
  ]);
  res.json({ products, total });
});

productsRouter.get("/:id/history", authenticate, async (req, res) => {
  const history = await db.priceHistory.findMany({
    where: { productId: req.params.id },
    orderBy: { recordedAt: "asc" },
    take: 90,
  });
  res.json({ history });
});

productsRouter.post("/:id/track", authenticate, async (req, res) => {
  const isPro = ["PRO","ENTERPRISE"].includes(req.user.subscription?.plan);
  if (!isPro) {
    const count = await db.trackedProduct.count({ where: { userId: req.user.id } });
    if (count >= 5) return res.status(403).json({ error: "Free plan limit: 5 products. Upgrade to Pro." });
  }
  const tracked = await db.trackedProduct.upsert({
    where:  { userId_productId: { userId: req.user.id, productId: req.params.id } },
    create: { userId: req.user.id, productId: req.params.id, targetPrice: req.body.targetPrice },
    update: { targetPrice: req.body.targetPrice },
  });
  res.json({ tracked });
});

module.exports = { scannerRouter: router, productsRouter };
