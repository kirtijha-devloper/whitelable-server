const { Op } = require("sequelize");
const {
  ServiceChargeRule,
  PosChargeRule,
  PayoutCharge,
  UserPayoutCharge,
  BbpsCcChargeRule,
  User,
} = require("../models");

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

// 6. Get Applicable Charges for Logged-In Admin (POS Rate, Pay Rate, CC Bill Rate)
exports.getMyApplicableCharges = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized. Authentication required." });
    }

    if (req.user.role !== "admin" && req.user.role !== "super_admin") {
      return res.status(403).json({ success: false, message: "Forbidden. Access is restricted to Admins." });
    }

    const adminId = parseInt(req.user.id, 10);
    const adminUser = await User.findByPk(adminId, {
      attributes: ["id", "name", "username", "role", "company_or_shop_name", "company_id"],
    });

    // ── 1. POS Rates ──────────────────────────────────────────────────────────
    const defaultPosRules = await PosChargeRule.findAll({
      where: {
        scope: { [Op.in]: ["admin_default", "super_admin_default"] },
        user_id: null,
      },
      order: [["id", "ASC"]],
    });

    const adminPosRules = await PosChargeRule.findAll({
      where: {
        user_id: adminId,
      },
      order: [["id", "ASC"]],
    });

    const getPosRuleKey = (r) => {
      if (!r) return "";
      const mode = String(r.payment_mode || "CARD").trim().toUpperCase();
      const brand = String(r.card_brand || "ANY").trim().toUpperCase();
      const type = String(r.card_type || "ANY").trim().toUpperCase();
      const classf = String(r.card_classification || "ANY").trim().toUpperCase();
      const st = String(r.settlement_type || "ANY").trim().toLowerCase();
      const comp = String(r.company_name || "ANY").trim().toUpperCase();
      return `${mode}|${brand}|${type}|${classf}|${st}|${comp}`;
    };

    const adminPosMap = new Map();
    adminPosRules.forEach((ar) => {
      adminPosMap.set(getPosRuleKey(ar), ar);
    });

    const matchedAdminPosIds = new Set();
    const posRows = [];

    defaultPosRules.forEach((dr) => {
      const key = getPosRuleKey(dr);
      const overrideRule = adminPosMap.get(key) || null;
      if (overrideRule) {
        matchedAdminPosIds.add(overrideRule.id);
      }
      const activeRule = overrideRule || dr;
      const isOverridden = Boolean(overrideRule);

      const mode = String(activeRule.payment_mode || "CARD").toUpperCase();
      const cardType = String(activeRule.card_type || "").toUpperCase();
      let serviceName = "POS Card Payment";
      if (mode === "UPI") {
        serviceName = "POS UPI Transaction";
      } else if (cardType && cardType !== "ANY" && cardType !== "UNKNOWN") {
        serviceName = `POS ${cardType.charAt(0) + cardType.slice(1).toLowerCase()} Card`;
      }

      posRows.push({
        id: activeRule.id,
        rule_key: key,
        service_name: serviceName,
        payment_mode: mode,
        card_brand: activeRule.card_brand || "ANY",
        card_type: activeRule.card_type || "ANY",
        card_classification: activeRule.card_classification || "ANY",
        settlement_type: activeRule.settlement_type || "today_settlement",
        min_amount: parseFloat(activeRule.min_amount || 0),
        max_amount: activeRule.max_amount !== null && activeRule.max_amount !== undefined ? parseFloat(activeRule.max_amount) : null,
        charge_percent: parseFloat(activeRule.charge_percent || 0),
        charge_flat: parseFloat(activeRule.charge_flat || 0),
        fee_type: parseFloat(activeRule.charge_flat || 0) > 0 && parseFloat(activeRule.charge_percent || 0) === 0 ? "flat" : "percentage",
        gst_required: Boolean(activeRule.gst_required),
        gst_percent: activeRule.gst_required ? parseFloat(activeRule.gst_percent || 18) : 0,
        rate_source: isOverridden ? "Admin Override" : "Inherited Default",
        source_label: isOverridden ? "Admin Override" : "Inherited Default",
        is_override: isOverridden,
        is_active: Boolean(activeRule.is_active),
        company_name: activeRule.company_name || "ANY",
      });
    });

    adminPosRules.forEach((ar) => {
      if (!matchedAdminPosIds.has(ar.id)) {
        const mode = String(ar.payment_mode || "CARD").toUpperCase();
        const cardType = String(ar.card_type || "").toUpperCase();
        let serviceName = "POS Card Payment";
        if (mode === "UPI") {
          serviceName = "POS UPI Transaction";
        } else if (cardType && cardType !== "ANY" && cardType !== "UNKNOWN") {
          serviceName = `POS ${cardType.charAt(0) + cardType.slice(1).toLowerCase()} Card`;
        }

        posRows.push({
          id: ar.id,
          rule_key: getPosRuleKey(ar),
          service_name: serviceName,
          payment_mode: mode,
          card_brand: ar.card_brand || "ANY",
          card_type: ar.card_type || "ANY",
          card_classification: ar.card_classification || "ANY",
          settlement_type: ar.settlement_type || "today_settlement",
          min_amount: parseFloat(ar.min_amount || 0),
          max_amount: ar.max_amount !== null && ar.max_amount !== undefined ? parseFloat(ar.max_amount) : null,
          charge_percent: parseFloat(ar.charge_percent || 0),
          charge_flat: parseFloat(ar.charge_flat || 0),
          fee_type: parseFloat(ar.charge_flat || 0) > 0 && parseFloat(ar.charge_percent || 0) === 0 ? "flat" : "percentage",
          gst_required: Boolean(ar.gst_required),
          gst_percent: ar.gst_required ? parseFloat(ar.gst_percent || 18) : 0,
          rate_source: "Admin Override",
          source_label: "Admin Override",
          is_override: true,
          is_active: Boolean(ar.is_active),
          company_name: ar.company_name || "ANY",
        });
      }
    });

    // ── 2. Payout (Pay) Rates ─────────────────────────────────────────────────
    const defaultPayoutRules = await PayoutCharge.findAll({
      order: [["from_amount", "ASC"]],
    });

    const adminPayoutRules = await UserPayoutCharge.findAll({
      where: { user_id: adminId },
      order: [["from_amount", "ASC"]],
    });

    const adminPayoutMap = new Map();
    adminPayoutRules.forEach((ar) => {
      const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
      adminPayoutMap.set(slabKey, ar);
    });

    const matchedAdminPayoutIds = new Set();
    const payoutRows = [];

    defaultPayoutRules.forEach((dr) => {
      const slabKey = `${parseFloat(dr.from_amount).toFixed(2)}-${parseFloat(dr.to_amount).toFixed(2)}`;
      const overrideRule = adminPayoutMap.get(slabKey) || null;
      if (overrideRule) {
        matchedAdminPayoutIds.add(overrideRule.id);
      }
      const activeRule = overrideRule || dr;
      const isOverridden = Boolean(overrideRule);

      payoutRows.push({
        id: activeRule.id,
        slab_key: slabKey,
        service_name: activeRule.description || "Payout Bank Transfer",
        payment_mode: "IMPS / NEFT / RTGS",
        transfer_mode: "IMPS / NEFT / RTGS",
        from_amount: parseFloat(activeRule.from_amount || 0),
        to_amount: parseFloat(activeRule.to_amount || 0),
        rate: parseFloat(activeRule.rate || 0),
        rate_type: activeRule.rate_type || "flat",
        gst_required: false,
        gst_percent: 0,
        settlement_type: "Instant (24x7)",
        rate_source: isOverridden ? "Admin Override" : "Inherited Default",
        source_label: isOverridden ? "Admin Override" : "Inherited Default",
        is_override: isOverridden,
        is_active: Boolean(activeRule.is_active),
        description: activeRule.description || "Payout Bank Transfer",
      });
    });

    adminPayoutRules.forEach((ar) => {
      if (!matchedAdminPayoutIds.has(ar.id)) {
        const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
        payoutRows.push({
          id: ar.id,
          slab_key: slabKey,
          service_name: ar.description || "Custom Payout Slab",
          payment_mode: "IMPS / NEFT / RTGS",
          transfer_mode: "IMPS / NEFT / RTGS",
          from_amount: parseFloat(ar.from_amount || 0),
          to_amount: parseFloat(ar.to_amount || 0),
          rate: parseFloat(ar.rate || 0),
          rate_type: ar.rate_type || "flat",
          gst_required: false,
          gst_percent: 0,
          settlement_type: "Instant (24x7)",
          rate_source: "Admin Override",
          source_label: "Admin Override",
          is_override: true,
          is_active: Boolean(ar.is_active),
          description: ar.description || "Custom Payout Slab",
        });
      }
    });

    payoutRows.sort((a, b) => a.from_amount - b.from_amount);

    // ── 3. CC Bill Rates ──────────────────────────────────────────────────────
    const defaultCcBillRules = await BbpsCcChargeRule.findAll({
      where: { user_id: null },
      order: [["from_amount", "ASC"]],
    });

    const adminCcBillRules = await BbpsCcChargeRule.findAll({
      where: { user_id: adminId },
      order: [["from_amount", "ASC"]],
    });

    const adminCcBillMap = new Map();
    adminCcBillRules.forEach((ar) => {
      const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
      adminCcBillMap.set(slabKey, ar);
    });

    const matchedAdminCcBillIds = new Set();
    const ccBillRows = [];

    defaultCcBillRules.forEach((dr) => {
      const slabKey = `${parseFloat(dr.from_amount).toFixed(2)}-${parseFloat(dr.to_amount).toFixed(2)}`;
      const overrideRule = adminCcBillMap.get(slabKey) || null;
      if (overrideRule) {
        matchedAdminCcBillIds.add(overrideRule.id);
      }
      const activeRule = overrideRule || dr;
      const isOverridden = Boolean(overrideRule);

      ccBillRows.push({
        id: activeRule.id,
        slab_key: slabKey,
        service_name: activeRule.description || "BBPS Credit Card Bill Payment",
        payment_mode: "BBPS CC Bill",
        from_amount: parseFloat(activeRule.from_amount || 0),
        to_amount: parseFloat(activeRule.to_amount || 0),
        rate: parseFloat(activeRule.rate || 0),
        rate_type: activeRule.rate_type || "flat",
        gst_required: false,
        gst_percent: 0,
        settlement_type: "Standard BBPS",
        rate_source: isOverridden ? "Admin Override" : "Inherited Default",
        source_label: isOverridden ? "Admin Override" : "Inherited Default",
        is_override: isOverridden,
        is_active: Boolean(activeRule.is_active),
        description: activeRule.description || "BBPS Credit Card Bill Payment",
      });
    });

    adminCcBillRules.forEach((ar) => {
      if (!matchedAdminCcBillIds.has(ar.id)) {
        const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
        ccBillRows.push({
          id: ar.id,
          slab_key: slabKey,
          service_name: ar.description || "Custom BBPS CC Slab",
          payment_mode: "BBPS CC Bill",
          from_amount: parseFloat(ar.from_amount || 0),
          to_amount: parseFloat(ar.to_amount || 0),
          rate: parseFloat(ar.rate || 0),
          rate_type: ar.rate_type || "flat",
          gst_required: false,
          gst_percent: 0,
          settlement_type: "Standard BBPS",
          rate_source: "Admin Override",
          source_label: "Admin Override",
          is_override: true,
          is_active: Boolean(ar.is_active),
          description: ar.description || "Custom BBPS CC Slab",
        });
      }
    });

    ccBillRows.sort((a, b) => a.from_amount - b.from_amount);

    return res.status(200).json({
      success: true,
      admin: adminUser
        ? {
            id: adminUser.id,
            name: adminUser.name,
            username: adminUser.username,
            role: adminUser.role,
            company_name: adminUser.company_or_shop_name,
          }
        : { id: adminId },
      data: {
        pos: posRows,
        payout: payoutRows,
        pay: payoutRows,
        cc_bill: ccBillRows,
        ccBill: ccBillRows,
      },
      categories: {
        pos: posRows,
        payout: payoutRows,
        pay: payoutRows,
        cc_bill: ccBillRows,
        ccBill: ccBillRows,
      },
      summary: {
        totalPosRules: posRows.length,
        totalPayoutRules: payoutRows.length,
        totalCcBillRules: ccBillRows.length,
      },
    });
  } catch (error) {
    console.error("Error in getMyApplicableCharges:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch applicable charges" });
  }
};
