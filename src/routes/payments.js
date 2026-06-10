// src/routes/payments.js
const router = require("express").Router();
const { body, validationResult } = require("express-validator");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { paypal, mpesa, bankTransfer, PLAN_PRICES } = require("../services/paymentService");
const { prisma } = require("../utils/prisma");

/* ── GET /api/payments/plans ─────────────────────────────
   Returns pricing for all plans (no auth needed)           */
router.get("/plans", (req, res) => {
  res.json({
    plans: [
      {
        key: "FREE",
        name: "Free",
        price: { monthly: 0, yearly: 0 },
        features: ["5 products", "Hourly updates", "Email alerts", "Basic dashboard"],
      },
      {
        key: "PRO",
        name: "Pro",
        price: PLAN_PRICES.PRO,
        features: ["Unlimited products", "Real-time updates", "All alert channels", "AI scanner", "API access"],
      },
      {
        key: "ENTERPRISE",
        name: "Enterprise",
        price: PLAN_PRICES.ENTERPRISE,
        features: ["Everything in Pro", "White-label", "Unlimited API", "Dedicated manager", "10 team seats"],
      },
    ],
    methods: ["PAYPAL", "MPESA", "BANK_TRANSFER"],
    note: "M-Pesa accepts MZN. Bank Transfer accepts USD/MZN. PayPal accepts USD.",
  });
});

/* ── GET /api/payments/my ────────────────────────────────
   Current user's payment history                          */
router.get("/my", authenticate, async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ payments });
});

/* ══════════════════════════════════════════════════════════
   PAYPAL
══════════════════════════════════════════════════════════ */

/* POST /api/payments/paypal/create-order */
router.post("/paypal/create-order", authenticate, [
  body("plan").isIn(["PRO", "ENTERPRISE"]),
  body("billing").isIn(["monthly", "yearly"]),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { plan, billing } = req.body;
  const amount = PLAN_PRICES[plan][billing];

  try {
    const result = await paypal.createOrder({
      amount,
      currency: "USD",
      description: `ArbitrageAI ${plan} Plan (${billing})`,
      userId: req.user.id,
      plan,
      billing,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/payments/paypal/capture/:orderId */
router.post("/paypal/capture/:orderId", authenticate, async (req, res) => {
  try {
    const result = await paypal.captureOrder(req.params.orderId);
    if (result.success) {
      res.json({ success: true, message: "Payment confirmed. Your plan is now active!" });
    } else {
      res.status(400).json({ error: "Payment capture failed", status: result.status });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   M-PESA
══════════════════════════════════════════════════════════ */

/* POST /api/payments/mpesa/pay */
router.post("/mpesa/pay", authenticate, [
  body("phone").notEmpty().withMessage("Phone number required"),
  body("plan").isIn(["PRO", "ENTERPRISE"]),
  body("billing").isIn(["monthly", "yearly"]),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { phone, plan, billing } = req.body;

  // Convert USD to MZN (approximate — use live rate in production)
  const USD_TO_MZN = 63.5;
  const amountUSD  = PLAN_PRICES[plan][billing];
  const amountMZN  = Math.round(amountUSD * USD_TO_MZN);

  try {
    const result = await mpesa.initiatePayment({
      phone,
      amount: amountMZN,
      reference: `ARB${Date.now()}`,
      userId: req.user.id,
      plan,
      billing,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/payments/mpesa/callback — called by M-Pesa servers */
router.post("/mpesa/callback", async (req, res) => {
  // Always respond 200 immediately to M-Pesa
  res.status(200).json({ output_ResponseCode: "INS-0", output_ResponseDesc: "Accepted" });
  try {
    await mpesa.handleCallback(req.body);
  } catch (err) {
    console.error("M-Pesa callback error:", err);
  }
});

/* GET /api/payments/mpesa/status/:reference */
router.get("/mpesa/status/:reference", authenticate, async (req, res) => {
  const payment = await prisma.payment.findFirst({
    where: { reference: req.params.reference, userId: req.user.id },
  });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json({ status: payment.status, paidAt: payment.paidAt });
});

/* ══════════════════════════════════════════════════════════
   BANK TRANSFER
══════════════════════════════════════════════════════════ */

/* POST /api/payments/bank/instructions */
router.post("/bank/instructions", authenticate, [
  body("plan").isIn(["PRO", "ENTERPRISE"]),
  body("billing").isIn(["monthly", "yearly"]),
  body("currency").optional().isIn(["USD", "MZN"]),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { plan, billing, currency = "USD" } = req.body;
  try {
    const result = await bankTransfer.createInstruction({
      userId: req.user.id,
      plan, billing, currency,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── ADMIN: Confirm bank transfer ────────────────────────── */
/* POST /api/payments/bank/confirm (admin only) */
router.post("/bank/confirm", authenticate, requireAdmin, [
  body("reference").notEmpty(),
  body("note").optional().isString(),
], async (req, res) => {
  const { reference, note } = req.body;
  try {
    await bankTransfer.confirmTransfer(reference, note);
    res.json({ success: true, message: `Payment ${reference} confirmed and subscription activated.` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ── ADMIN: List all payments ────────────────────────────── */
router.get("/admin/all", authenticate, requireAdmin, async (req, res) => {
  const { status, method, page = 1, limit = 50 } = req.query;
  const where = {};
  if (status) where.status = status;
  if (method) where.method = method;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { user: { select: { id:true, name:true, email:true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: parseInt(limit),
    }),
    prisma.payment.count({ where }),
  ]);

  res.json({ payments, total, page: parseInt(page), pages: Math.ceil(total / limit) });
});

module.exports = router;
