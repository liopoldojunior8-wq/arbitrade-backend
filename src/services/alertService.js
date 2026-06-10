// src/services/alertService.js
const axios  = require("axios");
const { prisma }  = require("../utils/prisma");
const emailService = require("./emailService");
const logger = require("../utils/logger");

async function dispatch(alert) {
  try {
    switch (alert.channel) {
      case "EMAIL":
        await dispatchEmail(alert);
        break;
      case "TELEGRAM":
        await dispatchTelegram(alert);
        break;
      case "WHATSAPP":
        await dispatchWhatsApp(alert);
        break;
      default:
        logger.warn(`Unknown alert channel: ${alert.channel}`);
    }

    await prisma.alert.update({
      where: { id: alert.id },
      data: { sent: true, sentAt: new Date() },
    });
  } catch (err) {
    logger.error(`Alert dispatch failed (${alert.id}):`, err.message);
    await prisma.alert.update({
      where: { id: alert.id },
      data: { error: err.message },
    });
  }
}

async function dispatchEmail(alert) {
  if (!alert.user?.email) return;
  await emailService.send(
    alert.user.email,
    alert.title,
    `<div style="background:#080e1a;color:#e2e8f0;padding:24px;font-family:sans-serif;">
      <h3 style="color:#818cf8;">⚡ ${alert.title}</h3>
      <p>${alert.message}</p>
      <a href="${process.env.FRONTEND_URL}/scanner" style="color:#6366f1;">View opportunities →</a>
    </div>`
  );
}

async function dispatchTelegram(alert) {
  if (!alert.user?.telegramId || !process.env.TELEGRAM_BOT_TOKEN) return;
  const text = `⚡ *ArbitrageAI Alert*\n\n*${alert.title}*\n${alert.message}\n\n[View Dashboard](${process.env.FRONTEND_URL})`;
  await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: alert.user.telegramId,
    text,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🔍 View Opportunity", url: `${process.env.FRONTEND_URL}/scanner` }]],
    },
  });
}

async function dispatchWhatsApp(alert) {
  if (!alert.user?.phone || !process.env.WHATSAPP_API_KEY) return;
  await axios.post(
    `${process.env.WHATSAPP_API_URL}`,
    {
      to: alert.user.phone.replace(/^\+/, ""),
      type: "text",
      text: { body: `⚡ ArbitrageAI\n\n${alert.title}\n${alert.message}\n\n${process.env.FRONTEND_URL}` },
    },
    { headers: { "D360-API-KEY": process.env.WHATSAPP_API_KEY, "Content-Type": "application/json" } }
  );
}

// Create and queue a new alert
async function createAlert({ userId, channel, type, title, message, opportunityId, data }) {
  return prisma.alert.create({
    data: { userId, channel, type, title, message, opportunityId, data, sent: false },
  });
}

// Bulk create alerts for all PRO+ users matching a rule
async function broadcastOpportunity(opportunity) {
  const proUsers = await prisma.user.findMany({
    where: {
      subscription: { plan: { in: ["PRO", "ENTERPRISE"] }, status: "ACTIVE" },
    },
    include: { subscription: true },
  });

  const alerts = proUsers.map(u => ({
    userId: u.id,
    channel: "EMAIL",
    type: "ARBITRAGE",
    title: `🔥 New Arbitrage: +$${opportunity.netProfit?.toFixed(0)} profit`,
    message: `${opportunity.buyProduct?.name || "Product"} — Buy at $${opportunity.buyPrice} on ${opportunity.buyProduct?.marketplace}, sell at $${opportunity.sellPrice} on ${opportunity.sellProduct?.marketplace}. ROI: ${opportunity.roi?.toFixed(1)}%`,
    opportunityId: opportunity.id,
    sent: false,
  }));

  if (alerts.length > 0) {
    await prisma.alert.createMany({ data: alerts, skipDuplicates: true });
    logger.info(`[ALERT] Queued ${alerts.length} alerts for opportunity ${opportunity.id}`);
  }
}

module.exports = { dispatch, createAlert, broadcastOpportunity };
