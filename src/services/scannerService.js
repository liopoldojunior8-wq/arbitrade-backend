// src/services/scannerService.js
// ─────────────────────────────────────────────────────────
//  Core arbitrage detection engine
// ─────────────────────────────────────────────────────────
const axios  = require("axios");
const { prisma } = require("../utils/prisma");
const { getCache, setCache } = require("../utils/redis");
const logger = require("../utils/logger");

const FEES = {
  AMAZON:    0.15, // 15% referral fee
  EBAY:      0.13,
  ETSY:      0.065,
  WALMART:   0.12,
  DEFAULT:   0.15,
};

const BASE_SHIPPING = {
  Electronics: 12, Fashion: 6, Home: 18, Toys: 8, Kitchen: 14, DEFAULT: 10,
};

/* ── Calculate arbitrage metrics ─────────────────────────── */
function calcArbitrage(buyPrice, sellPrice, sellMarketplace, category) {
  const feeRate  = FEES[sellMarketplace] || FEES.DEFAULT;
  const fees     = sellPrice * feeRate;
  const shipping = BASE_SHIPPING[category] || BASE_SHIPPING.DEFAULT;
  const gross    = sellPrice - buyPrice;
  const net      = gross - fees - shipping;
  const roi      = buyPrice > 0 ? (net / buyPrice) * 100 : 0;
  return { fees: +fees.toFixed(2), shipping, gross: +gross.toFixed(2), net: +net.toFixed(2), roi: +roi.toFixed(1) };
}

/* ── AI Score (rule-based, replace with ML model later) ─── */
function calcAIScore(roi, volume, priceDrop, inStock) {
  let score = 40;
  if (roi > 50)  score += 30;
  else if (roi > 30) score += 20;
  else if (roi > 15) score += 10;
  if (volume > 500)   score += 15;
  else if (volume > 200) score += 8;
  if (priceDrop > 10) score += 10;
  if (inStock)        score += 5;
  return Math.min(score, 99);
}

/* ── Amazon Product Advertising API ─────────────────────── */
async function fetchAmazonPrice(asin) {
  const cacheKey = `amazon:${asin}`;
  const cached   = await getCache(cacheKey);
  if (cached) return cached;

  try {
    // Production: use amazon-paapi npm package
    // Docs: https://webservices.amazon.com/paapi5/documentation
    const result = {
      asin,
      name:  "Amazon Product",
      price: null, // fetch from API
      inStock: true,
      url: `https://amazon.com/dp/${asin}`,
    };
    await setCache(cacheKey, result, 1800); // cache 30min
    return result;
  } catch (err) {
    logger.warn(`Amazon fetch failed for ${asin}: ${err.message}`);
    return null;
  }
}

