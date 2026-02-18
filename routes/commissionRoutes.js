const express = require('express');
const router = express.Router();

const validateToken = require('../middleware/validateTokenHandler');
const {
  createDefaultCommission,
  getDefaultCommissions,
  updateDefaultCommission,
  deleteDefaultCommission,
  createUserCommission,
  getUserCommissions,
  updateUserCommission,
  deleteUserCommission,
  getCommission
} = require('../controllers/commissionController');

// all routes require authentication
router.use(validateToken);

// Default (global) commission slabs — admin
router.post('/default', createDefaultCommission);         // create a slab
router.get('/default', getDefaultCommissions);           // list slabs
router.put('/default/:id', updateDefaultCommission);     // update slab
router.delete('/default/:id', deleteDefaultCommission);  // delete slab

// User-specific links (admin can manage, users can list their own)
router.post('/user', createUserCommission);              // link/create slab for user
router.get('/user', getUserCommissions);                 // list user links (query user_id optional)
router.put('/user/:id', updateUserCommission);          // update a user-link
router.delete('/user/:id', deleteUserCommission);       // remove link

// Lookup / calculate effective commission
router.post('/calculate', getCommission);                // returns best match + fee (if amount provided)

module.exports = router;
