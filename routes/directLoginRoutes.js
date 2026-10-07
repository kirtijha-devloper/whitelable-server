const express = require('express');
const router = express.Router();
const validateToken = require('../middleware/validateTokenHandler');
const validateWhitelabelDomain = require('../middleware/validateWhitelabelDomain');
const {
  generateDlToken,
  getDlTokenStatus,
  revokeDlToken,
  directLogin,
} = require('../controllers/directLoginController');

// ── Admin-protected DL token management ─────────────────────────────────────
// All three require a valid admin Bearer token.

// Generate (or regenerate) a DL token for the signed-in admin.
// Returns the raw token ONCE — store in admin UI session.
router.post('/dl-token', validateToken, validateWhitelabelDomain, generateDlToken);

// Check whether an active DL token exists (does not reveal the raw token).
router.get('/dl-token/status', validateToken, validateWhitelabelDomain, getDlTokenStatus);

// Revoke the current DL token immediately.
router.delete('/dl-token', validateToken, validateWhitelabelDomain, revokeDlToken);

// ── Public direct-login exchange ─────────────────────────────────────────────
// No admin JWT needed — the DL token IS the credential.
// Body: { dl_token, user_id }
// Returns a standard user JWT.
router.post('/direct-login', directLogin);

module.exports = router;
