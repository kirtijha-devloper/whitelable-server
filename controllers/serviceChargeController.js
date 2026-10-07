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
