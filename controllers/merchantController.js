const asyncHandler = require("express-async-handler");
const User = require('../models/User');
const MerchantTransactionCharge = require('../models/MerchantTransactionCharge');
const PosMachine = require('../models/posMachine');
const { Op, Sequelize } = require("sequelize");
const bcrypt = require("bcrypt");

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const onBoardUser = asyncHandler(async(req, res) => {
   try{
    
    const role = "merchant"
    // const { email, password, mobile_number } = req.body

    // if (!email || !mobile_number || !password) {
    //     res.status(400);
    //     throw new Error("email, mobile_number and password fields are mandatory. !") ;
    // }


    // const existingUser = await User.findOne({
    //     where: {
    //         [Op.or]: [
    //             { email: email },
    //             { mobile_number: mobile_number }
    //         ]
    //     }
    //     });

    const {id} = req.params

    const user = await User.findByPk(id)

    if (!user) {
        res.status(400);
        throw new Error("User does not exists!");
    };
   

      const panFile = req.files?.pan_photo;
      console.log("test", panFile)
      const aadharFile = req.files?.aadhar_photo;
      const shopFile = req.files?.shop_photo;

       const panUrl = panFile ? await cloudinary.uploader.upload(panFile.tempFilePath, {
        folder: "franchaise",
      }) : null;

      const aadharUrl = aadharFile ? await cloudinary.uploader.upload(aadharFile.tempFilePath, {
        folder: "franchaise",
      }) : null;

      const shopUrl = shopFile ? await cloudinary.uploader.upload(shopFile.tempFilePath, {
        folder: "franchaise",
      }) : null;

      user.set({
      role: role,
      is_approved: true,
      organization_name: req.body.organization_name,
      dob: req.body.dob,
      gender: req.body.gender,
      address1: req.body.address1,
      address2: req.body.address2,
      city: req.body.city,
      district: req.body.district,
      pincode: req.body.pincode,
      state: req.body.state,
      country: req.body.country,
      pan_number: req.body.pan_number,
      aadhar_number: req.body.aadhar_number,
      pan_number_url: panUrl?.secure_url || user.pan_number_url,
      aadhar_number_url: aadharUrl?.secure_url || user.aadhar_number_url,
      shop_with_photo_url: shopUrl?.secure_url || user.shop_with_photo_url,
      status: "active"
    });

await user.save();

    if (user) {
        res.status(200).json({id: user.id})
    } else {
        res.status(400);
        throw new Error("User is not valid !")
    }
    } catch (error) {
      res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
    }
});

const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findByPk(id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
if (user.role !== "merchant") {
    res.status(404);
    throw new Error('User not found');
}
  res.status(200).json(user);
});

