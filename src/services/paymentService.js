// src/services/paymentService.js
// ─────────────────────────────────────────────────────────
//  Handles: PayPal Orders, M-Pesa (Daraja), Bank Transfer
// ─────────────────────────────────────────────────────────
const axios  = require("axios");
const { prisma } = require("../utils/prisma");
const logger = require("../utils/logger");
const emailService = require("./emailService");

/* ── PLAN PRICES (USD) ───────────────────────────────────── */
const PLAN_PRICES = {
  PRO:        { monthly: 49,  yearly: 34  },
  ENTERPRISE: { monthly: 299, yearly: 209 },
};

/* ══════════════════════════════════════════════════════════
   PAYPAL
══════════════════════════════════════════════════════════ */
class PayPalService {
  constructor() {
    this.baseURL = process.env.PAYPAL_MODE === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  }

  async getAccessToken() {
    const res = await axios.post(
      `${this.baseURL}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: process.env.PAYPAL_CLIENT_ID,
          password: process.env.PAYPAL_CLIENT_SECRET,
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    return res.data.access_token;
  }

  // Create a one-time PayPal order (used for bank payment or one-off sub)
  async createOrder({ amount, currency = "USD", description, userId, plan, billing }) {
    const token = await this.getAccessToken();
    const res = await axios.post(
      `${this.baseURL}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: currency, value: amount.toFixed(2) },
          description,
          custom_id: JSON.stringify({ userId, plan, billing }),
        }],
        application_context: {
          brand_name: "ArbitrageAI",
          return_url: `${process.env.FRONTEND_URL}/payment/success`,
          cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
        },
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    // Persist pending payment
    await prisma.payment.create({
      data: {
        userId,
        method: "PAYPAL",
        status: "PENDING",
        amount,
        currency,
        reference: res.data.id,
        description,
        metadata: { plan, billing },
      },
    });

    const approvalUrl = res.data.links.find(l => l.rel === "approve")?.href;
    return { orderId: res.data.id, approvalUrl };
  }

  // Capture payment after user approves on PayPal
  async captureOrder(orderId) {
    const token = await this.getAccessToken();
    const res = await axios.post(
      `${this.baseURL}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    if (res.data.status === "COMPLETED") {
      const payment = await prisma.payment.update({
        where: { reference: orderId },
        data: { status: "COMPLETED", paidAt: new Date() },
        include: { user: true },
      });

      const meta = payment.metadata;
      await activateSubscription(payment.userId, meta.plan, meta.billing);
      await emailService.sendPaymentConfirmation(payment.user, payment);

      logger.info(`PayPal payment captured: ${orderId}`);
      return { success: true, payment };
    }

    return { success: false, status: res.data.status };
  }
}

/* ══════════════════════════════════════════════════════════
   M-PESA (Vodacom Mozambique — Daraja API)
══════════════════════════════════════════════════════════ */
class MPesaService {
  constructor() {
    this.baseURL = process.env.MPESA_ENV === "production"
      ? "https://api.mpesa.vod.co.mz"
      : "https://api.sandbox.vm.co.mz";
  }

  // Generate Bearer token using API Key + Public Key
  getToken() {
    const crypto = require("crypto");
    const apiKey    = process.env.MPESA_API_KEY;
    const publicKey = process.env.MPESA_PUBLIC_KEY;

    const buffer = Buffer.from(publicKey, "base64");
    const encrypted = crypto.publicEncrypt(
      { key: buffer, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(apiKey)
    );
    return encrypted.toString("base64");
  }

  // Initiate C2B (Customer to Business) payment
  async initiatePayment({ phone, amount, reference, userId, plan, billing }) {
    // Normalize phone: 258841234567
    const normalizedPhone = phone.replace(/^\+/, "").replace(/^0/, "258");

    try {
      const token = this.getToken();
      const transactionRef = reference || `ARB${Date.now()}`;

      const res = await axios.post(
        `${this.baseURL}/ipg/v1x/c2bPayment/singleStage/`,
        {
          input_TransactionReference: transactionRef,
          input_CustomerMSISDN: normalizedPhone,
          input_Amount: amount.toFixed(2),
          input_ThirdPartyReference: transactionRef,
          input_ServiceProviderCode: process.env.MPESA_SERVICE_PROVIDER_CODE,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Origin: process.env.FRONTEND_URL,
          },
        }
      );

      const conversationId = res.data?.output_ConversationID;

      await prisma.payment.create({
        data: {
          userId,
          method: "MPESA",
          status: "PENDING",
          amount,
          currency: "MZN",
          reference: conversationId || transactionRef,
          description: `ArbitrageAI ${plan} Plan`,
          metadata: { plan, billing, phone: normalizedPhone, transactionRef },
        },
      });

      logger.info(`M-Pesa payment initiated: ${conversationId} for ${normalizedPhone}`);
      return {
        success: true,
        conversationId,
        message: "Payment request sent. Check your phone and enter your M-Pesa PIN.",
      };
    } catch (err) {
      logger.error("M-Pesa error:", err.response?.data || err.message);
      throw new Error(err.response?.data?.output_error || "M-Pesa payment failed");
    }
  }

  // Callback from M-Pesa when payment is confirmed
  async handleCallback(data) {
    const { output_TransactionID, output_ConversationID, output_ResponseCode } = data;

    if (output_ResponseCode === "INS-0") {
      // Success
      const payment = await prisma.payment.updateMany({
        where: { reference: output_ConversationID },
        data: { status: "COMPLETED", paidAt: new Date() },
      });

      const p = await prisma.payment.findFirst({
        where: { reference: output_ConversationID },
        include: { user: true },
      });

      if (p) {
        const meta = p.metadata;
        await activateSubscription(p.userId, meta.plan, meta.billing);
        await emailService.sendPaymentConfirmation(p.user, p);
        logger.info(`M-Pesa confirmed: ${output_TransactionID}`);
      }
    } else {
      await prisma.payment.updateMany({
        where: { reference: output_ConversationID },
        data: { status: "FAILED" },
      });
      logger.warn(`M-Pesa failed: code ${output_ResponseCode}`);
    }
  }
}

/* ══════════════════════════════════════════════════════════
   BANK TRANSFER
══════════════════════════════════════════════════════════ */
class BankTransferService {
  // Generate bank transfer instructions + pending payment record
  async createInstruction({ userId, plan, billing, currency = "USD" }) {
    const amount = PLAN_PRICES[plan]?.[billing];
    if (!amount) throw new Error("Invalid plan or billing");

    const reference = `ARB-${userId.slice(0,6).toUpperCase()}-${Date.now()}`;

    const payment = await prisma.payment.create({
      data: {
        userId,
        method: "BANK_TRANSFER",
        status: "PENDING",
        amount,
        currency,
        reference,
        description: `ArbitrageAI ${plan} - ${billing}`,
        metadata: { plan, billing },
      },
      include: { user: true },
    });

    const instructions = {
      reference,
      amount: `${currency} ${amount.toFixed(2)}`,
      bankName:      process.env.BANK_NAME,
      accountName:   process.env.BANK_ACCOUNT_NAME,
      accountNumber: process.env.BANK_ACCOUNT_NUMBER,
      branch:        process.env.BANK_BRANCH,
      swift:         process.env.BANK_SWIFT,
      iban:          process.env.BANK_IBAN,
      instructions:  `Use the reference "${reference}" as payment description. Send proof to support@arbitrageai.com`,
    };

    // Email instructions to user
    await emailService.sendBankTransferInstructions(payment.user, instructions);

    logger.info(`Bank transfer instructions created: ${reference}`);
    return { success: true, reference, instructions };
  }

  // Admin manually confirms a bank transfer
  async confirmTransfer(reference, adminNote) {
    const payment = await prisma.payment.findUnique({
      where: { reference },
      include: { user: true },
    });

    if (!payment) throw new Error("Payment not found");

    await prisma.payment.update({
      where: { reference },
      data: { status: "COMPLETED", paidAt: new Date(), description: adminNote || payment.description },
    });

    const meta = payment.metadata;
    await activateSubscription(payment.userId, meta.plan, meta.billing);
    await emailService.sendPaymentConfirmation(payment.user, payment);

    logger.info(`Bank transfer confirmed by admin: ${reference}`);
    return { success: true };
  }
}

/* ══════════════════════════════════════════════════════════
   SHARED UTILITY: Activate / Update Subscription
══════════════════════════════════════════════════════════ */
async function activateSubscription(userId, plan, billing) {
  const months = billing === "yearly" ? 12 : 1;
  const now    = new Date();
  const end    = new Date(now);
  end.setMonth(end.getMonth() + months);

  await prisma.subscription.upsert({
    where:  { userId },
    create: { userId, plan, status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: end },
    update: { plan, status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: end },
  });

  logger.info(`Subscription activated: user=${userId} plan=${plan} until=${end.toISOString()}`);
}

/* ══════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════ */
module.exports = {
  paypal:       new PayPalService(),
  mpesa:        new MPesaService(),
  bankTransfer: new BankTransferService(),
  PLAN_PRICES,
  activateSubscription,
};
