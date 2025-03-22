const express = require('express');
const sddsController = require('../../controllers/payments/sddsController');

const router = express.Router();

// All routes available under /api/sdds
router.use('/sdds', sddsController);

module.exports = router;
