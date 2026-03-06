const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const {
  createCompanyName,
  getCompanyNames,
  updateCompanyName,
  deleteCompanyName
} = require('../controllers/companyNameController');

// all routes require authentication
router.use(validateToken);

// admin-write, all-read
router.post('/', createCompanyName);
router.get('/', getCompanyNames);
router.put('/:id', updateCompanyName);
router.delete('/:id', deleteCompanyName);

module.exports = router;
