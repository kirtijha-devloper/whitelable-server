const fs = require('fs/promises');
const path = require('path');

const logFilePath = path.join(__dirname, '..', 'logs', 'pinelabs-test.log');

async function appendPineLabsTestLog(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  await fs.mkdir(path.dirname(logFilePath), { recursive: true });
  await fs.appendFile(logFilePath, line, 'utf8');
}

module.exports = {
  appendPineLabsTestLog,
  logFilePath,
};
