// src/routes/webhooks.js
// Handles PayPal webhook events
const router = require("express").Router();
const { prisma } = require("../utils/prisma");
const { activateSubscription } = require("../services/paymentService");
const logger = require("../utils/logger");

router.post("/paypal", async (req, res) => {
  // Always respond 200 immediately
  res.sendStatus(200);

  try {
    const event = JSON.parse(req.body.toString());
    logger.info(`PayPal webhook: ${event.event_type}`);

    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
        if (orderId) {
          const payment = await prisma.payment.findFirst({ where: { reference: orderId } });
          if (payment && payment.status !== "COMPLETED") {
            await prisma.payment.update({ where: { id: payment.id }, data: { status: "COMPLETED", paidAt: new Date() } });
            const meta = payment.metadata;
            await activateSubscription(payment.userId, meta.plan, meta.billing);
          }
        }
        break;
      }
      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.REVERSED": {
        const orderId = event.resource?.id;
        if (orderId) {
          await prisma.payment.updateMany({ where: { reference: orderId }, data: { status: "FAILED" } });
        }
        break;
      }
    }
  } catch (err) {
    logger.error("PayPal webhook error:", err.message);
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────
// src/routes/products.js — (standalone export)
// ─────────────────────────────────────────────────────────
