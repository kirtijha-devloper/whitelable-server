const { Op } = require("sequelize");
const { ServiceChargeRule } = require("../models");

/**
 * Dynamically calculates charges from service_charge_rules
 * 
 * @param {string} serviceKey - Service key (e.g., 'vimo_payout', 'cc_bill_pay', 'pos_inventory')
 * @param {number} amount - Transaction amount
 * @param {string} userRole - Target role of the user (e.g., 'merchant', 'franchise', 'all')
 * @returns {Promise<{ fee: number, gst: number, total: number, ruleId: number|null }>}
 */
async function getApplicableServiceCharge(serviceKey, amount, userRole = "all") {
  const numericAmount = parseFloat(amount) || 0;

  // Build role matching conditions to accommodate synonyms (e.g., franchise vs franchaise)
  const roleConditions = [
    { target_role: "all" },
    { target_role: userRole || "all" },
  ];
  if (userRole === "franchaise") roleConditions.push({ target_role: "franchise" });
  if (userRole === "franchise") roleConditions.push({ target_role: "franchaise" });

  const rule = await ServiceChargeRule.findOne({
    where: {
      service_key: serviceKey,
      is_active: true,
      min_amount: { [Op.lte]: numericAmount },
      [Op.and]: [
        {
          [Op.or]: [
            { max_amount: { [Op.gte]: numericAmount } },
            { max_amount: 0 },
          ],
        },
        {
          [Op.or]: roleConditions,
        },
      ],
    },
    order: [["id", "DESC"]],
  });

  if (!rule) {
    return { fee: 0, gst: 0, total: 0, ruleId: null };
  }

  let fee = 0;
  if (rule.fee_type === "flat") {
    fee = parseFloat(rule.flat_fee) || 0;
  } else if (rule.fee_type === "percentage") {
    fee = (numericAmount * (parseFloat(rule.percent_fee) || 0)) / 100;
  } else if (rule.fee_type === "both") {
    fee = (parseFloat(rule.flat_fee) || 0) + (numericAmount * (parseFloat(rule.percent_fee) || 0)) / 100;
  }

  const gstRate = parseFloat(rule.gst_percent) || 0;
  const gst = rule.is_gst_inclusive ? 0 : (fee * gstRate) / 100;

  return {
    fee: Number(fee.toFixed(2)),
    gst: Number(gst.toFixed(2)),
    total: Number((fee + gst).toFixed(2)),
    ruleId: rule.id,
    rule,
  };
}

module.exports = {
  getApplicableServiceCharge,
};
