const pinelabsTestService = require('../services/pinelabsTestService');

async function uploadTransaction(req, res) {
  const result = await pinelabsTestService.callPineLabs('upload', req.body || {});
  return res.status(result.httpStatus).json(result.payload);
}

async function getTransactionStatus(req, res) {
  const result = await pinelabsTestService.callPineLabs('status', req.body || {});
  return res.status(result.httpStatus).json(result.payload);
}

async function cancelTransaction(req, res) {
  const result = await pinelabsTestService.callPineLabs('cancel', req.body || {});
  return res.status(result.httpStatus).json(result.payload);
}

async function getHealth(req, res) {
  const result = await pinelabsTestService.checkPineLabsHealth();
  return res.status(result.httpStatus).json(result.payload);
}

module.exports = {
  uploadTransaction,
  getTransactionStatus,
  cancelTransaction,
  getHealth,
};
