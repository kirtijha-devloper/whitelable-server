const express = require('express');
const sddsController = require('../../controllers/payments/sddsController');

const router = express.Router();

const validateToken = require("../../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../../middleware/validateWhitelabelDomain");

router.use(validateToken);
router.use(validateWhitelabelDomain);

// All routes available under /api/sdds
router.use('/sdds', sddsController);

module.exports = router;
