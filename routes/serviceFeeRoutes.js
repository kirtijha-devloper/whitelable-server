const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const {
  createServiceFee,
  getServiceFees,
  updateServiceFee,
  deleteServiceFee
} = require('../controllers/serviceFeeController');

// all routes require authentication
router.use(validateToken);

// admin-write, all-read
router.post('/', createServiceFee);
router.get('/', getServiceFees);
router.put('/:id', updateServiceFee);
router.delete('/:id', deleteServiceFee);

module.exports = router;