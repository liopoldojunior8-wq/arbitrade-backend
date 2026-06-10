// src/services/emailTemplates.js
// ─────────────────────────────────────────────────────────
//  Add these methods to emailService.js
//  (or require this file from emailService.js)
// ─────────────────────────────────────────────────────────

const BASE_URL = process.env.FRONTEND_URL || "https://arbitrageai.com";

const layout = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ArbitrageAI</title>
</head>
<body style="margin:0;padding:0;background:#080e1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080e1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#6366f1,#06b6d4);padding:2px;border-radius:16px 16px 0 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="background:#0d1625;border-radius:14px 14px 0 0;padding:24px;text-align:center;">
              <div style="font-size:28px;margin-bottom:4px;">⚡</div>
              <div style="font-size:22px;font-weight:800;background:linear-gradient(135deg,#818cf8,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#818cf8;">ArbitrageAI</div>
              <div style="font-size:11px;color:#4a5a72;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Global Price Intelligence</div>
            </td></tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#0d1625;border-left:1px solid rgba(99,102,241,.15);border-right:1px solid rgba(99,102,241,.15);padding:32px 28px;">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#080e1a;border:1px solid rgba(255,255,255,.05);border-top:none;border-radius:0 0 16px 16px;padding:20px 28px;text-align:center;">
          <p style="color:#3d5068;font-size:11px;margin:0;">
            © 2025 ArbitrageAI Inc. ·
            <a href="${BASE_URL}/privacy" style="color:#6366f1;text-decoration:none;">Privacy</a> ·
            <a href="${BASE_URL}/terms" style="color:#6366f1;text-decoration:none;">Terms</a> ·
            <a href="${BASE_URL}/unsubscribe" style="color:#6366f1;text-decoration:none;">Unsubscribe</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

const primaryBtn = (text, url) => `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td align="center">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#22d3ee);color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.3px;">
        ${text}
      </a>
    </td></tr>
  </table>`;

const infoBox = (rows) => `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111d30;border-radius:10px;margin:20px 0;">
    ${rows.map(([label, value, highlight]) => `
    <tr>
      <td style="padding:11px 16px;border-bottom:1px solid #1a2640;font-size:13px;color:#7a8ba8;width:40%;">${label}</td>
      <td style="padding:11px 16px;border-bottom:1px solid #1a2640;font-size:13px;font-weight:700;color:${highlight||'#f0f4ff'};">${value}</td>
    </tr>`).join("")}
  </table>`;

const featureList = (items) => items.map(f =>
  `<div style="display:flex;align-items:center;margin-bottom:10px;font-size:13px;color:#7a8ba8;">
    <span style="color:#10b981;margin-right:8px;font-size:16px;">✓</span>${f}
  </div>`
).join("");

