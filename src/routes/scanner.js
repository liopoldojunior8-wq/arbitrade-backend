// src/routes/scanner.js
const router = require(express).Router();
const { authenticate, requirePro } = require(../middleware/auth);
const { scanArbitrageOpportunities } = require(../services/scannerService);
const { prisma } = require(../utils/prisma);

router.get(/opportunities, authenticate, async (req, res) => {
  const { minROI = 10, page = 1, limit = 20 } = req.query;
  const isPro = [PRO,ENTERPRISE].includes(req.user.subscription?.plan);
  const take = isPro ? parseInt(limit) : 5;
  const opps = await prisma.arbitrageOpportunity.findMany({
    where: { isActive: true, roi: { gte: parseFloat(minROI) } },
    orderBy: { aiScore: desc },
    skip: (page - 1) * take, take,
    include: {
      buyProduct:  { select: { name:true, marketplace:true, currentPrice:true, category:true, externalId:true } },
      sellProduct: { select: { name:true, marketplace:true, currentPrice:true } },
    },
  });
  res.json({ opportunities: opps, isPro });
});

router.post(/scan, authenticate, requirePro, async (req, res) => {
  const { query = ", buyMarketplace, sellMarketplace, minROI = 10 } = req.body;
  try {
    const results = await scanArbitrageOpportunities({ query, buyMarketplace, sellMarketplace, minROI, userId: req.user.id });
    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
