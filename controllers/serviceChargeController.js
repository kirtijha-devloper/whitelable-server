const { Op } = require("sequelize");
const {
  ServiceChargeRule,
  PosChargeRule,
  PayoutCharge,
  UserPayoutCharge,
  BbpsCcChargeRule,
  Rental,
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

// 6. Get Applicable Charges for Logged-In User (Super Admin, Admin, Super Franchise, Franchise, Merchant)
exports.getMyApplicableCharges = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized. Authentication required." });
    }

    const currentUserId = parseInt(req.user.id, 10);
    const currentUser = await User.findByPk(currentUserId, {
      attributes: ["id", "name", "username", "role", "company_or_shop_name", "company_id", "franchaise_id", "super_franchise_id"],
    });

    if (!currentUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const userRole = (currentUser.role || req.user.role || "").toLowerCase();
    const isSuperAdmin = userRole === "super_admin";
    const isAdmin = userRole === "admin";
    const isSuperFranchise = userRole === "super_franchise";
    const isFranchise = userRole === "franchaise" || userRole === "franchise";
    const isMerchant = userRole === "merchant";

    // ── 1. POS Rates ──────────────────────────────────────────────────────────
    let defaultPosRules = await PosChargeRule.findAll({
      where: {
        scope: "super_admin_default",
        user_id: null,
        franchaise_id: null,
        super_franchise_id: null,
        is_active: true,
      },
      order: [["id", "ASC"]],
    });

    if (defaultPosRules.length === 0) {
      defaultPosRules = await PosChargeRule.findAll({
        where: {
          scope: "admin_default",
          user_id: null,
          franchaise_id: null,
          super_franchise_id: null,
          is_active: true,
        },
        order: [["id", "ASC"]],
      });
    }

    // Query candidate rules that might apply to this user based on hierarchy
    let applicablePosRules = [];
    if (isAdmin) {
      applicablePosRules = await PosChargeRule.findAll({
        where: {
          user_id: currentUserId,
          is_active: true,
        },
        order: [["id", "ASC"]],
      });
    } else if (isSuperFranchise) {
      const orConditions = [
        { super_franchise_id: currentUserId, scope: "admin_super_franchise" },
        { user_id: currentUserId },
      ];
      if (currentUser.company_id) {
        const adminUser = await User.findOne({
          where: { role: "admin", company_id: currentUser.company_id },
          attributes: ["id"],
        });
        if (adminUser) {
          orConditions.push({
            user_id: adminUser.id,
            scope: "super_admin_admin",
          });
        }
        orConditions.push({
          company_id: currentUser.company_id,
          scope: { [Op.in]: ["super_admin_admin", "admin_default"] },
        });
      }
      applicablePosRules = await PosChargeRule.findAll({
        where: {
          [Op.or]: orConditions,
          is_active: true,
        },
        order: [["id", "ASC"]],
      });
    } else if (isFranchise) {
      let effectiveSuperFranchiseId = currentUser.super_franchise_id;
      if (!effectiveSuperFranchiseId) {
        const fUser = await User.findByPk(currentUserId, { attributes: ["id", "super_franchise_id", "created_by"] });
        if (fUser?.super_franchise_id) {
          effectiveSuperFranchiseId = fUser.super_franchise_id;
        } else if (fUser?.created_by) {
          const creator = await User.findByPk(fUser.created_by, { attributes: ["id", "role"] });
          if (creator && (creator.role === "super_franchise" || creator.role === "superfranchise")) {
            effectiveSuperFranchiseId = creator.id;
          }
        }
      }

      const orConditions = [
        { franchaise_id: currentUserId },
        { user_id: currentUserId },
      ];
      if (effectiveSuperFranchiseId) {
        orConditions.push(
          { super_franchise_id: effectiveSuperFranchiseId, scope: "super_franchise_default" },
          { super_franchise_id: effectiveSuperFranchiseId, franchaise_id: currentUserId, scope: "super_franchise_franchise" }
        );
      }
      if (currentUser.company_id) {
        const adminUser = await User.findOne({
          where: { role: "admin", company_id: currentUser.company_id },
          attributes: ["id"],
        });
        if (adminUser) {
          orConditions.push({
            user_id: adminUser.id,
            scope: "super_admin_admin",
          });
        }
        orConditions.push({
          company_id: currentUser.company_id,
          scope: { [Op.in]: ["super_admin_admin", "admin_default"] },
        });
      }
      applicablePosRules = await PosChargeRule.findAll({
        where: {
          [Op.or]: orConditions,
          is_active: true,
        },
        order: [["id", "ASC"]],
      });
    } else if (isMerchant) {
      const orConditions = [{ user_id: currentUserId }];
      if (currentUser.franchaise_id) {
        orConditions.push({
          franchaise_id: currentUser.franchaise_id,
        });
      }
      if (currentUser.super_franchise_id) {
        orConditions.push({
          super_franchise_id: currentUser.super_franchise_id,
        });
      }
      if (currentUser.company_id) {
        orConditions.push({
          company_id: currentUser.company_id,
          scope: { [Op.in]: ["super_admin_admin", "admin_default"] },
        });
      }
      applicablePosRules = await PosChargeRule.findAll({
        where: {
          [Op.or]: orConditions,
          is_active: true,
        },
        order: [["id", "ASC"]],
      });
    }

    const getPosRuleKey = (r) => {
      if (!r) return "";
      const mode = String(r.payment_mode || "CARD").trim().toUpperCase();
      const brand = String(r.card_brand || "ANY").trim().toUpperCase();
      const type = String(r.card_type || "ANY").trim().toUpperCase();
      const classf = String(r.card_classification || "ANY").trim().toUpperCase();
      const st = String(r.settlement_type || "ANY").trim().toLowerCase();
      const comp = String(r.company_name || "ANY").trim().toUpperCase();
      const minA = parseFloat(r.min_amount || 0).toFixed(2);
      const maxA = r.max_amount != null ? parseFloat(r.max_amount).toFixed(2) : "INF";
      return `${mode}|${brand}|${type}|${classf}|${st}|${comp}|${minA}|${maxA}`;
    };

    const getRulePrecedence = (rule) => {
      if (!rule) return 0;
      if (isAdmin) {
        return rule.user_id === currentUserId ? 100 : 10;
      }
      if (isSuperFranchise) {
        if (rule.super_franchise_id === currentUserId && rule.scope === "admin_super_franchise") return 100;
        if (rule.user_id === currentUserId && rule.scope === "admin_super_franchise") return 100;
        if (rule.scope === "super_admin_admin" || (currentUser.company_id && rule.company_id === currentUser.company_id)) return 50;
        return 10;
      }
      if (isFranchise) {
        // Nearest upline is Super Franchise override specifically for this franchise!
        if (rule.scope === "super_franchise_franchise" && (Number(rule.franchaise_id) === Number(currentUserId) || Number(rule.franchaise_id) === Number(currentUser.id))) return 120;
        if (rule.user_id === currentUserId && rule.scope === "franchise_default") return 110;
        // Nearest upline default from Super Franchise
        if (rule.scope === "super_franchise_default" && currentUser.super_franchise_id && Number(rule.super_franchise_id) === Number(currentUser.super_franchise_id)) return 95;
        // Admin specific override for this franchise
        if (rule.scope === "admin_franchise" && (Number(rule.franchaise_id) === Number(currentUserId) || Number(rule.user_id) === Number(currentUserId))) return 80;
        // Admin default for company
        if (rule.scope === "admin_default" || (currentUser.company_id && rule.company_id === currentUser.company_id) || rule.scope === "super_admin_admin") return 50;
        return 10;
      }
      if (isMerchant) {
        // 1. Direct merchant overrides:
        if (Number(rule.user_id) === Number(currentUserId)) {
          if (rule.scope === "franchise_merchant") return 140; // set by immediate upline franchise
          if (rule.scope === "super_franchise_merchant") return 130; // set by super franchise
          if (rule.scope === "admin_merchant") return 120; // set by admin
          return 110;
        }
        // 2. Rules tied to merchant's franchise:
        if (currentUser.franchaise_id && Number(rule.franchaise_id) === Number(currentUser.franchaise_id)) {
          if (rule.scope === "super_franchise_franchise") return 95;
          if (rule.scope === "franchise_default") return 90;
          if (rule.scope === "admin_franchise") return 80;
        }
        // 3. Super franchise default:
        if (currentUser.super_franchise_id && Number(rule.super_franchise_id) === Number(currentUser.super_franchise_id) && rule.scope === "super_franchise_default") {
          return 70;
        }
        // 4. Admin default:
        if (rule.scope === "admin_default" || (currentUser.company_id && rule.company_id === currentUser.company_id)) {
          return 50;
        }
        return 10;
      }
      return 10;
    };

    const getSourceLabel = (rule, isOverridden) => {
      if (!isOverridden) {
        return "Inherited Default";
      }
      if (isAdmin) {
        return "Super Admin Override";
      }
      if (isSuperFranchise) {
        return "Admin Override";
      }
      if (isFranchise) {
        if (rule.scope === "super_franchise_franchise" || rule.scope === "super_franchise_default") {
          return "Super Franchise Rate";
        }
        return "Admin Override";
      }
      if (isMerchant) {
        if (rule.scope === "franchise_merchant" || (rule.user_id === currentUserId && currentUser.franchaise_id)) {
          return "Franchise Rate";
        }
        if (rule.scope === "super_franchise_merchant") {
          return "Super Franchise Rate";
        }
        if (rule.scope === "admin_merchant" || (rule.user_id === currentUserId && !currentUser.franchaise_id)) {
          return "Admin Override";
        }
        if (rule.scope === "franchise_default") {
          return "Franchise Default";
        }
        if (rule.scope === "super_franchise_franchise" || rule.scope === "super_franchise_default") {
          return "Super Franchise Rate";
        }
        if (rule.scope === "admin_franchise") {
          return "Admin Override";
        }
        return "Account Override";
      }
      return "Custom Rate";
    };

    const overrideMap = new Map();
    applicablePosRules.forEach((ar) => {
      const key = getPosRuleKey(ar);
      const existing = overrideMap.get(key);
      const arPrec = getRulePrecedence(ar);
      const exPrec = existing ? getRulePrecedence(existing) : -1;
      if (!existing || arPrec > exPrec || (arPrec === exPrec && ar.id > existing.id)) {
        overrideMap.set(key, ar);
      }
    });

    const matchedPosIds = new Set();
    const posRows = [];

    defaultPosRules.forEach((dr) => {
      const key = getPosRuleKey(dr);
      const overrideRule = overrideMap.get(key) || null;
      if (overrideRule) {
        matchedPosIds.add(overrideRule.id);
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

      const label = getSourceLabel(activeRule, isOverridden);

      posRows.push({
        id: activeRule.id,
        rule_key: key,
        service_name: serviceName,
        payment_mode: mode,
        card_brand: activeRule.card_brand || "ANY",
        card_type: activeRule.card_type || "ANY",
        card_classification: activeRule.card_classification || "ANY",
        settlement_type: activeRule.settlement_type || null,
        min_amount: parseFloat(activeRule.min_amount || 0),
        max_amount: activeRule.max_amount !== null && activeRule.max_amount !== undefined ? parseFloat(activeRule.max_amount) : null,
        charge_percent: parseFloat(activeRule.charge_percent || 0),
        charge_flat: parseFloat(activeRule.charge_flat || 0),
        fee_type: parseFloat(activeRule.charge_flat || 0) > 0 && parseFloat(activeRule.charge_percent || 0) === 0 ? "flat" : "percentage",
        gst_required: Boolean(activeRule.gst_required),
        gst_percent: activeRule.gst_required ? parseFloat(activeRule.gst_percent || 18) : 0,
        rate_source: label,
        source_label: label,
        is_override: isOverridden,
        is_active: Boolean(activeRule.is_active),
        company_name: activeRule.company_name || "ANY",
      });
    });

    applicablePosRules.forEach((ar) => {
      if (!matchedPosIds.has(ar.id)) {
        const mode = String(ar.payment_mode || "CARD").toUpperCase();
        const cardType = String(ar.card_type || "").toUpperCase();
        let serviceName = "POS Card Payment";
        if (mode === "UPI") {
          serviceName = "POS UPI Transaction";
        } else if (cardType && cardType !== "ANY" && cardType !== "UNKNOWN") {
          serviceName = `POS ${cardType.charAt(0) + cardType.slice(1).toLowerCase()} Card`;
        }

        const label = getSourceLabel(ar, true);

        posRows.push({
          id: ar.id,
          rule_key: getPosRuleKey(ar),
          service_name: serviceName,
          payment_mode: mode,
          card_brand: ar.card_brand || "ANY",
          card_type: ar.card_type || "ANY",
          card_classification: ar.card_classification || "ANY",
          settlement_type: ar.settlement_type || null,
          min_amount: parseFloat(ar.min_amount || 0),
          max_amount: ar.max_amount !== null && ar.max_amount !== undefined ? parseFloat(ar.max_amount) : null,
          charge_percent: parseFloat(ar.charge_percent || 0),
          charge_flat: parseFloat(ar.charge_flat || 0),
          fee_type: parseFloat(ar.charge_flat || 0) > 0 && parseFloat(ar.charge_percent || 0) === 0 ? "flat" : "percentage",
          gst_required: Boolean(ar.gst_required),
          gst_percent: ar.gst_required ? parseFloat(ar.gst_percent || 18) : 0,
          rate_source: label,
          source_label: label,
          is_override: true,
          is_active: Boolean(ar.is_active),
          company_name: ar.company_name || "ANY",
        });
      }
    });

    // ── 2. Payout (Pay) Rates ─────────────────────────────────────────────────
    const defaultPayoutRules = await PayoutCharge.findAll({
      where: { is_active: true },
      order: [["from_amount", "ASC"]],
    });

    const userCandidateIds = [currentUserId];
    if (currentUser.franchaise_id) userCandidateIds.push(currentUser.franchaise_id);
    if (currentUser.super_franchise_id) userCandidateIds.push(currentUser.super_franchise_id);

    const userPayoutRules = await UserPayoutCharge.findAll({
      where: { user_id: { [Op.in]: userCandidateIds }, is_active: true },
      order: [["from_amount", "ASC"]],
    });

    const userPayoutMap = new Map();
    userPayoutRules.forEach((ar) => {
      const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
      const existing = userPayoutMap.get(slabKey);
      if (!existing || ar.user_id === currentUserId) {
        userPayoutMap.set(slabKey, ar);
      }
    });

    const matchedPayoutIds = new Set();
    const payoutRows = [];

    defaultPayoutRules.forEach((dr) => {
      const slabKey = `${parseFloat(dr.from_amount).toFixed(2)}-${parseFloat(dr.to_amount).toFixed(2)}`;
      const overrideRule = userPayoutMap.get(slabKey) || null;
      if (overrideRule) {
        matchedPayoutIds.add(overrideRule.id);
      }
      const activeRule = overrideRule || dr;
      const isOverridden = Boolean(overrideRule);
      const label = !isOverridden
        ? "Inherited Default"
        : isAdmin
          ? "Super Admin Override"
          : overrideRule.user_id === currentUserId
            ? "Account Override"
            : "Parent Assignment";

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
        rate_source: label,
        source_label: label,
        is_override: isOverridden,
        is_active: Boolean(activeRule.is_active),
        description: activeRule.description || "Payout Bank Transfer",
      });
    });

    userPayoutRules.forEach((ar) => {
      if (!matchedPayoutIds.has(ar.id)) {
        const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
        const label = isAdmin
          ? "Super Admin Override"
          : ar.user_id === currentUserId
            ? "Account Override"
            : "Parent Assignment";

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
          rate_source: label,
          source_label: label,
          is_override: true,
          is_active: Boolean(ar.is_active),
          description: ar.description || "Custom Payout Slab",
        });
      }
    });

    payoutRows.sort((a, b) => a.from_amount - b.from_amount);

    // ── 3. CC Bill Rates ──────────────────────────────────────────────────────
    const defaultCcBillRules = await BbpsCcChargeRule.findAll({
      where: { user_id: null, is_active: true },
      order: [["from_amount", "ASC"]],
    });

    const userCcBillRules = await BbpsCcChargeRule.findAll({
      where: { user_id: { [Op.in]: userCandidateIds }, is_active: true },
      order: [["from_amount", "ASC"]],
    });

    const userCcBillMap = new Map();
    userCcBillRules.forEach((ar) => {
      const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
      const existing = userCcBillMap.get(slabKey);
      if (!existing || ar.user_id === currentUserId) {
        userCcBillMap.set(slabKey, ar);
      }
    });

    const matchedCcBillIds = new Set();
    const ccBillRows = [];

    defaultCcBillRules.forEach((dr) => {
      const slabKey = `${parseFloat(dr.from_amount).toFixed(2)}-${parseFloat(dr.to_amount).toFixed(2)}`;
      const overrideRule = userCcBillMap.get(slabKey) || null;
      if (overrideRule) {
        matchedCcBillIds.add(overrideRule.id);
      }
      const activeRule = overrideRule || dr;
      const isOverridden = Boolean(overrideRule);
      const label = !isOverridden
        ? "Inherited Default"
        : isAdmin
          ? "Super Admin Override"
          : "Account Override";

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
        rate_source: label,
        source_label: label,
        is_override: isOverridden,
        is_active: Boolean(activeRule.is_active),
        description: activeRule.description || "BBPS Credit Card Bill Payment",
      });
    });

    userCcBillRules.forEach((ar) => {
      if (!matchedCcBillIds.has(ar.id)) {
        const slabKey = `${parseFloat(ar.from_amount).toFixed(2)}-${parseFloat(ar.to_amount).toFixed(2)}`;
        const label = isAdmin ? "Super Admin Override" : "Account Override";

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
          rate_source: label,
          source_label: label,
          is_override: true,
          is_active: Boolean(ar.is_active),
          description: ar.description || "Custom BBPS CC Slab",
        });
      }
    });

    ccBillRows.sort((a, b) => a.from_amount - b.from_amount);

    // ── 4. POS Rental Rates ───────────────────────────────────────────────────
    let applicableRental = null;
    let isRentalOverridden = false;
    let rentalSourceLabel = "Inherited Default";

    if (isAdmin || isSuperAdmin) {
      applicableRental = await Rental.findOne({
        where: { target_user_type: "admin", status: "active" },
        order: [["createdAt", "DESC"]],
      });
      rentalSourceLabel = "Inherited Default";
    } else if (isSuperFranchise) {
      applicableRental = await Rental.findOne({
        where: { target_user_type: "super_franchise", status: "active" },
        order: [["createdAt", "DESC"]],
      });
      if (applicableRental) {
        isRentalOverridden = true;
        rentalSourceLabel = "Admin Override";
      }
    } else if (isFranchise) {
      if (currentUser.super_franchise_id) {
        applicableRental = await Rental.findOne({
          where: { super_franchise_id: currentUser.super_franchise_id, target_user_type: "franchise", status: "active" },
          order: [["createdAt", "DESC"]],
        });
      }
      if (!applicableRental) {
        applicableRental = await Rental.findOne({
          where: { target_user_type: "franchise", status: "active" },
          order: [["createdAt", "DESC"]],
        });
      }
      if (applicableRental) {
        isRentalOverridden = true;
        rentalSourceLabel = applicableRental.super_franchise_id ? "Super Franchise Rate" : "Admin Override";
      }
    } else if (isMerchant) {
      if (currentUser.franchaise_id) {
        applicableRental = await Rental.findOne({
          where: { franchaise_id: currentUser.franchaise_id, target_user_type: "merchant", status: "active" },
          order: [["createdAt", "DESC"]],
        });
      }
      if (!applicableRental) {
        applicableRental = await Rental.findOne({
          where: { target_user_type: "merchant", status: "active" },
          order: [["createdAt", "DESC"]],
        });
      }
      if (applicableRental) {
        isRentalOverridden = true;
        rentalSourceLabel = applicableRental.franchaise_id ? "Franchise Rate" : "Admin Override";
      }
    }

    const rentalRows = [];
    if (applicableRental) {
      rentalRows.push({
        id: applicableRental.id,
        service_name: "POS Terminal Monthly Rental",
        amount: parseFloat(applicableRental.amount || 0),
        billing_period: "30 Days (Monthly)",
        status: applicableRental.status,
        target_user_type: applicableRental.target_user_type,
        rate_source: rentalSourceLabel,
        source_label: rentalSourceLabel,
        is_override: isRentalOverridden,
        is_active: applicableRental.status === "active",
      });
    }

    const userSummary = {
      id: currentUser.id,
      name: currentUser.name,
      username: currentUser.username,
      role: currentUser.role,
      company_name: currentUser.company_or_shop_name,
    };

    return res.status(200).json({
      success: true,
      admin: userSummary,
      user: userSummary,
      data: {
        pos: posRows,
        payout: payoutRows,
        pay: payoutRows,
        cc_bill: ccBillRows,
        ccBill: ccBillRows,
        rental: rentalRows,
      },
      categories: {
        pos: posRows,
        payout: payoutRows,
        pay: payoutRows,
        cc_bill: ccBillRows,
        ccBill: ccBillRows,
        rental: rentalRows,
      },
      summary: {
        totalPosRules: posRows.length,
        totalPayoutRules: payoutRows.length,
        totalCcBillRules: ccBillRows.length,
        totalRentalRules: rentalRows.length,
      },
    });
  } catch (error) {
    console.error("Error in getMyApplicableCharges:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch applicable charges" });
  }
};
