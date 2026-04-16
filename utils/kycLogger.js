const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'kyc.log');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatArg(arg) {
  if (arg instanceof Error) {
    return `${arg.message}\n${arg.stack}`;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2);
    } catch (_) {
      return String(arg);
    }
  }
  return String(arg);
}

function writeLog(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatArg).join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {
    // avoid crashing the request path if logging fails
  }
}

const logger = {
  log: (...args) => { console.log(...args); writeLog('INFO', args); },
  warn: (...args) => { console.warn(...args); writeLog('WARN', args); },
  error: (...args) => { console.error(...args); writeLog('ERROR', args); },
};

module.exports = logger;
