const { ChargeType, ChargeSlab } = require("../models");
const asyncHandler = require("express-async-handler");

// ✅ Create a new Charge Type
const createChargeType = asyncHandler(async (req, res) => {
    const role = req.user.role
    if (role !== "admin") {
        res.status(403); // 403 Forbidden
        throw new Error("Access denied: only admin can create charge types");
    }
  const { name, category } = req.body;

  if (!name || !category) {
    res.status(400);
    throw new Error("Name and category are required");
  }

  const chargeType = await ChargeType.create({
    name,
    category,
    created_by: req.user.id
  });

  res.status(201).json({ message: "Charge Type created", chargeType });
});

// ✅ Get all charge types
const getChargeTypes = asyncHandler(async (req, res) => {
  const role = req.user.role
    if (role !== "admin") {
        res.status(403); // 403 Forbidden
        throw new Error("Access denied: only admin can create charge types");
    }
  const types = await ChargeType.findAll();

  res.status(200).json({ types });
});

// ✅ Create a charge slab
const createChargeSlab = asyncHandler(async (req, res) => {
  const {
    charge_type_name,
    charge_type_category,
    charge_type_id, // optional
    min_amount,
    max_amount,
    flat_fee,
    percent_fee, // optional
    user_id // optional
  } = req.body;

  if (!charge_type_id && (!charge_type_name || !charge_type_category)) {
    res.status(400);
    throw new Error("Either charge_type_id or charge_type_name + category must be provided")};
  
    let resolvedChargeTypeId = charge_type_id;
    if (!charge_type_id) {
    const existChargeType = await ChargeType.findOne({where: {name: charge_type_name, category: charge_type_category}});
    if (!existChargeType) { 
        res.status(404);
        throw new Error("Charge slab not found");
    }
      
    resolvedChargeTypeId = existChargeType.id;
  };

  const slab = await ChargeSlab.create({
    charge_type_id: resolvedChargeTypeId,
    user_id: user_id || null,
    created_by: req.user.id,
    min_amount: min_amount || null,
    max_amount: max_amount || null,
    flat_fee: flat_fee || null,
    percent_fee: percent_fee || null
    });

  res.status(201).json({ message: "Charge Slab created", slab });
});

// ✅ Get slabs by charge type
const getSlabsByType = asyncHandler(async (req, res) => {
  const { typeId } = req.params;

  const slabs = await ChargeSlab.findAll({
    where: { charge_type_id: typeId }
  });

  res.status(200).json({ slabs });
});

// ✅ Update slab
const updateChargeSlab = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const slab = await ChargeSlab.findByPk(id);
  if (!slab) {
    res.status(404);
    throw new Error("Charge slab not found");
  }

  await slab.update(updates);

  res.status(200).json({ message: "Charge Slab updated", slab });
});

// ✅ Delete slab
const deleteChargeSlab = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const slab = await ChargeSlab.findByPk(id);
  if (!slab) {
    res.status(404);
    throw new Error("Slab not found");
  }

  await slab.destroy();

  res.status(200).json({ message: "Charge Slab deleted" });
});

const deleteChargeType = asyncHandler(async (req, res) => {
  const role = req.user.role;

  if (role !== "admin") {
    res.status(403);
    throw new Error("Access denied: only admin can delete charge types");
  }

  const { id } = req.params;

  const chargeType = await ChargeType.findByPk(id);

  if (!chargeType) {
    res.status(404);
    throw new Error("Charge Type not found");
  }

  await chargeType.destroy(); // Related slabs will be deleted if cascade is set

  res.status(200).json({ message: "Charge Type deleted successfully" });
});


module.exports = {
  createChargeType,
  getChargeTypes,
  createChargeSlab,
  getSlabsByType,
  updateChargeSlab,
  deleteChargeSlab,
  deleteChargeType
};
