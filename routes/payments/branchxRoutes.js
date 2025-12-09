const express = require('express');
const branchxController = require('../../controllers/payments/branchxController');

const router = express.Router();

const validateToken = require("../../middleware/validateTokenHandler");

router.use(validateToken);

// All routes available under /api/branchx
router.use('', branchxController);

module.exports = router;