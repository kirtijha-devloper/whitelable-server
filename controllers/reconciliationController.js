const asyncHandler = require('express-async-handler');

// GET /api/reconciliation
// Simple endpoint to confirm the reconciliation API is reachable.
const reconcileEndpointWorking = asyncHandler(async (req, res) => {
  return res.status(200).json({ success: true, message: 'end point working' });
});

const reconcile = asyncHandler(async (req, res) => {
  return res.status(200).json({ success: true, message: 'reconsile end point working' });
});

module.exports = {
  reconcileEndpointWorking,
  reconcile
};