/* ── Templates ───────────────────────────────────────────── */
module.exports = {

  // 1. EMAIL VERIFICATION
  verification: (user, token) => layout(`
    <h2 style="color:#f0f4ff;font-size:22px;font-weight:800;margin:0 0 8px;">Verify your email 📧</h2>
    <p style="color:#7a8ba8;line-height:1.7;margin:0 0 20px;">
      Hi <strong style="color:#f0f4ff;">${user.name}</strong>, welcome to ArbitrageAI!
      Click the button below to verify your email address and activate your account.
    </p>
    ${primaryBtn("Verify Email Address →", `${BASE_URL}/auth/verify-email?token=${token}`)}
    <p style="color:#4a5a72;font-size:12px;text-align:center;margin-top:12px;">
      This link expires in <strong style="color:#f59e0b;">24 hours</strong>.
      If you didn't create this account, you can safely ignore this email.
    </p>
    <div style="background:#111d30;border-left:3px solid #6366f1;padding:12px 16px;border-radius:0 8px 8px 0;margin-top:20px;font-size:12px;color:#7a8ba8;">
      Or copy this link: <span style="color:#818cf8;font-family:monospace;word-break:break-all;">${BASE_URL}/auth/verify-email?token=${token}</span>
    </div>
  `),

  // 2. PASSWORD RESET
  passwordReset: (user, token) => layout(`
    <h2 style="color:#f0f4ff;font-size:22px;font-weight:800;margin:0 0 8px;">Reset your password 🔐</h2>
    <p style="color:#7a8ba8;line-height:1.7;margin:0 0 20px;">
      Hi <strong style="color:#f0f4ff;">${user.name}</strong>, we received a request to reset your password.
      Click the button below to choose a new one.
    </p>
    ${primaryBtn("Reset Password →", `${BASE_URL}/auth/reset-password?token=${token}`)}
    <p style="color:#4a5a72;font-size:12px;text-align:center;">
      This link expires in <strong style="color:#f59e0b;">1 hour</strong>.
    </p>
    <div style="background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);padding:12px 16px;border-radius:8px;margin-top:20px;font-size:12px;color:#f43f5e;">
      ⚠️ If you didn't request this, your account may be at risk. 
      <a href="${BASE_URL}/auth/login" style="color:#f43f5e;font-weight:700;">Secure your account →</a>
    </div>
  `),

  // 3. WELCOME
  welcome: (user) => layout(`
    <h2 style="color:#f0f4ff;font-size:22px;font-weight:800;margin:0 0 8px;">Welcome to ArbitrageAI 🚀</h2>
    <p style="color:#7a8ba8;line-height:1.7;margin:0 0 20px;">
      Hi <strong style="color:#f0f4ff;">${user.name}</strong>! Your account is ready.
      Start finding profitable arbitrage opportunities across Amazon, eBay, Walmart, AliExpress and more.
    </p>
    ${primaryBtn("Open Dashboard →", `${BASE_URL}/dashboard`)}
    <div style="background:#111d30;border-radius:10px;padding:16px 20px;margin:20px 0;">
      <p style="color:#94a3b8;font-size:13px;font-weight:700;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;">Your Free Plan includes:</p>
      ${featureList([
        "5 products monitored",
        "Email price alerts",
        "Manual arbitrage scanner",
        "Basic analytics dashboard",
        "Price history charts",
      ])}
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
      <tr><td align="center">
        <a href="${BASE_URL}/plans" style="display:inline-block;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.4);color:#818cf8;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:13px;">
          Upgrade to Pro — Unlimited monitoring →
        </a>
      </td></tr>
    </table>
  `),

  // 4. PAYMENT CONFIRMATION
  paymentConfirmed: (user, payment) => layout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="width:56px;height:56px;background:rgba(16,185,129,.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;">✓</div>
      <h2 style="color:#10b981;font-size:22px;font-weight:800;margin:12px 0 4px;">Payment Confirmed!</h2>
      <p style="color:#7a8ba8;margin:0;">Your ${payment.metadata?.plan || ""} plan is now active.</p>
    </div>
    ${infoBox([
      ["Plan",      payment.metadata?.plan || "—",      "#818cf8"],
      ["Billing",   payment.metadata?.billing || "—"],
      ["Amount",    `${payment.currency} ${payment.amount?.toFixed(2)}`, "#10b981"],
      ["Method",    payment.method],
      ["Reference", payment.reference,                  "#818cf8"],
      ["Date",      new Date(payment.paidAt || Date.now()).toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })],
    ])}
    ${primaryBtn("Go to Dashboard →", `${BASE_URL}/dashboard`)}
    <p style="color:#4a5a72;font-size:12px;text-align:center;">
      Save this email as your payment receipt. 
      Questions? <a href="mailto:support@arbitrageai.com" style="color:#6366f1;">support@arbitrageai.com</a>
    </p>
  `),

  // 5. BANK TRANSFER INSTRUCTIONS
  bankTransfer: (user, instructions) => layout(`
    <h2 style="color:#f0f4ff;font-size:22px;font-weight:800;margin:0 0 8px;">Bank Transfer Instructions 🏦</h2>
    <p style="color:#7a8ba8;line-height:1.7;margin:0 0 20px;">
      Hi <strong style="color:#f0f4ff;">${user.name}</strong>,
      use the details below to complete your payment. 
      Your plan will be activated within <strong style="color:#f59e0b;">24 hours</strong> after we confirm receipt.
    </p>
    ${infoBox([
      ["Bank Name",       instructions.bankName],
      ["Account Name",    instructions.accountName],
      ["Account Number",  instructions.accountNumber,  "#818cf8"],
      ["Branch",          instructions.branch],
      ["SWIFT / BIC",     instructions.swift],
      ["IBAN",            instructions.iban],
      ["Amount",          instructions.amount,          "#10b981"],
      ["Reference",       instructions.reference,       "#f59e0b"],
    ])}
    <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);padding:14px 16px;border-radius:8px;font-size:13px;color:#f59e0b;line-height:1.6;">
      ⚠️ <strong>Important:</strong> Use <code style="background:rgba(245,158,11,.15);padding:2px 6px;border-radius:4px;">${instructions.reference}</code> as the payment reference/description.
      After payment, send proof to <a href="mailto:payments@arbitrageai.com" style="color:#f59e0b;">payments@arbitrageai.com</a>
    </div>
  `),

  // 6. ARBITRAGE ALERT
  arbitrageAlert: (user, opp) => layout(`
    <div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:10px;padding:16px;text-align:center;margin-bottom:20px;">
      <div style="font-size:32px;margin-bottom:4px;">🔥</div>
      <h2 style="color:#10b981;font-size:24px;font-weight:800;margin:0;">+$${opp.netProfit?.toFixed(0)} Profit Detected</h2>
      <p style="color:#7a8ba8;margin:4px 0 0;">${opp.roi?.toFixed(1)}% ROI · AI Score: ${opp.aiScore}/100</p>
    </div>
    <p style="color:#7a8ba8;margin:0 0 16px;">Hi <strong style="color:#f0f4ff;">${user.name}</strong>, our AI just found a new opportunity:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="background:#111d30;border-radius:10px 0 0 10px;padding:16px;text-align:center;width:48%;">
          <div style="font-size:10px;color:#7a8ba8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Buy at</div>
          <div style="font-size:26px;font-weight:800;color:#22d3ee;font-family:monospace;">$${opp.buyPrice}</div>
          <div style="font-size:12px;color:#7a8ba8;margin-top:4px;">${opp.buyMarketplace}</div>
        </td>
        <td style="width:4%;text-align:center;color:#4a5a72;font-size:20px;">→</td>
        <td style="background:#111d30;border-radius:0 10px 10px 0;padding:16px;text-align:center;width:48%;">
          <div style="font-size:10px;color:#7a8ba8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Sell at</div>
          <div style="font-size:26px;font-weight:800;color:#10b981;font-family:monospace;">$${opp.sellPrice}</div>
          <div style="font-size:12px;color:#7a8ba8;margin-top:4px;">${opp.sellMarketplace}</div>
        </td>
      </tr>
    </table>
    ${primaryBtn("View Full Opportunity →", `${BASE_URL}/scanner`)}
    <p style="color:#4a5a72;font-size:11px;text-align:center;">
      Opportunities are time-sensitive. Act fast before prices change.
    </p>
  `),
};
