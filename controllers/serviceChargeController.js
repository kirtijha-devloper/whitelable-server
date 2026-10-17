const { ServiceChargeRule } = require("../models");

// 1. Get All Service Charge Rules
exports.getAllServiceCharges = async (req, res) => {
  try {
    const { service_key, category, target_role, payment_mode, is_active } = req.query;
    const where = {};
    if (service_key && service_key !== "all" && service_key !== "All Services") {
      where.service_key = service_key;
    }
    if (category && category !== "All" && category !== "all") {
      where.category = category;
    }
    if (target_role && target_role !== "all") {
      where.target_role = target_role;
    }
    if (payment_mode && payment_mode !== "ALL" && payment_mode !== "all") {
      where.payment_mode = payment_mode;
    }
    if (is_active !== undefined && is_active !== "all") {
      where.is_active = is_active === "true" || is_active === true || is_active === 1 || is_active === "1";
    }

    const rules = await ServiceChargeRule.findAll({
      where,
      order: [["created_at", "DESC"]],
    });
    return res.status(200).json({ success: true, data: rules });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Create Charge Rule
exports.createServiceCharge = async (req, res) => {
  try {
    const {
      service_key,
      service_name,
      category,
      min_amount,
      max_amount,
      fee_type,
      flat_fee,
      percent_fee,
      gst_percent,
      is_gst_inclusive,
      target_role,
      payment_mode,
      is_active,
    } = req.body;

    if (!service_key) {
      return res.status(400).json({ success: false, message: "service_key is required" });
    }

    const rule = await ServiceChargeRule.create({
      service_key,
      service_name: service_name || service_key,
      category: category || "General",
      min_amount: parseFloat(min_amount) || 0,
      max_amount: parseFloat(max_amount) || 0,
      fee_type: fee_type || "flat",
      flat_fee: parseFloat(flat_fee) || 0,
      percent_fee: parseFloat(percent_fee) || 0,
      gst_percent: gst_percent !== undefined ? parseFloat(gst_percent) : 18.0,
      is_gst_inclusive: Boolean(is_gst_inclusive),
      target_role: target_role || "all",
      payment_mode: payment_mode || "ALL",
      is_active: is_active !== undefined ? Boolean(is_active) : true,
      created_by: req.user?.id || null,
    });

    return res.status(201).json({ success: true, message: "Charge rule created", data: rule });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Update Charge Rule
exports.updateServiceCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await ServiceChargeRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ success: false, message: "Rule not found" });
    }

    const payload = { ...req.body };
    if (payload.min_amount !== undefined) payload.min_amount = parseFloat(payload.min_amount) || 0;
    if (payload.max_amount !== undefined) payload.max_amount = parseFloat(payload.max_amount) || 0;
    if (payload.flat_fee !== undefined) payload.flat_fee = parseFloat(payload.flat_fee) || 0;
    if (payload.percent_fee !== undefined) payload.percent_fee = parseFloat(payload.percent_fee) || 0;
    if (payload.gst_percent !== undefined) payload.gst_percent = parseFloat(payload.gst_percent) || 0;
    if (payload.is_gst_inclusive !== undefined) payload.is_gst_inclusive = Boolean(payload.is_gst_inclusive);
    if (payload.is_active !== undefined) payload.is_active = Boolean(payload.is_active);

    await rule.update(payload);
    return res.status(200).json({ success: true, message: "Rule updated", data: rule });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Delete Charge Rule
exports.deleteServiceCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await ServiceChargeRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ success: false, message: "Rule not found" });
    }
    await rule.destroy();
    return res.status(200).json({ success: true, message: "Rule deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Toggle Rule Active Status
exports.toggleServiceChargeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await ServiceChargeRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ success: false, message: "Rule not found" });
    }
    const nextStatus = req.body.is_active !== undefined ? Boolean(req.body.is_active) : !rule.is_active;
    await rule.update({ is_active: nextStatus });
    return res.status(200).json({
      success: true,
      message: `Rule ${nextStatus ? "activated" : "deactivated"} successfully`,
      data: rule,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const PosChargeRule = require("../models/PosChargeRule");
const Rental = require("../models/Rental");
const BbpsCcChargeRule = require("../models/BbpsCcChargeRule");
const PayoutCharge = require("../models/PayoutCharge");
const UserPayoutCharge = require("../models/UserPayoutCharge");
const User = require("../models/User");
const { normalizeRole } = require("../utils/permissions");
const { Op } = require("sequelize");

// 6. Get My Applicable Charges (Inherited Base Rates for Logged-In User)
exports.getMyApplicableCharges = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: false, success: false, message: "Unauthorized" });
    }

    const role = normalizeRole(user.role);
    const userId = Number(user.id);
    const dbUser = await User.findByPk(userId);
    const franchiseId = dbUser?.franchaise_id || user.franchaise_id || null;
    const superFranchiseId = dbUser?.super_franchise_id || user.super_franchise_id || null;

    // ── 1. POS Applicable Rules ──────────────────────────────────────────────
    let posWhere = { is_active: true };

    if (role === "super_admin" || role === "admin") {
      posWhere.scope = { [Op.in]: ["admin_default", "super_admin_default"] };
    } else if (role === "super_franchise") {
      const sfSpecific = await PosChargeRule.findAll({
        where: {
          super_franchise_id: userId,
          scope: "admin_super_franchise",
          is_active: true,
        },
      });
      if (sfSpecific.length > 0) {
        posWhere = { id: { [Op.in]: sfSpecific.map((r) => r.id) } };
      } else {
        posWhere.scope = "admin_default";
      }
    } else if (role === "franchise" || role === "franchaise") {
      const franchiseSpecific = await PosChargeRule.findAll({
        where: {
          franchaise_id: userId,
          scope: { [Op.in]: ["super_franchise_franchise", "admin_franchise"] },
          is_active: true,
        },
      });
      if (franchiseSpecific.length > 0) {
        posWhere = { id: { [Op.in]: franchiseSpecific.map((r) => r.id) } };
      } else if (superFranchiseId) {
        const sfDefaults = await PosChargeRule.findAll({
          where: {
            super_franchise_id: superFranchiseId,
            scope: "super_franchise_default",
            is_active: true,
          },
        });
        if (sfDefaults.length > 0) {
          posWhere = { id: { [Op.in]: sfDefaults.map((r) => r.id) } };
        } else {
          posWhere.scope = "admin_default";
        }
      } else {
        posWhere.scope = "admin_default";
      }
    } else {
      const merchantSpecific = await PosChargeRule.findAll({
        where: {
          user_id: userId,
          scope: { [Op.in]: ["franchise_merchant", "admin_merchant"] },
          is_active: true,
        },
      });
      if (merchantSpecific.length > 0) {
        posWhere = { id: { [Op.in]: merchantSpecific.map((r) => r.id) } };
      } else if (franchiseId) {
        const fDefaults = await PosChargeRule.findAll({
          where: {
            franchaise_id: franchiseId,
            scope: "franchise_default",
            is_active: true,
          },
        });
        if (fDefaults.length > 0) {
          posWhere = { id: { [Op.in]: fDefaults.map((r) => r.id) } };
        } else {
          posWhere.scope = "admin_default";
        }
      } else {
        posWhere.scope = "admin_default";
      }
    }

    const posRulesRaw = await PosChargeRule.findAll({
      where: posWhere,
      order: [["id", "ASC"]],
    });

    const pos = posRulesRaw.map((r) => ({
      id: r.id,
      payment_mode: r.payment_mode || "CARD",
      card_type: r.card_type || "ANY",
      card_brand: r.card_brand || "ANY",
      card_classification: r.card_classification || "ANY",
      settlement_type: r.settlement_type || "ANY",
      min_amount: parseFloat(r.min_amount) || 0,
      max_amount: r.max_amount !== null && r.max_amount !== undefined ? parseFloat(r.max_amount) : 100000,
      charge_percent: parseFloat(r.charge_percent) || 0,
      charge_value: parseFloat(r.charge_percent) || 0,
      charge_type: "percentage",
      gst_required: Boolean(r.gst_required),
      gst_percent: parseFloat(r.gst_percent) || 18,
    }));

    // ── 2. Rental Applicable Rules ───────────────────────────────────────────
    let rentalRate = null;
    if (role === "super_franchise") {
      rentalRate = (await Rental.findOne({
        where: {
          super_franchise_id: userId,
          status: "active",
        },
      })) || (await Rental.findOne({
        where: {
          target_user_type: "super_franchise",
          status: "active",
        },
      }));
    } else if (role === "franchise" || role === "franchaise") {
      rentalRate = (await Rental.findOne({
        where: {
          franchaise_id: userId,
          status: "active",
        },
      })) || (await Rental.findOne({
        where: {
          target_user_type: "franchise",
          status: "active",
        },
      }));
    } else if (role === "merchant") {
      rentalRate = await Rental.findOne({
        where: {
          target_user_type: "merchant",
          status: "active",
        },
      });
    }

    if (!rentalRate) {
      rentalRate = await Rental.findOne({ where: { status: "active" } });
    }

    const monthlyRent = rentalRate ? parseFloat(rentalRate.amount) : 500;
    const dailyRent = parseFloat((monthlyRent / 30).toFixed(2));

    const rental = {
      monthly_rent: monthlyRent,
      daily_rent: dailyRent,
      plan_type: "MONTHLY",
      amount: monthlyRent,
      franchise_rate: monthlyRent,
      merchant_rate: monthlyRent,
      description: "Standard POS Terminal",
    };

    // ── 3. CC Bill Applicable Rules ──────────────────────────────────────────
    const ccBillRulesRaw = await BbpsCcChargeRule.findAll({
      where: { is_active: true },
      order: [["from_amount", "ASC"]],
    });

    const cc_bill = ccBillRulesRaw.map((r) => ({
      id: r.id,
      service_name: "BBPS CC Bill Pay",
      from_amount: parseFloat(r.from_amount) || 0,
      to_amount: parseFloat(r.to_amount) || 0,
      min_amount: parseFloat(r.from_amount) || 0,
      max_amount: parseFloat(r.to_amount) || 0,
      rate: parseFloat(r.rate) || 0,
      charge_value: parseFloat(r.rate) || 0,
      rate_type: r.rate_type || "percentage",
      gst_percent: 18,
    }));

    // ── 4. Payout Applicable Rules ───────────────────────────────────────────
    let payoutRulesRaw = [];
    if (userId) {
      payoutRulesRaw = await UserPayoutCharge.findAll({
        where: { user_id: userId },
        order: [["from_amount", "ASC"]],
      });
    }

    if (payoutRulesRaw.length === 0) {
      payoutRulesRaw = await PayoutCharge.findAll({
        where: { is_active: true },
        order: [["from_amount", "ASC"]],
      });
    }

    const payout = payoutRulesRaw.map((r) => ({
      id: r.id,
      transfer_mode: "IMPS / NEFT / RTGS",
      from_amount: parseFloat(r.from_amount) || 0,
      to_amount: parseFloat(r.to_amount) || 0,
      min_amount: parseFloat(r.from_amount) || 0,
      max_amount: parseFloat(r.to_amount) || 0,
      rate: parseFloat(r.rate) || 0,
      charge_value: parseFloat(r.rate) || 0,
      rate_type: r.rate_type || "flat",
      gst_percent: 18,
    }));

    return res.status(200).json({
      status: true,
      success: true,
      message: "Applicable charges fetched successfully",
      data: {
        pos,
        rental,
        cc_bill,
        payout,
      },
    });
  } catch (error) {
    console.error("getMyApplicableCharges error:", error);
    return res.status(500).json({
      status: false,
      success: false,
      message: error.message || "Something went wrong fetching applicable charges",
    });
  }
};
