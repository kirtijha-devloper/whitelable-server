const express = require('express');
const { handlePineLabsCallback } = require('../controllers/pinelabsCallbackController');

const router = express.Router();

router.post('/callback', handlePineLabsCallback);
router.get('/callback', handlePineLabsCallback);

module.exports = router;
