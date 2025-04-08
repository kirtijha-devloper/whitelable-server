const ChargeType = require("../models/ChargeType");
const ChargeSlab = require("../models/ChargeSlab");
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

const getSlabsById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id) {
    res.status(400);
    throw new Error("Slab ID is required");
  }

  const slab = await ChargeSlab.findByPk(id);

  if (!slab) {
    res.status(404);
    throw new Error("Charge slab not found");
  }

  res.status(200).json({ slab });
});

// ✅ Create a charge slab
const createChargeSlab = asyncHandler(async (req, res) => {
  const {
    charge_type_category,
    charge_type_id, // optional
    min_amount,
    max_amount,
    flat_fee,
    percent_fee, // optional
    user_id // optional
  } = req.body;

  console.log("charge slab", req)
  if (!charge_type_category || (!flat_fee && !percent_fee)) {
      res.status(400);
      throw new Error("charge_type_name and at least one of flat_fee or percent_fee is required");
    }
 
  // Default values if null
  const newMin = parseFloat(min_amount) || 0;
  const newMax = parseFloat(max_amount) || Infinity;

   // Find existing slabs for this user + charge type
  const existingSlabs = await ChargeSlab.findAll({
    where: {
      charge_type_category,
      user_id: user_id || null
    }
  });

  
  // Check for overlap
  const isOverlapping = existingSlabs.some((slab) => {
    const slabMin = parseFloat(slab.min_amount) || 0;
    const slabMax = parseFloat(slab.max_amount) || Infinity;

    return (
      newMin <= slabMax && newMax >= slabMin
    );
  });

console.log("charge TEST 01", isOverlapping)
  if (isOverlapping) {
    res.status(400);
    throw new Error("Overlapping slab exists for this charge_type_name and user.");
  }


  // Create new slab
    const slab = await ChargeSlab.create({
      charge_type_category: charge_type_category,
      user_id: user_id || null,
      created_by: req.user.id,
      min_amount: min_amount || null,
      max_amount: max_amount || null,
      flat_fee: flat_fee || null,
      percent_fee: percent_fee || null
      });
  console.log("charge TEST")

    res.status(201).json({ message: "Charge Slab created", slab });
});

// ✅ Get slabs by charge type
const getSlabsByCategory = asyncHandler(async (req, res) => {
  const { charge_type_category, user_id } = req.body;

  if (!charge_type_category) {
    res.status(400);
    throw new Error("charge_type_category is required");
  }

  const where = {
    charge_type_category
  };

  if (user_id) {
    where.user_id = user_id;
  }

  const slabs = await ChargeSlab.findAll({ where });

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

const getChargeSlabByUserId =  asyncHandler(async (req, res) => {
  const role = req.user.role;
  const userId = req.user.id;
  if (role === "merchant") {
    existingSlab = await ChargeSlab.findOne({where: {user_id: userId, category: "pos_rental"}})
    if (existingSlab) {
    res.status(200).json(existingSlab)
} else {
    res.status(404).json({message: "No charge slab found"})
  }
  }

  });

module.exports = {
  createChargeType,
  getChargeTypes,
  createChargeSlab,
  getSlabsByCategory,
  updateChargeSlab,
  deleteChargeSlab,
  deleteChargeType,
  getSlabsById
};
