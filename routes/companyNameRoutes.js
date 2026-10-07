const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../middleware/validateWhitelabelDomain');
const {
  createCompanyName,
  getCompanyNames,
  updateCompanyName,
  deleteCompanyName
} = require('../controllers/companyNameController');

// all routes require authentication
router.use(validateToken);
router.use(validateWhitelabelDomain);

// admin-write, all-read
router.post('/', createCompanyName);
router.get('/', getCompanyNames);
router.put('/:id', updateCompanyName);
router.delete('/:id', deleteCompanyName);

module.exports = router;
