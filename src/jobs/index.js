// src/jobs/index.js
// ─────────────────────────────────────────────────────────
//  Background Jobs (node-cron)
//  - Price scraping every 30min
//  - Opportunity detection every hour
//  - Alert dispatching every 5min
//  - Subscription expiry check daily
// ─────────────────────────────────────────────────────────
const cron   = require("node-cron");
const { prisma }  = require("../utils/prisma");
const logger      = require("../utils/logger");
const alertService = require("../services/alertService");

/* ── JOB 1: Update prices every 30 minutes ─────────────── */
async function jobUpdatePrices() {
  logger.info("[JOB] Starting price update scan...");
  try {
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { lastScraped: null },
          { lastScraped: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
        ],
      },
      take: 100, // process in batches
    });

    logger.info(`[JOB] Updating prices for ${products.length} products`);

    for (const product of products) {
      try {
        // In production: call the real marketplace APIs here
        // const newPrice = await fetchPriceFromMarketplace(product);

        // Simulate price fluctuation for development
        const fluctuation = (Math.random() - 0.48) * 0.02;
        const newPrice = +(product.currentPrice * (1 + fluctuation)).toFixed(2);

        await prisma.$transaction([
          prisma.product.update({
            where: { id: product.id },
            data: { currentPrice: newPrice, lastScraped: new Date() },
          }),
          prisma.priceHistory.create({
            data: { productId: product.id, price: newPrice, inStock: product.inStock },
          }),
        ]);
      } catch (err) {
        logger.warn(`[JOB] Failed to update price for ${product.id}: ${err.message}`);
      }
    }

    logger.info("[JOB] Price update complete");
  } catch (err) {
    logger.error("[JOB] Price update failed:", err.message);
  }
}

/* ── JOB 2: Detect new arbitrage opportunities ──────────── */
async function jobDetectOpportunities() {
  logger.info("[JOB] Detecting arbitrage opportunities...");
  try {
    // Find products that exist on multiple marketplaces
    const productNames = await prisma.product.groupBy({
      by: ["name"],
      having: { name: { _count: { gt: 1 } } },
      take: 200,
    });

    let found = 0;
    for (const { name } of productNames) {
      const variants = await prisma.product.findMany({
        where: { name: { contains: name.split(" ").slice(0, 3).join(" "), mode: "insensitive" } },
      });

      for (let i = 0; i < variants.length; i++) {
        for (let j = i + 1; j < variants.length; j++) {
          const buy  = variants[i].currentPrice < variants[j].currentPrice ? variants[i] : variants[j];
          const sell = variants[i].currentPrice < variants[j].currentPrice ? variants[j] : variants[i];

          if (!buy.currentPrice || !sell.currentPrice) continue;

          const feeRate  = 0.13;
          const shipping = 12;
          const net = sell.currentPrice - buy.currentPrice - (sell.currentPrice * feeRate) - shipping;
          const roi = (net / buy.currentPrice) * 100;

          if (roi >= 10 && net >= 15) {
            found++;
            await prisma.arbitrageOpportunity.upsert({
              where: { id: `${buy.id}-${sell.id}` },
              create: {
                id: `${buy.id}-${sell.id}`,
                buyProductId: buy.id, sellProductId: sell.id,
                buyPrice: buy.currentPrice, sellPrice: sell.currentPrice,
                estimatedFees: +(sell.currentPrice * feeRate).toFixed(2),
                estimatedShipping: shipping,
                grossProfit: +(sell.currentPrice - buy.currentPrice).toFixed(2),
                netProfit: +net.toFixed(2), roi: +roi.toFixed(1),
                aiScore: Math.min(40 + Math.round(roi), 99),
                isActive: true,
                expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
              },
              update: {
                buyPrice: buy.currentPrice, sellPrice: sell.currentPrice,
                netProfit: +net.toFixed(2), roi: +roi.toFixed(1), isActive: true,
              },
            }).catch(() => {});
          }
        }
      }
    }

    logger.info(`[JOB] Found ${found} active opportunities`);
  } catch (err) {
    logger.error("[JOB] Opportunity detection failed:", err.message);
  }
}

/* ── JOB 3: Dispatch pending alerts ─────────────────────── */
async function jobDispatchAlerts() {
  try {
    const pending = await prisma.alert.findMany({
      where: { sent: false },
      include: {
        user: { select: { email:true, name:true, telegramId:true, phone:true } },
      },
      take: 100,
    });

    if (pending.length === 0) return;
    logger.info(`[JOB] Dispatching ${pending.length} alerts`);

    for (const alert of pending) {
      await alertService.dispatch(alert);
    }
  } catch (err) {
    logger.error("[JOB] Alert dispatch failed:", err.message);
  }
}

/* ── JOB 4: Check and expire subscriptions ──────────────── */
async function jobCheckSubscriptions() {
  logger.info("[JOB] Checking subscription expirations...");
  try {
    const expired = await prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        currentPeriodEnd: { lt: new Date() },
        plan: { not: "FREE" },
      },
      include: { user: true },
    });

    for (const sub of expired) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "PAST_DUE", plan: "FREE" },
      });

      // Notify user
      await prisma.alert.create({
        data: {
          userId: sub.userId,
          channel: "EMAIL",
          type: "TARGET_REACHED",
          title: "Subscription Expired",
          message: `Your ${sub.plan} plan has expired. Renew to continue accessing premium features.`,
        },
      });

      logger.info(`[JOB] Subscription expired for user ${sub.userId}`);
    }

    logger.info(`[JOB] Processed ${expired.length} expired subscriptions`);
  } catch (err) {
    logger.error("[JOB] Subscription check failed:", err.message);
  }
}

/* ── JOB 5: Clean up old price history ──────────────────── */
async function jobCleanupHistory() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days
  const result = await prisma.priceHistory.deleteMany({
    where: { recordedAt: { lt: cutoff } },
  });
  logger.info(`[JOB] Cleaned up ${result.count} old price records`);
}

/* ── REGISTER ALL JOBS ───────────────────────────────────── */
function startJobs() {
  // Every 30 minutes — price updates
  cron.schedule("*/30 * * * *", jobUpdatePrices);

  // Every hour — opportunity detection
  cron.schedule("0 * * * *", jobDetectOpportunities);

  // Every 5 minutes — alert dispatch
  cron.schedule("*/5 * * * *", jobDispatchAlerts);

  // Every day at 02:00 — subscription expiry check
  cron.schedule("0 2 * * *", jobCheckSubscriptions);

  // Every Sunday at 03:00 — history cleanup
  cron.schedule("0 3 * * 0", jobCleanupHistory);

  logger.info("📅 Cron jobs scheduled: prices(30m) | opportunities(1h) | alerts(5m) | subscriptions(daily) | cleanup(weekly)");
}

module.exports = { startJobs, jobUpdatePrices, jobDetectOpportunities, jobDispatchAlerts };
