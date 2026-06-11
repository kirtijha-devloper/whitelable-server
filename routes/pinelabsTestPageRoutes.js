const express = require('express');
const path = require('path');

const router = express.Router();

router.get('/pinelabs-test', (_req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'static', 'pinelabs-test.html'));
});

module.exports = router;
