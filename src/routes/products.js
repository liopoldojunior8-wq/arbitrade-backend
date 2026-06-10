// src/routes/products.js
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const { prisma } = require("../utils/prisma");

router.get("/", authenticate, async (req, res) => {
  const { q, category, marketplace, page = 1, limit = 20 } = req.query;
  const where = {};
  if (q)           where.name        = { contains: q, mode: "insensitive" };
  if (category)    where.category    = category;
  if (marketplace) where.marketplace = marketplace;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where, orderBy: { updatedAt: "desc" },
      skip: (page - 1) * parseInt(limit), take: parseInt(limit),
      include: { priceHistory: { orderBy: { recordedAt: "desc" }, take: 7 } },
    }),
    prisma.product.count({ where }),
  ]);
  res.json({ products, total });
});

router.get("/:id", authenticate, async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { priceHistory: { orderBy: { recordedAt: "asc" }, take: 90 } },
  });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json({ product });
});

router.post("/:id/track", authenticate, async (req, res) => {
  const isPro = ["PRO","ENTERPRISE"].includes(req.user.subscription?.plan);
  if (!isPro) {
    const count = await prisma.trackedProduct.count({ where: { userId: req.user.id } });
    if (count >= 5) {
      return res.status(403).json({ error: "Free plan limit: 5 products. Upgrade to Pro for unlimited tracking." });
    }
  }
  const tracked = await prisma.trackedProduct.upsert({
    where:  { userId_productId: { userId: req.user.id, productId: req.params.id } },
    create: { userId: req.user.id, productId: req.params.id, targetPrice: req.body.targetPrice },
    update: { targetPrice: req.body.targetPrice },
  });
  res.json({ tracked });
});

router.delete("/:id/track", authenticate, async (req, res) => {
  await prisma.trackedProduct.deleteMany({
    where: { userId: req.user.id, productId: req.params.id },
  });
  res.json({ success: true });
});

module.exports = router;
