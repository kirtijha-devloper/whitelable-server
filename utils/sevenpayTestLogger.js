const fs = require('fs/promises');
const path = require('path');

const logFilePath = path.join(__dirname, '..', 'logs', 'sevenpay-test.log');

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

async function appendSevenpayTestLog(entry) {
  const lines = [
    '============================================================',
    `[${entry.timestamp || new Date().toISOString()}] ${entry.action || 'unknown'}`,
    `statusCode: ${entry.statusCode ?? 'n/a'}`,
    `elapsedMs: ${entry.elapsedMs ?? 'n/a'}`,
    `message: ${entry.message || ''}`,
    '',
    'request:',
    toText(entry.request),
    '',
    'response:',
    toText(entry.response),
    '',
    'error:',
    toText(entry.error),
    '',
  ];

  await fs.mkdir(path.dirname(logFilePath), { recursive: true });
  await fs.appendFile(logFilePath, `${lines.join('\n')}\n`, 'utf8');
}

module.exports = {
  appendSevenpayTestLog,
  logFilePath,
};
