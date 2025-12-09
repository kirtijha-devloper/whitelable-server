const asyncHandler = require("express-async-handler");
const Rental = require('../models/Rental');

// Create Rental
const createRental = asyncHandler(async (req, res) => {
  try {
    const { merchant_id, franchaise_id, amount, status, type } = req.body;

    // Validate required fields
    if (!merchant_id || !amount) {
      return res.status(400).json({
        success: false,
        message: 'merchant_id and amount are required'
      });
    }

    // Validate amount is positive
    if (parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Create rental with default type 'pos' if not provided
    const rental = await Rental.create({
      merchant_id,
      franchaise_id: franchaise_id || null,
      amount: parseFloat(amount),
      status: status || 'active',
      type: type || 'pos'
    });

    res.status(201).json({
      success: true,
      message: 'Rental created successfully',
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

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Rental ID is required'
      });
    }

    const rental = await Rental.findByPk(id);

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: 'Rental not found'
      });
    }

    res.status(200).json({
      success: true,
      data: rental
    });
  } catch (error) {
    console.error('Get rental error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// List Rentals with filters and pagination
const listRentals = asyncHandler(async (req, res) => {
  try {
    const { 
      merchant_id, 
      franchaise_id, 
      status, 
      type, 
      page = 1, 
      limit = 10 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    // Apply filters
    if (merchant_id) {
      where.merchant_id = merchant_id;
    }

    if (franchaise_id) {
      where.franchaise_id = franchaise_id;
    }

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    // Get total count and paginated results
    const { count, rows: rentals } = await Rental.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
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
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Update Rental
const updateRental = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { merchant_id, franchaise_id, amount, status, type } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Rental ID is required'
      });
    }

    const rental = await Rental.findByPk(id);

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: 'Rental not found'
      });
    }

    // Validate amount if provided
    if (amount !== undefined) {
      if (parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be greater than 0'
        });
      }
    }

    // Update only provided fields
    const updateData = {};
    if (merchant_id !== undefined) updateData.merchant_id = merchant_id;
    if (franchaise_id !== undefined) updateData.franchaise_id = franchaise_id;
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (status !== undefined) updateData.status = status;
    if (type !== undefined) updateData.type = type;

    await rental.update(updateData);

    res.status(200).json({
      success: true,
      message: 'Rental updated successfully',
      data: rental
    });
  } catch (error) {
    console.error('Update rental error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

module.exports = {
  createRental,
  getRental,
  listRentals,
  updateRental
};

