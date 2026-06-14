const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// basic file logger for mail ops (same pattern as other loggers)
const LOG_DIR = path.join(__dirname, "../logs");
const MAIL_LOG_FILE = path.join(LOG_DIR, "mail.log");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
function _ts() {
  return new Date().toISOString();
}
function _fileLog(level, args) {
  const parts = args.map((a) =>
    a instanceof Error
      ? `${a.message}\n${a.stack}`
      : typeof a === "object" && a !== null
      ? JSON.stringify(a, null, 2)
      : String(a)
  );
  const line = `[${_ts()}] [${level}] ${parts.join(" ")}\n`;
  try {
    fs.appendFileSync(MAIL_LOG_FILE, line);
  } catch (_) {}
}
const mailLogger = {
  log: (...args) => { console.log(...args); _fileLog("INFO", args); },
  warn: (...args) => { console.warn(...args); _fileLog("WARN", args); },
  error: (...args) => { console.error(...args); _fileLog("ERROR", args); },
};

// transport configuration
let transporter;
function initTransporter() {
  if (transporter) return transporter;

  const host = process.env.MAIL_HOST || "smtp.gmail.com";
  const port = process.env.MAIL_PORT ? parseInt(process.env.MAIL_PORT, 10) : 587;
  const secure = process.env.MAIL_SECURE === "true"; // true for 465

  const authUser = process.env.MAIL_USER || process.env.GMAIL_USER;
  const authPass = process.env.MAIL_PASS || process.env.GMAIL_APP_PASSWORD;

  if (!authUser || !authPass) {
    mailLogger.error("Mail credentials missing - please set MAIL_USER/MAIL_PASS or GMAIL_USER/GMAIL_APP_PASSWORD");
    // createTransport will still be called so that errors surface later, but we log early
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: authUser,
      pass: authPass,
    },
  });

  transporter.verify().then(() => {
    mailLogger.log("Mail transporter is ready");
  }).catch((err) => {
    mailLogger.error("Mail transporter verification failed", err);
  });

  return transporter;
}

// generic sendMail helper
async function sendMail(options) {
  const t = initTransporter();
  try {
    mailLogger.log("Sending mail", options);
    const info = await t.sendMail(options);
    mailLogger.log("Mail sent", info);
    return info;
  } catch (err) {
    mailLogger.error("Mail send error", err);
    throw err;
  }
}

// convenience OTP sender
async function sendOTP(email, otp, purpose = "login") {
  const fallbackFrom = "noreply@abheepay.com";
  const fromAddr = process.env.MAIL_FROM || process.env.GMAIL_USER || fallbackFrom;
  
  let subject = "Your OTP for Abheepay POS";
  let heading = "Abheepay POS Login";
  
  if (purpose === "forgot_password") {
    subject = "Reset Password OTP for Abheepay POS";
    heading = "Abheepay POS Password Recovery";
  } else if (purpose === "tpin") {
    subject = "T-PIN Generation OTP for Abheepay POS";
    heading = "Abheepay POS T-PIN Verification";
  } else if (purpose === "registration") {
    subject = "Registration OTP for Abheepay POS";
    heading = "Abheepay POS Account Verification";
  }

  const mailOptions = {
    from: `"Abheepay POS" <${fromAddr}>`,
    to: email,
    subject: subject,
    html: `
      <h2>${heading}</h2>
      <p>Your OTP is:</p>
      <h1 style="color: #00CEC8; font-size: 32px; letter-spacing: 2px; font-weight: bold;">${otp}</h1>
      <p>This OTP is valid for 5 minutes.</p>
    `,
  };

  return sendMail(mailOptions);
}

module.exports = {
  sendMail,
  sendOTP,
  mailLogger,
};
