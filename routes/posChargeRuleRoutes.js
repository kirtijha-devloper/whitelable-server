const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const {
  createPosChargeRule,
  getPosChargeRule,
  listPosChargeRules,
  listFranchiseAdminRules,
  listFranchiseCustomRules,
  updatePosChargeRule,
  deletePosChargeRule,
  calculateCharge
} = require('../controllers/posChargeRuleController');

router.use(validateToken);

// create / update / list / delete rules
router.post('/', createPosChargeRule);
// existing generic list remains for backward compatibility
router.get('/list', listPosChargeRules);
// new franchise helpers
router.get('/list/admin', listFranchiseAdminRules);
router.get('/list/franchise', listFranchiseCustomRules);
router.get('/:id', getPosChargeRule);
router.put('/:id', updatePosChargeRule);
router.delete('/:id', deletePosChargeRule);

// calculation endpoint
router.post('/calculate', calculateCharge);

module.exports = router;
