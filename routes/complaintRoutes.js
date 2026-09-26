const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');
const validateToken = require("../middleware/validateTokenHandler");
const { ensureEmployeePermission } = require("../middleware/employeePermissionHandler");
const { EMPLOYEE_PERMISSIONS } = require("../utils/permissions");

router.use(validateToken);

// Submit new complaint/ticket
router.post('/submit', async (req, res) => {
  try {
    const { message, subject, category } = req.body;
    const user_id = req.user.id;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Complaint message is required.' });
    }

    const complaint = await Complaint.create({
      user_id,
      message,
      subject: subject || 'Help Request',
      category: category || 'General',
      status: 'pending',
    });

    try {
      if (ServiceToggleAuditLog) {
        await ServiceToggleAuditLog.create({
          user_id,
          affected_user_id: user_id,
          service_key: 'complaint_ticket',
          previous_state: false,
          new_state: true,
          action: 'SUBMIT',
          ip_address: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
          user_agent: req.headers['user-agent'] || '',
        });
      }
    } catch (e) {
      console.warn('Audit log creation warning:', e.message);
    }

    const userDetails = await User.findByPk(user_id, {
      attributes: ['id', 'name', 'email', 'mobile_number', 'role'],
    });

    const responseData = {
      ...complaint.toJSON(),
      user_details: userDetails ? {
        id: userDetails.id,
        name: userDetails.name,
        email: userDetails.email,
        mobile_number: userDetails.mobile_number,
        role: userDetails.role,
      } : null,
    };

    res.status(201).json({ success: true, data: responseData });
  } catch (error) {
    console.error('Error submitting complaint:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Update complaint status & admin reply
router.put('/:id/status', ensureEmployeePermission(EMPLOYEE_PERMISSIONS.COMPLAINTS_MANAGE, {
  message: 'You do not have permission to manage complaints.',
  elevateRole: 'admin',
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reply, admin_reply } = req.body;
    const allowedStatuses = ['pending', 'in_progress', 'resolved', 'closed'];

    const complaint = await Complaint.findByPk(id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found.' });
    }

    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status value.' });
      }
      complaint.status = status;
    }

    const finalReply = reply !== undefined ? reply : admin_reply;
    if (finalReply !== undefined && finalReply !== null) {
      complaint.admin_reply = finalReply;
    }

    await complaint.save();

    try {
      if (ServiceToggleAuditLog) {
        const actionType = finalReply
          ? 'ADMIN_REPLY'
          : status === 'closed'
          ? 'CLOSED'
          : status === 'resolved'
          ? 'RESOLVED'
          : 'STATUS_UPDATE';

        await ServiceToggleAuditLog.create({
          user_id: req.user.id,
          affected_user_id: complaint.user_id,
          service_key: 'complaint_ticket',
          previous_state: false,
          new_state: true,
          action: actionType,
          ip_address: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
          user_agent: req.headers['user-agent'] || '',
        });
      }
    } catch (e) {
      console.warn('Audit log creation warning:', e.message);
    }

    const userDetails = await User.findByPk(complaint.user_id, {
      attributes: ['id', 'name', 'email', 'mobile_number', 'role'],
    });

    const responseData = {
      ...complaint.toJSON(),
      user_details: userDetails ? {
        id: userDetails.id,
        name: userDetails.name,
        email: userDetails.email,
        mobile_number: userDetails.mobile_number,
        role: userDetails.role,
      } : null,
    };

    res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('Error updating complaint status:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Get complaints list
router.get('/', async (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user.id;
    let whereCondition = {};

    // Non-admin / Non-employee users only see their own tickets
    if (!['admin', 'employee'].includes(role)) {
      whereCondition.user_id = userId;
    }

    const complaints = await Complaint.findAll({
      where: whereCondition,
      order: [['createdAt', 'DESC']],
    });

    const complaintsWithUserDetails = await Promise.all(complaints.map(async (complaint) => {
      let userDetails = null;

      if (complaint.user_id) {
        userDetails = await User.findByPk(complaint.user_id, {
          attributes: ['id', 'name', 'email', 'mobile_number', 'role'],
        });
      }

      return {
        id: complaint.id,
        subject: complaint.subject || 'Help Request',
        category: complaint.category || 'General',
        message: complaint.message,
        admin_reply: complaint.admin_reply || '',
        status: complaint.status,
        createdAt: complaint.createdAt,
        updatedAt: complaint.updatedAt,
        user_details: userDetails ? {
          id: userDetails.id,
          name: userDetails.name,
          email: userDetails.email,
          mobile_number: userDetails.mobile_number,
          role: userDetails.role,
        } : null,
      };
    }));

    res.status(200).json({ success: true, data: complaintsWithUserDetails });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
