/**
 * /api/shared — Shared internal proxy routes
 *
 * GET /api/shared/ndia5-token   — Proxied NDIA5 bearer token (secured by x-ndia5-client-id + x-ndia5-api-key)
 */

const express = require('express');
const { getNdia5Token } = require('../controllers/shared/ndia5TokenController');

const router = express.Router();

// GET /api/shared/ndia5-token
// No user JWT needed — validated by x-ndia5-client-id + x-ndia5-api-key headers
router.get('/ndia5-token', getNdia5Token);

module.exports = router;