const getUsers = asyncHandler(async (req, res) => {
  try {
    const { 
      status = "active",
      page = 1,
      limit = 10
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (req.user.role === "franchaise" || req.user.role === "franchise") {
      const userId = req.user.id;
      if (userId) where.franchaise_id = userId;
      if (status) where.status = status;
    } else if (req.user.role === "super_franchise") {
      where.role = "merchant";
      where.super_franchise_id = req.user.id;
      if (status) where.status = status;
    } else {
      // For admin or other roles, show all merchants
      where.role = "merchant";
      if (status) where.status = status;
    }

    // Get total count and paginated results
    const { count, rows: users } = await User.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, is_payout_enabled } = req.body;

  if (status === undefined && is_payout_enabled === undefined) {
    res.status(400);
    throw new Error('Either status or is_payout_enabled is required');
  }

  const user = await User.findByPk(id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  if (status !== undefined) {
    user.status = status;
  }

  if (is_payout_enabled !== undefined) {
    user.is_payout_enabled = !!is_payout_enabled;
  }

  await user.save();

  res.status(200).json({
    message: 'User updated',
    id,
    status: user.status,
    is_payout_enabled: user.is_payout_enabled,
  });
});

// List Merchant Transaction Charges (deducted amounts per merchant)
const listMerchantTransactionCharges = asyncHandler(async (req, res) => {
  try {
    const { 
      merchant_id, 
      pos_machine_id,
      start_date,
      end_date,
      page = 1, 
      limit = 10 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    const userRole = req.user?.role;
    const userId = req.user?.id;

    // Role-based filtering
    if (userRole === 'merchant') {
      // Merchants can only see their own transaction charges
      where.merchant_id = userId;
    } else if (userRole === 'franchaise') {
      // Franchise can see charges for their assigned merchants
      const machines = await PosMachine.findAll({
        where: { assigned_to: userId },
        attributes: ['assigned_to']
      });
      const assignedUserIds = machines.map(m => m.assigned_to).filter(Boolean);
      if (assignedUserIds.length > 0) {
        where.merchant_id = { [Op.in]: assignedUserIds };
      } else {
        // No merchants assigned, return empty result
        return res.status(200).json({
          success: true,
          message: 'No transaction charges found',
          data: [],
          pagination: {
            total: 0,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: 0
          },
          summary: {
            total_transactions: 0,
            total_transaction_amount: 0,
            total_charge_amount: 0,
            total_net_amount: 0
          }
        });
      }
    } else if (userRole === 'admin') {
      // Admin can see all, but can filter by merchant_id if provided
      if (merchant_id) {
        where.merchant_id = merchant_id;
      }
    } else {
      // Default: only own transactions
      where.merchant_id = userId;
    }

    // Additional filters
    if (pos_machine_id) {
      where.pos_machine_id = pos_machine_id;
    }

    // Date range filtering
    if (start_date || end_date) {
      where.createdAt = {};
      if (start_date) {
        where.createdAt[Op.gte] = new Date(start_date);
      }
      if (end_date) {
        // Add 23:59:59 to end_date to include the entire day
        const endDate = new Date(end_date);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt[Op.lte] = endDate;
      }
    }

    // Get total count and paginated results
    const { count, rows: transactionCharges } = await MerchantTransactionCharge.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    // Fetch merchant and POS machine details for each transaction charge
    const formattedTransactionCharges = await Promise.all(transactionCharges.map(async (charge) => {
      let merchantDetails = null;
      let posMachineDetails = null;
      
      if (charge.merchant_id) {
        merchantDetails = await User.findByPk(charge.merchant_id, {
          attributes: ['id', 'name', 'email', 'mobile_number', 'abheepay_id', 'organization_name']
        });
      }

      if (charge.pos_machine_id) {
        posMachineDetails = await PosMachine.findByPk(charge.pos_machine_id, {
          attributes: ['id', 'mid_number', 'tid_number', 'device_serial_number']
        });
      }

      return {
        id: charge.id,
        razorpay_transaction_id: charge.razorpay_transaction_id,
        transaction_amount: parseFloat(charge.transaction_amount),
        charge_amount: parseFloat(charge.charge_amount), // Deducted amount
        net_amount: parseFloat(charge.net_amount),
        charge_rate: parseFloat(charge.charge_rate),
        payment_method: charge.payment_method,
        payment_card_type: charge.payment_card_type,
        payment_card_brand: charge.payment_card_brand,
        rr_number: charge.rr_number,
        mid_number: charge.mid_number,
        tid_number: charge.tid_number,
        customer_name: charge.customer_name,
        createdAt: charge.createdAt,
        updatedAt: charge.updatedAt,
        merchant: merchantDetails ? {
          id: merchantDetails.id,
          name: merchantDetails.name,
          email: merchantDetails.email,
          mobile_number: merchantDetails.mobile_number,
          abheepay_id: merchantDetails.abheepay_id,
          organization_name: merchantDetails.organization_name
        } : null,
        pos_machine: posMachineDetails ? {
          id: posMachineDetails.id,
          mid_number: posMachineDetails.mid_number,
          tid_number: posMachineDetails.tid_number,
          device_serial_number: posMachineDetails.device_serial_number
        } : null
      };
    }));

    // Calculate summary totals
    const allCharges = await MerchantTransactionCharge.findAll({
      where,
      attributes: [
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_transactions'],
        [Sequelize.fn('SUM', Sequelize.col('transaction_amount')), 'total_transaction_amount'],
        [Sequelize.fn('SUM', Sequelize.col('charge_amount')), 'total_charge_amount'],
        [Sequelize.fn('SUM', Sequelize.col('net_amount')), 'total_net_amount']
      ],
      raw: true
    });

    const summary = allCharges[0] || {
      total_transactions: 0,
      total_transaction_amount: 0,
      total_charge_amount: 0,
      total_net_amount: 0
    };

    res.status(200).json({
      success: true,
      message: 'Merchant transaction charges retrieved successfully',
      data: formattedTransactionCharges,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      },
      summary: {
        total_transactions: parseInt(summary.total_transactions) || 0,
        total_transaction_amount: parseFloat(summary.total_transaction_amount) || 0,
        total_charge_amount: parseFloat(summary.total_charge_amount) || 0, // Total deducted
        total_net_amount: parseFloat(summary.total_net_amount) || 0
      }
    });
  } catch (error) {
    console.error('List merchant transaction charges error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Something went wrong'
    });
  }
});

/**
 * PUT /api/merchant/:id/ipay-outlet
 * Set (or update) the InstantPay outlet ID for a merchant.
 * PHP equivalent: the outlet stored in session('outlet') per user.
 * Admin / franchaise only.
 */
const setIpayOutletId = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { ipay_outlet_id } = req.body;

  if (ipay_outlet_id === undefined) {
    res.status(400);
    throw new Error('ipay_outlet_id is required');
  }

  let parsed = null;
  if (ipay_outlet_id !== null) {
    parsed = parseInt(ipay_outlet_id, 10);
    if (isNaN(parsed)) {
      res.status(400);
      throw new Error('ipay_outlet_id must be a valid integer or null');
    }
  }

  const user = await User.findByPk(id);
  if (!user || user.role !== 'merchant') {
    res.status(404);
    throw new Error('Merchant not found');
  }

  user.ipay_outlet_id = parsed;
  await user.save();

  return res.status(200).json({
    success: true,
    message: 'InstantPay outlet ID updated',
    data: { id: user.id, ipay_outlet_id: user.ipay_outlet_id }
  });
});

module.exports = {onBoardUser, getUserById, getUsers, updateUserStatus, listMerchantTransactionCharges, setIpayOutletId}