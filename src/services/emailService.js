// src/services/emailService.js (versão final)
const nodemailer = require("nodemailer");
const templates  = require("./emailTemplates");
const logger     = require("../utils/logger");

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const FROM = process.env.EMAIL_FROM || "ArbitrageAI <noreply@arbitrageai.com>";

async function send(to, subject, html) {
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info(`Email sent: "${subject}" → ${to}`);
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
  }
}

module.exports = {
  send,
  sendWelcome:   (u)       => send(u.email, "Welcome to ArbitrageAI ⚡",           templates.welcome(u)),
  sendVerification:(u,tok) => send(u.email, "Verify your ArbitrageAI email 📧",    templates.verification(u, tok)),
  sendPasswordReset:(u,tok)=> send(u.email, "Reset your ArbitrageAI password 🔐",  templates.passwordReset(u, tok)),
  sendPaymentConfirmation:(u,p) => send(u.email, `Payment Confirmed — ArbitrageAI ${p.metadata?.plan||""} Plan ✓`, templates.paymentConfirmed(u, p)),
  sendBankTransferInstructions:(u,i) => send(u.email, "Bank Transfer Instructions — ArbitrageAI 🏦", templates.bankTransfer(u, i)),
  sendArbitrageAlert:(u,opp) => send(u.email, `🔥 New Arbitrage: +$${opp.netProfit?.toFixed(0)} profit detected`, templates.arbitrageAlert(u, opp)),
};