/* ── eBay Browse API ─────────────────────────────────────── */
async function fetchEbayPrice(query) {
  const cacheKey = `ebay:${query}`;
  const cached   = await getCache(cacheKey);
  if (cached) return cached;

  try {
    const token = await getEbayToken();
    const res = await axios.get(
      "https://api.ebay.com/buy/browse/v1/item_summary/search",
      {
        params: { q: query, limit: 5, filter: "buyingOptions:{FIXED_PRICE}" },
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const items = res.data.itemSummaries || [];
    const result = items.map(i => ({
      id: i.itemId,
      name: i.title,
      price: parseFloat(i.price?.value || 0),
      currency: i.price?.currency,
      url: i.itemWebUrl,
      inStock: true,
    }));

    await setCache(cacheKey, result, 1800);
    return result;
  } catch (err) {
    logger.warn(`eBay fetch failed: ${err.message}`);
    return [];
  }
}

async function getEbayToken() {
  const cached = await getCache("ebay:token");
  if (cached) return cached;

  const res = await axios.post(
    "https://api.ebay.com/identity/v1/oauth2/token",
    "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope/buy.item.feed",
    {
      auth: {
        username: process.env.EBAY_APP_ID,
        password: process.env.EBAY_CERT_ID,
      },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );
  const token = res.data.access_token;
  await setCache("ebay:token", token, res.data.expires_in - 60);
  return token;
}

/* ── Walmart Open API ────────────────────────────────────── */
async function fetchWalmartPrice(query) {
  const cacheKey = `walmart:${query}`;
  const cached   = await getCache(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(
      `https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search`,
      {
        params: { query, numItems: 5, format: "json" },
        headers: {
          "WM_SEC.KEY_VERSION": "1",
          "WM_CONSUMER.ID": process.env.WALMART_CLIENT_ID,
          "WM_CONSUMER.INTIMESTAMP": Date.now().toString(),
        },
      }
    );

    const items = (res.data.items || []).map(i => ({
      id: i.itemId,
      name: i.name,
      price: i.salePrice || i.msrp,
      url: i.productUrl,
      inStock: i.availableOnline,
    }));

    await setCache(cacheKey, items, 1800);
    return items;
  } catch (err) {
    logger.warn(`Walmart fetch failed: ${err.message}`);
    return [];
  }
}

/* ── Main Scan Function ──────────────────────────────────── */
async function scanArbitrageOpportunities({ query, buyMarketplace, sellMarketplace, minROI = 10, userId }) {
  const jobStart = Date.now();

  // Create scan job record
  const job = await prisma.scanJob.create({
    data: { marketplace: buyMarketplace || "AMAZON", status: "RUNNING" },
  });

  const results = [];

  try {
    let buyProducts = [];

    // Fetch from buy marketplace
    if (buyMarketplace === "AMAZON" || !buyMarketplace) {
      if (query.match(/^B[A-Z0-9]{9}$/i)) {
        const p = await fetchAmazonPrice(query.toUpperCase());
        if (p) buyProducts.push({ ...p, marketplace: "AMAZON" });
      } else {
        // For non-ASIN queries, search product DB
        const dbProducts = await prisma.product.findMany({
          where: {
            name: { contains: query, mode: "insensitive" },
            marketplace: buyMarketplace || undefined,
          },
          take: 20,
        });
        buyProducts = dbProducts.map(p => ({
          id: p.id, name: p.name, price: p.currentPrice,
          marketplace: p.marketplace, category: p.category, inStock: p.inStock,
        }));
      }
    }

    // If no products from API, fall back to DB
    if (buyProducts.length === 0) {
      const dbProducts = await prisma.product.findMany({
        where: {
          name: { contains: query || "", mode: "insensitive" },
          marketplace: buyMarketplace || undefined,
        },
        take: 20,
        include: { priceHistory: { orderBy: { recordedAt: "desc" }, take: 7 } },
      });

      for (const bp of dbProducts) {
        const sellProducts = await prisma.product.findMany({
          where: {
            name: { contains: bp.name.split(" ").slice(0, 3).join(" "), mode: "insensitive" },
            marketplace: sellMarketplace || undefined,
            NOT: { id: bp.id },
          },
          take: 3,
        });

        for (const sp of sellProducts) {
          const metrics = calcArbitrage(bp.currentPrice, sp.currentPrice, sp.marketplace, bp.category);
          if (metrics.roi < minROI || metrics.net <= 0) continue;

          // Price trend (drop in last 7 days)
          const prices = bp.priceHistory.map(h => h.price);
          const priceDrop = prices.length > 1 ? ((prices[prices.length-1] - prices[0]) / prices[0]) * -100 : 0;
          const aiScore   = calcAIScore(metrics.roi, bp.rating * 100 || 200, priceDrop, bp.inStock);

          results.push({
            id: `${bp.id}-${sp.id}`,
            buyProduct:  { id: bp.id, name: bp.name, marketplace: bp.marketplace, price: bp.currentPrice, asin: bp.externalId, category: bp.category, imageUrl: bp.imageUrl },
            sellProduct: { id: sp.id, name: sp.name, marketplace: sp.marketplace, price: sp.currentPrice },
            ...metrics,
            aiScore,
            aiRiskLevel: aiScore >= 85 ? "LOW" : aiScore >= 70 ? "MEDIUM" : "HIGH",
            priceHistory: prices,
          });

          // Persist opportunity
          await prisma.arbitrageOpportunity.upsert({
            where: { id: `${bp.id}-${sp.id}` },
            create: {
              id: `${bp.id}-${sp.id}`,
              buyProductId: bp.id, sellProductId: sp.id,
              buyPrice: bp.currentPrice, sellPrice: sp.currentPrice,
              estimatedFees: metrics.fees, estimatedShipping: metrics.shipping,
              grossProfit: metrics.gross, netProfit: metrics.net, roi: metrics.roi,
              aiScore, aiRiskLevel: aiScore >= 85 ? "LOW" : aiScore >= 70 ? "MEDIUM" : "HIGH",
              isActive: true,
              expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            },
            update: {
              buyPrice: bp.currentPrice, sellPrice: sp.currentPrice,
              netProfit: metrics.net, roi: metrics.roi, aiScore, isActive: true,
            },
          }).catch(() => {}); // ignore unique constraint issues
        }
      }
    }

    // Sort by AI score
    results.sort((a, b) => b.aiScore - a.aiScore);

    // Update scan job
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "DONE", productsScanned: buyProducts.length, oppsFound: results.length, durationMs: Date.now() - jobStart, finishedAt: new Date() },
    });

    return results;
  } catch (err) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: err.message, finishedAt: new Date() },
    });
    throw err;
  }
}

module.exports = { scanArbitrageOpportunities, calcArbitrage, calcAIScore, fetchAmazonPrice, fetchEbayPrice };
