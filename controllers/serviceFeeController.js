const asyncHandler = require('express-async-handler');
const ServiceFee = require('../models/ServiceFee');
const { Op } = require('sequelize');
const { serviceNames } = require('../constants');

// -----------------------------------------------------------------------------
// SERVICE FEE MANAGEMENT (admin-only writes, read by any authenticated user)
// -----------------------------------------------------------------------------

/** POST /api/service-fee
 *  Body: { serviceName, flat_fee?, percent_fee?, is_active? }
 *  Only administrators may create new service fees.  At least one of flat_fee
 *  or percent_fee must be provided and non-zero; percent takes precedence if
 *  both are set.
 *
 *  `serviceName` is expected to be one of the predefined identifiers exported
 *  from `constants.serviceNames` (e.g. `serviceNames.BANK_VERIFICATION`).
 *  Using these constants everywhere avoids typos and makes it easy to query
 *  or update a specific fee later.
 */
const createServiceFee = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const { serviceName, flat_fee, percent_fee, is_active } = req.body;

  if (!serviceName || typeof serviceName !== 'string') {
    res.status(400);
    throw new Error('serviceName is required');
  }

  // enforce predefined names only
  const allowed = Object.values(serviceNames);
  if (!allowed.includes(serviceName)) {
    res.status(400);
    throw new Error('Invalid serviceName, must be one of: ' + allowed.join(', '));
  }

  const flatVal = flat_fee ? parseFloat(flat_fee) : 0;
  const percentVal = percent_fee ? parseFloat(percent_fee) : 0;
  if (flatVal === 0 && percentVal === 0) {
    res.status(400);
    throw new Error('At least one of flat_fee or percent_fee must be non-zero');
  }

  // Prevent duplicate service name
  const existing = await ServiceFee.findOne({
    where: { service_name: serviceName }
  });
  if (existing) {
    res.status(400);
    throw new Error('A service fee with this name already exists');
  }

  const record = await ServiceFee.create({
    service_name: serviceName,
    flat_fee: flatVal,
    percent_fee: percentVal,
    is_active: typeof is_active === 'boolean' ? is_active : true,
    created_by: req.user.id
  });

  res.status(201).json({ message: 'Service fee created', record });
});

/** GET /api/service-fee
 *  Returns all configured service fees.  Accessible to any authenticated user.
 */
const getServiceFees = asyncHandler(async (req, res) => {
  const records = await ServiceFee.findAll({ order: [['createdAt', 'DESC']] });
  res.status(200).json(records);
});

/** PUT /api/service-fee/:id
 *  Admin only.  Allows changing name, fees, and active flag.  Duplicate name
 *  check performed if serviceName is modified.
 */
const updateServiceFee = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const rec = await ServiceFee.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('Service fee not found');
  }

  const { serviceName, flat_fee, percent_fee, is_active } = req.body;

  if (serviceName && serviceName !== rec.service_name) {
    // validate allowed values
    const allowed = Object.values(serviceNames);
    if (!allowed.includes(serviceName)) {
      res.status(400);
      throw new Error('Invalid serviceName, must be one of: ' + allowed.join(', '));
    }

    const dup = await ServiceFee.findOne({
      where: {
        service_name: serviceName,
        id: { [Op.ne]: rec.id }
      }
    });
    if (dup) {
      res.status(400);
      throw new Error('Another service fee with this name already exists');
    }
    rec.service_name = serviceName;
  }

  if (flat_fee !== undefined) rec.flat_fee = parseFloat(flat_fee || 0);
  if (percent_fee !== undefined) rec.percent_fee = parseFloat(percent_fee || 0);
  if (typeof is_active === 'boolean') rec.is_active = is_active;

  rec.updated_by = req.user.id;
  await rec.save();

  res.status(200).json({ message: 'Updated', record: rec });
});

/** DELETE /api/service-fee/:id
 *  Admin only.
 */
const deleteServiceFee = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Access denied');
  }

  const rec = await ServiceFee.findByPk(req.params.id);
  if (!rec) {
    res.status(404);
    throw new Error('Service fee not found');
  }

  await rec.destroy();
  res.status(200).json({ message: 'Deleted' });
});

module.exports = {
  createServiceFee,
  getServiceFees,
  updateServiceFee,
  deleteServiceFee
};