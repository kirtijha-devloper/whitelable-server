const asyncHandler = require("express-async-handler");
const { Op } = require("sequelize");
const PosInventory = require("../models/PosInventory");
const QrInventory = require("../models/QrInventory");
const PgInventory = require("../models/PgInventory");
const PosMachine = require("../models/posMachine");

/**
 * GET /super-admin/getPosInventory
 * Retrieve POS Inventory list with pagination, status, and search filters
 */
const getPosInventory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, search, q } = req.query;
  const searchTerm = (search || q || "").trim();
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const where = {};

  if (status && status !== "all") {
    where.status = status;
  }

  if (searchTerm) {
    where[Op.or] = [
      { tid_number: { [Op.iLike]: `%${searchTerm}%` } },
      { serial_number: { [Op.iLike]: `%${searchTerm}%` } },
      { model: { [Op.iLike]: `%${searchTerm}%` } },
      { company_name: { [Op.iLike]: `%${searchTerm}%` } },
      { assigned_to: { [Op.iLike]: `%${searchTerm}%` } },
    ];
  }

  const { count, rows } = await PosInventory.findAndCountAll({
    where,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    order: [["createdAt", "DESC"]],
  });

  // If pos_inventory is empty, fallback/merge from PosMachine table for seamless UX
  if (count === 0 && !searchTerm && (!status || status === "all")) {
    const fallbackMachines = await PosMachine.findAll({
      limit: parseInt(limit, 10),
      order: [["createdAt", "DESC"]],
    });
    if (fallbackMachines.length > 0) {
      const mapped = fallbackMachines.map((pm) => ({
        id: pm.id,
        tid_number: pm.pos_machine_id || `TID-${pm.id}`,
        serial_number: pm.serial_number || `SN-${pm.id}`,
        model: pm.model_name || 'Pax A920',
        company_name: pm.company_name || 'AGRO-AXIS',
        assigned_to: pm.assigned_to ? `User #${pm.assigned_to}` : 'Unassigned',
        assigned_user_id: pm.assigned_to || null,
        status: pm.status || 'available',
        createdAt: pm.createdAt,
      }));
      return res.status(200).json({
        success: true,
        data: mapped,
        pagination: {
          total: fallbackMachines.length,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: 1,
        },
      });
    }
  }

  return res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(count / parseInt(limit, 10)) || 1,
    },
  });
});

/**
 * POST /super-admin/addPosInventory
 * Create POS Inventory item
 */
const addPosInventory = asyncHandler(async (req, res) => {
  const { tid_number, serial_number, model = "Pax A920", company_name, assigned_to = "Unassigned", assigned_user_id = null, status = "available" } = req.body;

  if (!tid_number || !serial_number || !company_name) {
    res.status(400);
    throw new Error("tid_number, serial_number, and company_name are required.");
  }

  const existingTid = await PosInventory.findOne({ where: { tid_number } });
  if (existingTid) {
    res.status(409);
    throw new Error(`POS Inventory with TID '${tid_number}' already exists.`);
  }

  const item = await PosInventory.create({
    tid_number,
    serial_number,
    model,
    company_name,
    assigned_to,
    assigned_user_id,
    status,
  });

  return res.status(201).json({
    success: true,
    message: "POS inventory item added successfully.",
    data: item,
  });
});

/**
 * GET /super-admin/getQrInventory
 */
const getQrInventory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, search, q } = req.query;
  const searchTerm = (search || q || "").trim();
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const where = {};

  if (status && status !== "all") {
    where.status = status;
  }

  if (searchTerm) {
    where[Op.or] = [
      { qr_code: { [Op.iLike]: `%${searchTerm}%` } },
      { vpa_id: { [Op.iLike]: `%${searchTerm}%` } },
      { partner_bank: { [Op.iLike]: `%${searchTerm}%` } },
      { assigned_to: { [Op.iLike]: `%${searchTerm}%` } },
    ];
  }

  const { count, rows } = await QrInventory.findAndCountAll({
    where,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    order: [["createdAt", "DESC"]],
  });

  return res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(count / parseInt(limit, 10)) || 1,
    },
  });
});

/**
 * POST /super-admin/addQrInventory
 */
const addQrInventory = asyncHandler(async (req, res) => {
  const { qr_code, vpa_id, type = "Acrylic Standee", partner_bank, assigned_to = "Unassigned", status = "unassigned" } = req.body;

  if (!qr_code || !vpa_id || !partner_bank) {
    res.status(400);
    throw new Error("qr_code, vpa_id, and partner_bank are required.");
  }

  const item = await QrInventory.create({
    qr_code,
    vpa_id,
    type,
    partner_bank,
    assigned_to,
    status,
  });

  return res.status(201).json({
    success: true,
    message: "QR inventory item added successfully.",
    data: item,
  });
});

/**
 * GET /super-admin/getPgInventory
 */
const getPgInventory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, search, q } = req.query;
  const searchTerm = (search || q || "").trim();
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const where = {};

  if (status && status !== "all") {
    where.status = status;
  }

  if (searchTerm) {
    where[Op.or] = [
      { mid: { [Op.iLike]: `%${searchTerm}%` } },
      { gateway: { [Op.iLike]: `%${searchTerm}%` } },
      { title: { [Op.iLike]: `%${searchTerm}%` } },
      { company_name: { [Op.iLike]: `%${searchTerm}%` } },
    ];
  }

  const { count, rows } = await PgInventory.findAndCountAll({
    where,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    order: [["createdAt", "DESC"]],
  });

  return res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      total: count,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(count / parseInt(limit, 10)) || 1,
    },
  });
});

/**
 * POST /super-admin/addPgInventory
 */
const addPgInventory = asyncHandler(async (req, res) => {
  const { mid, gateway, title, company_name = "Unallocated", daily_limit = "₹ 50,00,000", status = "unallocated" } = req.body;

  if (!mid || !gateway || !title) {
    res.status(400);
    throw new Error("mid, gateway, and title are required.");
  }

  const item = await PgInventory.create({
    mid,
    gateway,
    title,
    company_name,
    daily_limit,
    status,
  });

  return res.status(201).json({
    success: true,
    message: "PG inventory item added successfully.",
    data: item,
  });
});

module.exports = {
  getPosInventory,
  addPosInventory,
  getQrInventory,
  addQrInventory,
  getPgInventory,
  addPgInventory,
};
