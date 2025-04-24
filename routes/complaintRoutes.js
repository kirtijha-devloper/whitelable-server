// routes/complaints.js
const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const validateToken = require("../middleware/validateTokenHandler");
router.use(validateToken);

router.post('/submit', async (req, res) => {
  try {
    const { message } = req.body;
    const user_id = req.user.id;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Complaint message is required.' });
    }
    const complaint = await Complaint.create({ user_id, message });
console.log
    res.status(201).json({ success: true, data: complaint });
  } catch (error) {
    console.error('Error submitting complaint:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowedStatuses = ['pending', 'resolved', 'closed'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    const complaint = await Complaint.findByPk(id);

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found.' });
    }

    // Optional: Ensure the complaint belongs to the logged-in merchant
    // if (complaint.merchant_id !== req.user.id) {
    //   return res.status(403).json({ success: false, message: 'Unauthorized access.' });
    // }

    complaint.status = status;
    await complaint.save();

    res.json({ success: true, data: complaint });
  } catch (error) {
    console.error('Error updating complaint status:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});


router.get('/', async (req, res) => {
    try {
        const role = req.user.role
        const userId = req.user.id
        let whereCondition = {};

        if (role !== 'admin') {
        whereCondition.user_id = userId; // Show only complaints by the merchant
        }

        const complaints = await Complaint.findAll({
        where: whereCondition,
        // include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
        order: [['createdAt', 'DESC']],
        });

        res.status(200).json({ success: true, data: complaints });
    } catch (error) {
        console.error('Error fetching complaints:', error);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

module.exports = router;
