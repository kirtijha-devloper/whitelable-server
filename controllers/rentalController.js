const asyncHandler = require("express-async-handler");
const Rental = require('../models/Rental');
const User = require('../models/User');

/**
 * Rental rate configuration endpoints.
 *
 * Rate scopes:
 *   franchaise_id IS NULL + target_user_type 'franchise'  → admin rate charged to all franchises
 *   franchaise_id IS NULL + target_user_type 'merchant'   → admin rate charged to standalone merchants
 *   franchaise_id = X    + target_user_type 'merchant'   → franchise X’s rate for all their merchants
 *
 * One active rate is allowed per (franchaise_id, target_user_type) pair.
 */

// ---------------------------------------------------------------------------
// Create Rental Rate
// ---------------------------------------------------------------------------
// Admin   → must supply target_user_type ('franchise' | 'merchant')
//           'franchise' rate = what franchises are billed by the platform
//           'merchant'  rate = what standalone merchants are billed by the platform
// Franchise → always targets 'merchant' (all merchants under them get this rate)
//
// One active rate per (franchaise_id, target_user_type) scope is allowed.
// ---------------------------------------------------------------------------
const createRental = asyncHandler(async (req, res) => {
  try {
    const role   = req.user.role;
    const userId = req.user.id;

    if (role !== 'admin' && role !== 'franchaise') {
      return res.status(403).json({
        success: false,
        message: 'Only admin or franchise can create rental rates'
      });
    }

    const { amount, type, status, target_user_type } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid positive amount is required'
      });
    }

    let franchaise_id;
    let targetType;

    if (role === 'admin') {
      if (!target_user_type || !['franchise', 'merchant'].includes(target_user_type)) {
        return res.status(400).json({
          success: false,
          message: 'target_user_type is required for admin ("franchise" or "merchant")'
        });
      }
      franchaise_id = null;
      targetType    = target_user_type;
    } else {
      // Franchise always sets the rate for their merchants
      franchaise_id = userId;
      targetType    = 'merchant';
    }

    // One rate per scope
    const existing = await Rental.findOne({
      where: {
        franchaise_id: franchaise_id === null ? null : franchaise_id,
        target_user_type: targetType
      }
    });

    if (existing) {
      const scope = role === 'admin'
        ? `admin rate for ${targetType}s`
        : 'your franchise merchant rate';
      return res.status(400).json({
        success: false,
        message: `A ${scope} already exists. Update the existing one.`
      });
    }

    const rental = await Rental.create({
      franchaise_id,
      target_user_type: targetType,
      amount: parseFloat(amount),
      status: status || 'active',
      type:   type   || 'pos',
      created_by: userId
    });

    res.status(201).json({
      success: true,
      message: 'Rental rate created successfully',
      data: rental
    });
  } catch (error) {
    console.error('Create rental error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Get Rental by ID
const getRental = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const role   = req.user.role;
    const userId = req.user.id;

    const rental = await Rental.findByPk(id);

    if (!rental) {
      return res.status(404).json({ success: false, message: 'Rental not found' });
    }

    // Franchise can only view their own rate
    if (role === 'franchaise' && rental.franchaise_id !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Merchants do not have direct access to rate configs
    if (role === 'merchant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.status(200).json({ success: true, data: rental });
  } catch (error) {
    console.error('Get rental error:', error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// List Rentals (scoped by role)
const listRentals = asyncHandler(async (req, res) => {
  try {
    const role   = req.user.role;
    const userId = req.user.id;

    if (role === 'merchant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { status, type, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where  = {};

    // Franchise only sees their own rate; admin sees everything
    if (role === 'franchaise') {
      where.franchaise_id = userId;
    }

    if (status) where.status = status;
    if (type)   where.type   = type;

    const { count, rows: rentals } = await Rental.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      message: 'Rentals retrieved successfully',
      data: rentals,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List rentals error:', error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// Update Rental Rate
const updateRental = asyncHandler(async (req, res) => {
  try {
    const { id }   = req.params;
    const role     = req.user.role;
    const userId   = req.user.id;
    const { amount, status, type } = req.body;

    if (role === 'merchant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const rental = await Rental.findByPk(id);

    if (!rental) {
      return res.status(404).json({ success: false, message: 'Rental not found' });
    }

    // Franchise can only update their own rate
    if (role === 'franchaise' && rental.franchaise_id !== userId) {
      return res.status(403).json({ success: false, message: 'You can only update your own rental rate' });
    }

    if (amount !== undefined && parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });
    }

    const updateData = {};
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (status !== undefined) updateData.status = status;
    if (type   !== undefined) updateData.type   = type;

    await rental.update(updateData);

    res.status(200).json({ success: true, message: 'Rental rate updated successfully', data: rental });
  } catch (error) {
    console.error('Update rental error:', error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// Delete Rental Rate
const deleteRental = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const role   = req.user.role;
    const userId = req.user.id;

    if (role === 'merchant') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const rental = await Rental.findByPk(id);

    if (!rental) {
      return res.status(404).json({ success: false, message: 'Rental not found' });
    }

    // Franchise can only delete their own rate
    if (role === 'franchaise' && rental.franchaise_id !== userId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own rental rate' });
    }

    await rental.destroy();

    res.status(200).json({ success: true, message: 'Rental rate deleted successfully' });
  } catch (error) {
    console.error('Delete rental error:', error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

module.exports = {
  createRental,
  getRental,
  listRentals,
  updateRental,
  deleteRental
};

