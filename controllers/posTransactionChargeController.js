const asyncHandler = require("express-async-handler");
const PosTransactionCharge = require('../models/PosTransactionCharge');
const User = require('../models/User');

// Create POS Transaction Charge
const createPosTransactionCharge = asyncHandler(async (req, res) => {
  try {
    const { merchant_id, method, network, card_type, subtype, rate_percentage, is_default } = req.body;

    // Validate required fields
    if (!merchant_id) {
      return res.status(400).json({
        success: false,
        message: 'merchant_id is required'
      });
    }

    if (rate_percentage === undefined || rate_percentage === null) {
      return res.status(400).json({
        success: false,
        message: 'rate_percentage is required'
      });
    }

    // Validate rate_percentage
    const rate = parseFloat(rate_percentage);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({
        success: false,
        message: 'rate_percentage must be a number between 0 and 100'
      });
    }

    // Check for uniqueness - one POS transaction charge per merchant_id
    const [posTransactionCharge, created] = await PosTransactionCharge.findOrCreate({
      where: {
        merchant_id: merchant_id
      },
      defaults: {
        merchant_id,
        method: method || null,
        network: network || null,
        card_type: card_type || null,
        subtype: subtype || null,
        rate_percentage: rate,
        is_default: is_default !== undefined ? Boolean(is_default) : false
      }
    });

    if (!created) {
      return res.status(400).json({
        success: false,
        message: 'POS transaction charge already exists for this merchant'
      });
    }

    res.status(201).json({
      success: true,
      message: 'POS transaction charge created successfully',
      data: posTransactionCharge
    });
  } catch (error) {
    console.error('Create POS transaction charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Get POS Transaction Charge by ID
const getPosTransactionCharge = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'POS transaction charge ID is required'
      });
    }

    const posTransactionCharge = await PosTransactionCharge.findByPk(id);

    if (!posTransactionCharge) {
      return res.status(404).json({
        success: false,
        message: 'POS transaction charge not found'
      });
    }

    res.status(200).json({
      success: true,
      data: posTransactionCharge
    });
  } catch (error) {
    console.error('Get POS transaction charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// List POS Transaction Charges with filters and pagination
const listPosTransactionCharges = asyncHandler(async (req, res) => {
  try {
    const { 
      merchant_id, 
      method,
      network,
      card_type,
      subtype,
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

    if (method) {
      where.method = method;
    }

    if (network) {
      where.network = network;
    }

    if (card_type) {
      where.card_type = card_type;
    }

    if (subtype) {
      where.subtype = subtype;
    }

    if (is_default !== undefined) {
      where.is_default = is_default === 'true' || is_default === true;
    }

    // Get total count and paginated results
    const { count, rows: posTransactionCharges } = await PosTransactionCharge.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    // Fetch merchant details for each POS transaction charge
    const formattedPosTransactionCharges = await Promise.all(posTransactionCharges.map(async (posTransactionCharge) => {
      let merchantDetails = null;
      
      if (posTransactionCharge.merchant_id) {
        merchantDetails = await User.findByPk(posTransactionCharge.merchant_id, {
          attributes: ['id', 'name', 'email', 'mobile_number', 'abheepay_id', 'organization_name']
        });
      }

      return {
        ...posTransactionCharge.toJSON(),
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
      message: 'POS transaction charges retrieved successfully',
      data: formattedPosTransactionCharges,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List POS transaction charges error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Update POS Transaction Charge
const updatePosTransactionCharge = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { merchant_id, method, network, card_type, subtype, rate_percentage, is_default } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'POS transaction charge ID is required'
      });
    }

    const posTransactionCharge = await PosTransactionCharge.findByPk(id);

    if (!posTransactionCharge) {
      return res.status(404).json({
        success: false,
        message: 'POS transaction charge not found'
      });
    }

    // Validate rate_percentage if provided
    if (rate_percentage !== undefined && rate_percentage !== null) {
      const rate = parseFloat(rate_percentage);
      if (isNaN(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({
          success: false,
          message: 'rate_percentage must be a number between 0 and 100'
        });
      }
    }

    // Update only provided fields
    const updateData = {};
    if (merchant_id !== undefined) updateData.merchant_id = merchant_id;
    if (method !== undefined) updateData.method = method || null;
    if (network !== undefined) updateData.network = network || null;
    if (card_type !== undefined) updateData.card_type = card_type || null;
    if (subtype !== undefined) updateData.subtype = subtype || null;
    if (rate_percentage !== undefined && rate_percentage !== null) {
      updateData.rate_percentage = parseFloat(rate_percentage);
    }
    if (is_default !== undefined) updateData.is_default = Boolean(is_default);

    await posTransactionCharge.update(updateData);

    res.status(200).json({
      success: true,
      message: 'POS transaction charge updated successfully',
      data: posTransactionCharge
    });
  } catch (error) {
    console.error('Update POS transaction charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

// Delete POS Transaction Charge
const deletePosTransactionCharge = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'POS transaction charge ID is required'
      });
    }

    const posTransactionCharge = await PosTransactionCharge.findByPk(id);

    if (!posTransactionCharge) {
      return res.status(404).json({
        success: false,
        message: 'POS transaction charge not found'
      });
    }

    await posTransactionCharge.destroy();

    res.status(200).json({
      success: true,
      message: 'POS transaction charge deleted successfully'
    });
  } catch (error) {
    console.error('Delete POS transaction charge error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

module.exports = {
  createPosTransactionCharge,
  getPosTransactionCharge,
  listPosTransactionCharges,
  updatePosTransactionCharge,
  deletePosTransactionCharge
};

