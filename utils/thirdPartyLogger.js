
const fs = require("fs");
const path = require("path");

const ENV = process.env.NODE_ENV || "development";

const LOG_DIR = path.join(
  process.cwd(),
  "logs",
  ENV === "production" ? "production" :
  ENV === "test" ? "test" : "dev"
);

fs.mkdirSync(LOG_DIR, { recursive: true });

function writeDevLog(module, data) {
  const allowedModules = [
    "payout",
    "payin",
    "webhook",
    "bank-verification",
    "wallet",
    "system"
  ];

  if (!allowedModules.includes(module)) {
    throw new Error(`Invalid log module: ${module}`);
  }

  const LOG_FILE = path.join(LOG_DIR, `${module}.log`);

  const logEntry = `
==================================================
TIME        : ${new Date().toISOString()}
ENVIRONMENT : ${ENV}
MODULE      : ${module.toUpperCase()}
EVENT       : ${data.event || "UNKNOWN"}
STATUS      : ${data.status || "N/A"}
REFERENCE   : ${data.reference || "N/A"}
REQUEST     :
${JSON.stringify(data.request ?? null, null, 2)}
RESPONSE    :
${JSON.stringify(data.response ?? null, null, 2)}
ERROR       :
${data.error || "N/A"}
DURATION    : ${data.durationMs ?? "N/A"} ms
==================================================

`;

  fs.appendFile(LOG_FILE, logEntry, (error) => {
    if (error) {
      console.error("Log write failed:", error.message);
    }
  });
}

module.exports = { writeDevLog };