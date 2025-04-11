const asyncHandler = require('express-async-handler');
const Tpin = require('../models/Tpin');

const generateTpin = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const tpin = Math.floor(100000 + Math.random() * 900000);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  await Tpin.create({
    user_id: userId,
    tpin,
    expires_at
  });

  res.json({ message: "T-PIN generated successfully", tpin });
});

module.exports = { generateTpin }