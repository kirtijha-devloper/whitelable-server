/**
 * partnerApiController.js
 *
 * Dedicated API for Third-Party Integration:
 * POST /api/partner/create-machine (or /pos-machine)
 * Creates a POS machine in PosMachine model in unassigned status.
 */

const asyncHandler = require("express-async-handler");
const { Op } = require("sequelize");
const PosMachine = require("../models/posMachine");

/**
 * POST /api/partner/create-machine (or /api/partner/pos-machine)
 * Creates a single unassigned POS machine.
 *
 * Expected Body:
 * {
 *   "tid_number": "TID123456",            (required or device_serial_number)
 *   "mid_number": "MID123456",            (optional)
 *   "device_serial_number": "SN123456",   (required or tid_number)
 *   "bank_name": "HDFC",                  (optional)
 *   "company_name": "MyCompany",          (optional)
 *   "razorpay_id": "...",                 (optional)
 *   "remarks": "..."                      (optional)
 * }
 */
const createPosMachine = asyncHandler(async (req, res) => {
  const body = req.body || {};

  const tid_number = body.tid_number ? String(body.tid_number).trim() : (body.tid ? String(body.tid).trim() : null);
  const mid_number = body.mid_number ? String(body.mid_number).trim() : (body.mid ? String(body.mid).trim() : null);
  const device_serial_number = body.device_serial_number
    ? String(body.device_serial_number).trim()
    : (body.serial_number ? String(body.serial_number).trim() : (body.serial ? String(body.serial).trim() : null));
  const company_name = body.company_name ? String(body.company_name).trim() : null;
  const bank_name = body.bank_name ? String(body.bank_name).trim() : null;
  const razorpay_id = body.razorpay_id || body.razorpayid || null;
  const remarks = body.remarks ? String(body.remarks).trim() : "added";

  // Require at least tid_number or device_serial_number
  if (!tid_number && !device_serial_number) {
    return res.status(400).json({
      success: false,
      message: "Either 'tid_number' or 'device_serial_number' is required to register a POS machine.",
    });
  }

  // Duplicate check for existing machine with same TID or Serial Number
  const duplicateConditions = [];
  if (tid_number) duplicateConditions.push({ tid_number });
  if (device_serial_number) duplicateConditions.push({ device_serial_number });

  const existingMachine = await PosMachine.findOne({
    where: { [Op.or]: duplicateConditions },
  });

  if (existingMachine) {
    const matchedField = existingMachine.tid_number === tid_number ? "TID Number" : "Device Serial Number";
    const matchedVal = existingMachine.tid_number === tid_number ? tid_number : device_serial_number;
    return res.status(409).json({
      success: false,
      message: `POS Machine with ${matchedField} '${matchedVal}' already exists in the system.`,
      existing_id: existingMachine.id,
    });
  }

  // Create single POS Machine in unassigned state
  const newMachine = await PosMachine.create({
    tid_number,
    mid_number,
    device_serial_number,
    company_name,
    bank_name,
    razorpay_id,
    remarks,
    status: "added",       // Unassigned / available stock
    assigned_to: null,     // Strictly unassigned
    super_franchise_id: null,
  });

  return res.status(201).json({
    success: true,
    message: "POS Machine created successfully in unassigned state.",
    data: {
      id: newMachine.id,
      tid_number: newMachine.tid_number,
      mid_number: newMachine.mid_number,
      device_serial_number: newMachine.device_serial_number,
      company_name: newMachine.company_name,
      bank_name: newMachine.bank_name,
      razorpay_id: newMachine.razorpay_id,
      remarks: newMachine.remarks,
      status: newMachine.status,
      assigned_to: null,
      super_franchise_id: null,
      createdAt: newMachine.createdAt,
    },
  });
});

module.exports = {
  createPosMachine,
};
