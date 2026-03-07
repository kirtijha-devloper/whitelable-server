const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const {
  createPosChargeRule,
  getPosChargeRule,
  listPosChargeRules,
  updatePosChargeRule,
  deletePosChargeRule,
  calculateCharge
} = require('../controllers/posChargeRuleController');

router.use(validateToken);

// create / update / list / delete rules
router.post('/', createPosChargeRule);
router.get('/list', listPosChargeRules);
router.get('/:id', getPosChargeRule);
router.put('/:id', updatePosChargeRule);
router.delete('/:id', deletePosChargeRule);

// calculation endpoint
router.post('/calculate', calculateCharge);

module.exports = router;
