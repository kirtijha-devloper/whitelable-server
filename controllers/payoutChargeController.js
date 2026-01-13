const asyncHandler = require("express-async-handler");
const PayoutCharge = require('../models/PayoutCharge');
const User = require('../models/User');

// Create Payout Charge
const createPayoutCharge = asyncHandler(async (req, res) => {
  try {
    const { merchant_id, min, max, amount, percentage, status, is_default } = req.body;

    // Validate required fields
    if (!merchant_id) {
      return res.status(400).json({
        success: false,
        message: 'merchant_id is required'
      });
    }

    // Validate that at least one of amount or percentage is provided
    if (!amount && !percentage) {
      return res.status(400).json({
        success: false,
        message: 'Either amount or percentage must be provided'
      });
    }

    // Validate amount if provided
    if (amount !== undefined && parseFloat(amount) < 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than or equal to 0'
      });
    }

    // Validate percentage if provided
    if (percentage !== undefined && (parseFloat(percentage) < 0 || parseFloat(percentage) > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Percentage must be between 0 and 100'
      });
    }

    // Validate min and max if both provided
    if (min !== undefined && max !== undefined) {
      if (parseFloat(min) >= parseFloat(max)) {
        return res.status(400).json({
          success: false,
          message: 'min must be less than max'
        });
      }
    }

    // Check for uniqueness - one payout charge per merchant_id
    const [payoutCharge, created] = await PayoutCharge.findOrCreate({
      where: {
        merchant_id: merchant_id
      },
      defaults: {
        merchant_id,
        min: min !== undefined ? parseFloat(min) : null,
        max: max !== undefined ? parseFloat(max) : null,
        amount: amount !== undefined ? parseFloat(amount) : null,
        percentage: percentage !== undefined ? parseFloat(percentage) : null,
        status: status || 'active',
        is_default: is_default !== undefined ? Boolean(is_default) : false
      }
    });

    if (!created) {
      return res.status(400).json({
        success: false,
        message: 'Payout charge already exists for this merchant'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Payout charge created successfully',
      data: payoutCharge
    });
  } catch (error) {
    console.error('Create payout charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Get Payout Charge by ID
const getPayoutCharge = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Payout charge ID is required'
      });
    }

    const payoutCharge = await PayoutCharge.findByPk(id);

    if (!payoutCharge) {
      return res.status(404).json({
        success: false,
        message: 'Payout charge not found'
      });
    }

    res.status(200).json({
      success: true,
      data: payoutCharge
    });
  } catch (error) {
    console.error('Get payout charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// List Payout Charges with filters and pagination
const listPayoutCharges = asyncHandler(async (req, res) => {
  try {
    const { 
      merchant_id, 
      status,
      is_default,
      page = 1, 
      limit = 10 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    // Apply filters
    if (merchant_id) {
      where.merchant_id = merchant_id;
    }

    if (status) {
      where.status = status;
    }

    if (is_default !== undefined) {
      where.is_default = is_default === 'true' || is_default === true;
    }

    // Get total count and paginated results
    const { count, rows: payoutCharges } = await PayoutCharge.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    // Fetch merchant details for each payout charge
    const formattedPayoutCharges = await Promise.all(payoutCharges.map(async (payoutCharge) => {
      let merchantDetails = null;
      
      if (payoutCharge.merchant_id) {
        merchantDetails = await User.findByPk(payoutCharge.merchant_id, {
          attributes: ['id', 'name', 'email', 'mobile_number', 'abheepay_id', 'organization_name']
        });
      }

      return {
        ...payoutCharge.toJSON(),
        merchant: merchantDetails ? {
          id: merchantDetails.id,
          name: merchantDetails.name,
          email: merchantDetails.email,
          mobile_number: merchantDetails.mobile_number,
          abheepay_id: merchantDetails.abheepay_id,
          organization_name: merchantDetails.organization_name
        } : null
      };
    }));

    res.status(200).json({
      success: true,
      message: 'Payout charges retrieved successfully',
      data: formattedPayoutCharges,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List payout charges error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Update Payout Charge
const updatePayoutCharge = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { merchant_id, min, max, amount, percentage, status, is_default } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Payout charge ID is required'
      });
    }

    const payoutCharge = await PayoutCharge.findByPk(id);

    if (!payoutCharge) {
      return res.status(404).json({
        success: false,
        message: 'Payout charge not found'
      });
    }

    // Validate amount if provided
    if (amount !== undefined) {
      if (parseFloat(amount) < 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be greater than or equal to 0'
        });
      }
    }

    // Validate percentage if provided
    if (percentage !== undefined) {
      if (parseFloat(percentage) < 0 || parseFloat(percentage) > 100) {
        return res.status(400).json({
          success: false,
          message: 'Percentage must be between 0 and 100'
        });
      }
    }

    // Validate min and max if both provided
    if (min !== undefined && max !== undefined) {
      if (parseFloat(min) >= parseFloat(max)) {
        return res.status(400).json({
          success: false,
          message: 'min must be less than max'
        });
      }
    }

    // Ensure at least one of amount or percentage exists after update
    const finalAmount = amount !== undefined ? parseFloat(amount) : payoutCharge.amount;
    const finalPercentage = percentage !== undefined ? parseFloat(percentage) : payoutCharge.percentage;
    
    if (!finalAmount && !finalPercentage) {
      return res.status(400).json({
        success: false,
        message: 'Either amount or percentage must be provided'
      });
    }

    // Update only provided fields
    const updateData = {};
    if (merchant_id !== undefined) updateData.merchant_id = merchant_id;
    if (min !== undefined) updateData.min = min !== null ? parseFloat(min) : null;
    if (max !== undefined) updateData.max = max !== null ? parseFloat(max) : null;
    if (amount !== undefined) updateData.amount = amount !== null ? parseFloat(amount) : null;
    if (percentage !== undefined) updateData.percentage = percentage !== null ? parseFloat(percentage) : null;
    if (status !== undefined) updateData.status = status;
    if (is_default !== undefined) updateData.is_default = Boolean(is_default);

    await payoutCharge.update(updateData);

    res.status(200).json({
      success: true,
      message: 'Payout charge updated successfully',
      data: payoutCharge
    });
  } catch (error) {
    console.error('Update payout charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Delete Payout Charge
const deletePayoutCharge = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Payout charge ID is required'
      });
    }

    const payoutCharge = await PayoutCharge.findByPk(id);

    if (!payoutCharge) {
      return res.status(404).json({
        success: false,
        message: 'Payout charge not found'
      });
    }

    await payoutCharge.destroy();

    res.status(200).json({
      success: true,
      message: 'Payout charge deleted successfully'
    });
  } catch (error) {
    console.error('Delete payout charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

module.exports = {
  createPayoutCharge,
  getPayoutCharge,
  listPayoutCharges,
  updatePayoutCharge,
  deletePayoutCharge
};

