const asyncHandler = require("express-async-handler");
const User = require('../models/User');
const PosMachine = require('../models/posMachine');
const { Op } = require("sequelize");
const db = require('../config/database');
const { normalizeRole } = require("../utils/permissions");

/**
 * GET /api/super-franchise
 * Fetch list of all Super Franchises (Admin / Employee access)
 */
const getSuperFranchises = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : '';

    const whereClause = {
      role: 'super_franchise',
      status: 'active'
    };

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { mobile_number: { [Op.iLike]: `%${search}%` } },
        { username: { [Op.iLike]: `%${search}%` } },
        { abheepay_id: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [['id', 'DESC']],
      attributes: [
        'id', 'name', 'email', 'mobile_number', 'username', 'abheepay_id',
        'wallet', 'is_approved', 'status', 'createdAt'
      ]
    });

    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching super franchises"
    });
  }
});

/**
 * GET /api/super-franchise/:id
 * Fetch single Super Franchise details with metrics
 */
const getSuperFranchiseById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const superFranchise = await User.findOne({
      where: { id, role: 'super_franchise' }
    });

    if (!superFranchise) {
      return res.status(404).json({
        success: false,
        message: "Super Franchise not found"
      });
    }

    const totalFranchises = await User.count({
      where: { super_franchise_id: id, role: { [Op.in]: ['franchise', 'franchaise'] }, status: 'active' }
    });

    const totalMerchants = await User.count({
      where: { super_franchise_id: id, role: 'merchant', status: 'active' }
    });

    const totalPosMachines = await PosMachine.count({
      where: { super_franchise_id: id }
    });

    res.status(200).json({
      success: true,
      data: {
        superFranchise,
        metrics: {
          totalFranchises,
          totalMerchants,
          totalPosMachines
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching super franchise detail"
    });
  }
});

/**
 * GET /api/super-franchise/:id/franchises
 * Fetch all Franchises linked to this Super Franchise
 */
const getSuperFranchiseFranchises = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await User.findAndCountAll({
      where: {
        super_franchise_id: id,
        role: { [Op.in]: ['franchise', 'franchaise'] },
        status: 'active'
      },
      limit,
      offset,
      order: [['id', 'DESC']]
    });

    res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Error fetching franchises under super franchise"
    });
  }
});

/**
 * PUT /api/super-franchise/assign-franchise
 * Assign or reassign a Franchise to a Super Franchise
 */
const assignFranchiseToSuperFranchise = asyncHandler(async (req, res) => {
  try {
    const { franchise_id, super_franchise_id } = req.body;

    if (!franchise_id) {
      return res.status(400).json({
        success: false,
        message: "franchise_id is required"
      });
    }

    const franchise = await User.findByPk(franchise_id);
    if (!franchise || !['franchise', 'franchaise'].includes(normalizeRole(franchise.role))) {
      return res.status(404).json({
        success: false,
        message: "Target user is not a valid Franchise"
      });
    }

    if (super_franchise_id) {
      const sf = await User.findByPk(super_franchise_id);
      if (!sf || normalizeRole(sf.role) !== 'super_franchise') {
        return res.status(400).json({
          success: false,
          message: "Invalid Super Franchise specified"
        });
      }
    }

    franchise.super_franchise_id = super_franchise_id || null;
    await franchise.save();

    // Also update all downstream merchants under this franchise to point to the new super_franchise_id
    await User.update(
      { super_franchise_id: super_franchise_id || null },
      { where: { franchaise_id: franchise.id, role: 'merchant' } }
    );

    res.status(200).json({
      success: true,
      message: `Franchise ${franchise.username || franchise.name} successfully assigned to Super Franchise.`,
      data: franchise
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Error assigning franchise to super franchise"
    });
  }
});

module.exports = {
  getSuperFranchises,
  getSuperFranchiseById,
  getSuperFranchiseFranchises,
  assignFranchiseToSuperFranchise
};
