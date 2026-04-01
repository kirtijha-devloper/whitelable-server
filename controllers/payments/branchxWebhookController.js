const fs = require('fs');
const path = require('path');
const asyncHandler = require("express-async-handler");

const callbackLogFile = path.resolve(__dirname, '../../logs/branchx-payout-callback.log');

function logBranchxCallback(data) {
  try {
    const line = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
    fs.appendFileSync(callbackLogFile, line, 'utf8');
  } catch (err) {
    console.error('Failed to write BranchX callback log:', err);
  }
}

// BranchX payout callback notifications are sent by BranchX after payout processing.
// This endpoint is intentionally implemented with minimal logic for now. Business
// logic will be added in a follow-up task.
const handleBranchxPayoutCallback = asyncHandler(async (req, res) => {
  // TODO: Add BranchX payout callback processing:
  // - verify the payload signature if applicable
  // - validate required fields
  // - update payout transactions and ledger status
  // - ack with 200 OK

  console.log('[BranchX callback] payload:', req.body);
  logBranchxCallback(req.body);

  return res.status(200).json({
    success: true,
    message: 'BranchX payout callback received',
    receivedData: req.body
  });
});

module.exports = {
  handleBranchxPayoutCallback,
};
