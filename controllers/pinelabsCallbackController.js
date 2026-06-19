const fs = require('fs');
const path = require('path');

const callbackLogFile = path.resolve(__dirname, '../logs/pinelabs-callback.log');

function ensureLogDirExists() {
  const logDir = path.dirname(callbackLogFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function writeCallbackLog(entry) {
  try {
    ensureLogDirExists();
    fs.appendFileSync(callbackLogFile, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write Pine Labs callback log:', error);
  }
}

function getSourceIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
}

async function handlePineLabsCallback(req, res) {
  const payload = req.body && Object.keys(req.body).length ? req.body : {};
  const entry = {
    receivedAt: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    sourceIp: getSourceIp(req),
    headers: req.headers,
    query: req.query || {},
    body: payload,
  };

  writeCallbackLog(entry);

  return res.status(200).json({
    success: true,
    message: 'Pine Labs callback received',
    receivedAt: entry.receivedAt,
  });
}

module.exports = {
  handlePineLabsCallback,
};
