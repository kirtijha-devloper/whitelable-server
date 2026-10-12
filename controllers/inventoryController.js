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
  const searchTerm = (search || q || "").trim().toLowerCase();
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;
  const offset = (pageNum - 1) * limitNum;

  const User = require("../models/User");

  // 1. Fetch live machines from master PosMachine table (with assigned users)
  const posMachines = await PosMachine.findAll({
    order: [["createdAt", "DESC"]],
  });

  const userIds = posMachines.map((pm) => pm.assigned_to).filter(Boolean);
  const assignedUsers = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ["id", "name", "email", "role", "username", "mobile_number"],
      })
    : [];
  const userMap = assignedUsers.reduce((acc, u) => {
    acc[u.id] = u;
    return acc;
  }, {});

  const mappedMachines = posMachines.map((pm) => {
    const user = pm.assigned_to ? userMap[pm.assigned_to] : null;
    const assignedName = user
      ? user.name || user.username || `User #${user.id}`
      : pm.assigned_to
      ? `User #${pm.assigned_to}`
      : "Unassigned";

    let mappedStatus = pm.status || (pm.assigned_to ? "active" : "available");
    if (mappedStatus === "added") mappedStatus = "available";

    return {
      id: pm.id,
      tid_number: pm.tid_number || pm.pos_machine_id || `TID-${pm.id}`,
      serial_number: pm.device_serial_number || pm.serial_number || `SN-${pm.id}`,
      device_serial_number: pm.device_serial_number || pm.serial_number,
      mid_number: pm.mid_number,
      model: pm.model_name || pm.model || "Pax A920",
      company_name: pm.company_name || "-",
      bank_name: pm.bank_name || "-",
      assigned_to: assignedName,
      assigned_user_id: pm.assigned_to || null,
      assigned_user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            username: user.username,
          }
        : null,
      status: mappedStatus,
      createdAt: pm.createdAt,
      source_table: "PosMachine",
    };
  });

  // 2. Fetch records from PosInventory table (seed/mock records)
  const inventoryRecords = await PosInventory.findAll({
    order: [["createdAt", "DESC"]],
  });

  const existingTids = new Set(
    mappedMachines.map((m) => String(m.tid_number || "").trim().toLowerCase())
  );

  const mappedInventory = [];
  for (const inv of inventoryRecords) {
    const tidLower = String(inv.tid_number || "").trim().toLowerCase();
    if (!existingTids.has(tidLower)) {
      mappedInventory.push({
        id: inv.id,
        tid_number: inv.tid_number,
        serial_number: inv.serial_number,
        device_serial_number: inv.serial_number,
        model: inv.model || "Pax A920",
        company_name: inv.company_name || "-",
        assigned_to: inv.assigned_to || "Unassigned",
        assigned_user_id: inv.assigned_user_id || null,
        status: inv.status || "available",
        createdAt: inv.createdAt,
        source_table: "PosInventory",
      });
      existingTids.add(tidLower);
    }
  }

  // 3. Combine both lists, newest first
  let allCombined = [...mappedMachines, ...mappedInventory].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  // 4. Apply status filter
  if (status && status !== "all") {
    const filterStatus = String(status).toLowerCase();
    allCombined = allCombined.filter((m) => {
      const s = String(m.status || "").toLowerCase();
      if (filterStatus === "available") return s === "available" || s === "added";
      if (filterStatus === "active") return s === "active";
      if (filterStatus === "returned") return s.includes("return");
      return s === filterStatus;
    });
  }

  // 5. Apply search filter
  if (searchTerm) {
    allCombined = allCombined.filter((m) => {
      const tid = String(m.tid_number || "").toLowerCase();
      const serial = String(m.serial_number || "").toLowerCase();
      const model = String(m.model || "").toLowerCase();
      const comp = String(m.company_name || "").toLowerCase();
      const assigned = String(m.assigned_to || "").toLowerCase();
      return (
        tid.includes(searchTerm) ||
        serial.includes(searchTerm) ||
        model.includes(searchTerm) ||
        comp.includes(searchTerm) ||
        assigned.includes(searchTerm)
      );
    });
  }

  const total = allCombined.length;
  const paginated = allCombined.slice(offset, offset + limitNum);

  return res.status(200).json({
    success: true,
    data: paginated,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
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
