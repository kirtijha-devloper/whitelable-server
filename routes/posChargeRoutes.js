const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const {
  createDefaultPosCharge,
  getDefaultPosCharges,
  updateDefaultPosCharge,
  deleteDefaultPosCharge,
  createUserPosCharge,
  getUserPosCharges,
  updateUserPosCharge,
  deleteUserPosCharge,
  calculatePosCharge
} = require('../controllers/posChargeController');

// All routes require authentication
router.use(validateToken);

// ── Default POS Charge slabs (write: admin only; read: all) ──────────────────
router.post('/default', createDefaultPosCharge);        // create
router.get('/default', getDefaultPosCharges);           // list all
router.put('/default/:id', updateDefaultPosCharge);     // update
router.delete('/default/:id', deleteDefaultPosCharge);  // delete

// ── User-specific POS Charges (admin + franchaise write; merchant read-only) ─
router.post('/user', createUserPosCharge);              // link / assign
router.get('/user', getUserPosCharges);                 // list (filtered by role)
router.put('/user/:id', updateUserPosCharge);           // update link / override
router.delete('/user/:id', deleteUserPosCharge);        // remove link

// ── Calculate effective POS charge ──────────────────────────────────────────
router.post('/calculate', calculatePosCharge);          // resolve effective charge + fee

module.exports = router;
