const { Op, fn, col, literal } = require("sequelize");
const { Transaction, Commission, User, sequelize } = require("../models");

// 1. Transaction Reports
exports.getTransactionReports = async (req, res) => {
  try {
    const { startDate, endDate, service, status, search, page = 1, limit = 50 } = req.query;
    const where = {};

    if (startDate && endDate) {
      where.created_at = { [Op.between]: [`${startDate} 00:00:00`, `${endDate} 23:59:59`] };
    } else if (startDate) {
      where.created_at = { [Op.gte]: `${startDate} 00:00:00` };
    } else if (endDate) {
      where.created_at = { [Op.lte]: `${endDate} 23:59:59` };
    }

    if (service && service !== "All Services" && service !== "all") {
      where.service = service;
    }

    if (status && status !== "ALL" && status !== "all") {
      where.status = { [Op.iLike || Op.like]: status };
    }

    if (search) {
      where[Op.or] = [
        { utr_no: { [Op.iLike || Op.like]: `%${search}%` } },
        { transaction_id: { [Op.iLike || Op.like]: `%${search}%` } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const { count, rows } = await Transaction.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "name",
            "role",
            ["mobile_number", "mobile"],
            "mobile_number",
            "email",
          ],
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
      limit: limitNum,
      offset,
    });

    return res.status(200).json({
      success: true,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching transaction reports:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Commission Reports
exports.getCommissionReports = async (req, res) => {
  try {
    const { startDate, endDate, role, service, search, page, limit } = req.query;
    const where = {};

    if (startDate && endDate) {
      where.created_at = { [Op.between]: [`${startDate} 00:00:00`, `${endDate} 23:59:59`] };
    } else if (startDate) {
      where.created_at = { [Op.gte]: `${startDate} 00:00:00` };
    } else if (endDate) {
      where.created_at = { [Op.lte]: `${endDate} 23:59:59` };
    }

    if (service && service !== "All Services" && service !== "all") {
      where.service_key = service;
    }

    if (role && role !== "ALL" && role !== "all") {
      where.user_role = role;
    }

    if (search) {
      where[Op.or] = [
        { utr_no: { [Op.iLike || Op.like]: `%${search}%` } },
        { transaction_id: { [Op.iLike || Op.like]: `%${search}%` } },
      ];
    }

    const queryOptions = {
      where,
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "name",
            "role",
            ["mobile_number", "mobile"],
            "mobile_number",
            "email",
          ],
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
    };

    if (page && limit) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
      queryOptions.limit = limitNum;
      queryOptions.offset = (pageNum - 1) * limitNum;

      const { count, rows } = await Commission.findAndCountAll(queryOptions);
      return res.status(200).json({
        success: true,
        total: count,
        page: pageNum,
        totalPages: Math.ceil(count / limitNum),
        data: rows,
      });
    }

    const rows = await Commission.findAll(queryOptions);
    return res.status(200).json({
      success: true,
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching commission reports:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Service-Wise Aggregated Report
exports.getServiceWiseReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = {};

    if (startDate && endDate) {
      dateFilter.created_at = { [Op.between]: [`${startDate} 00:00:00`, `${endDate} 23:59:59`] };
    } else if (startDate) {
      dateFilter.created_at = { [Op.gte]: `${startDate} 00:00:00` };
    } else if (endDate) {
      dateFilter.created_at = { [Op.lte]: `${endDate} 23:59:59` };
    }

    // Group transactions by service
    const stats = await Transaction.findAll({
      attributes: [
        "service",
        [fn("COUNT", col("ID")), "txns"],
        [fn("COALESCE", fn("SUM", col("Amount")), 0), "total_volume"],
        [fn("COALESCE", fn("SUM", col("charge")), 0), "total_charges"],
        [
          fn(
            "SUM",
            literal("CASE WHEN UPPER(COALESCE(\"Status\", '')) = 'SUCCESS' THEN 1 ELSE 0 END")
          ),
          "success_count",
        ],
      ],
      where: dateFilter,
      group: ["service"],
      raw: true,
    });

    const formattedStats = (stats || []).map((s) => ({
      service: s.service || "General",
      txns: parseInt(s.txns) || 0,
      total_volume: parseFloat(s.total_volume) || 0,
      total_charges: parseFloat(s.total_charges) || 0,
      success_count: parseInt(s.success_count) || 0,
    }));

    return res.status(200).json({ success: true, data: formattedStats });
  } catch (error) {
    console.error("Error fetching service-wise report:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Helper: record a commission entry
exports.recordCommission = async ({
  transaction_id,
  utr_no,
  user_id,
  user_role,
  service_key,
  payment_mode,
  txn_amount,
  applied_rate,
  commission_amount,
  platform_margin,
  status = "CREDITED",
}) => {
  return await Commission.create({
    transaction_id: String(transaction_id),
    utr_no: utr_no || null,
    user_id: parseInt(user_id),
    user_role: user_role || "merchant",
    service_key: service_key || "general",
    payment_mode: payment_mode || "ALL",
    txn_amount: parseFloat(txn_amount) || 0,
    applied_rate: String(applied_rate || "0"),
    commission_amount: parseFloat(commission_amount) || 0,
    platform_margin: parseFloat(platform_margin) || 0,
    status: status || "CREDITED",
  });
};
