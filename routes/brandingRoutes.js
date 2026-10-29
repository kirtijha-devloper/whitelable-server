const express = require('express');
const router = express.Router();
const { getCurrentBranding } = require('../controllers/brandingController');

// Public route: Tenant branding must be accessible to visitors prior to authentication
router.get('/current', getCurrentBranding);

module.exports = router;

