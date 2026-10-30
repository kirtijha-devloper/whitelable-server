const fs = require("fs");
const path = require("path");

function getLogDir() {
  const env = process.env.NODE_ENV || "development";
  const subDir = env === "production" ? "production" : env === "test" ? "test" : "dev";
  const logDir = path.join(process.cwd(), "logs", subDir);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function writeDevLog(module, data = {}) {
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

  const logDir = getLogDir();
  const logFile = path.join(logDir, `${module}.log`);

  const time = new Date().toISOString();

  let file = "unknown";
  if (data && data.file) {
    file = path.basename(String(data.file));
  }

  let error = "Unknown error";
  if (data) {
    const rawError = data.error?.message || data.error;
    if (rawError !== undefined && rawError !== null && rawError !== "") {
      if (typeof rawError === "object") {
        try {
          error = JSON.stringify(rawError);
        } catch {
          error = String(rawError);
        }
      } else {
        error = String(rawError);
      }
    }
  }

  const sanitizedError = error.replace(/[\r\n\t]+/g, " ").trim() || "Unknown error";

  const logEntry = `[TIME: ${time}] [FILE: ${file}] [ERROR: ${sanitizedError}]\n`;

  fs.appendFile(logFile, logEntry, "utf8", (err) => {
    if (err) {
      console.error("Log write failed:", err.message);
    }
  });
}

global.writeDevLog = writeDevLog;

module.exports = { writeDevLog };
