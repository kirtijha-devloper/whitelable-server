const asyncHandler = require('express-async-handler');
const Beneficiary = require('../models/Beneficiary');
const { Op } = require('sequelize');

const listPayoutBeneficiaries = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user || !user.id) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const normalizedRole = (user.role || '').toLowerCase();

  if (normalizedRole === 'admin') {
    const beneficiaries = await Beneficiary.findAll({
      where: { status: { [Op.in]: ['active', 'verified', '1', 1] } },
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json({ success: true, data: beneficiaries });
  }

  if (['merchant', 'franchaise', 'franchise'].includes(normalizedRole)) {
    const beneficiaries = await Beneficiary.findAll({
      where: { 
        merchant_id: user.id,
        status: { [Op.in]: ['active', 'verified', '1', 1] } 
      },
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({ success: true, data: beneficiaries });
  }

  return res.status(403).json({ success: false, message: 'Unauthorized role for payout beneficiaries' });
});

const updatePayoutBeneficiary = asyncHandler(async (req, res) => {
  const user = req.user;
  const beneficiaryId = req.params.id;

  if (!user || !user.id) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const beneficiary = await Beneficiary.findByPk(beneficiaryId);
  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }

  const normalizedRole = (user.role || '').toLowerCase();
  if (normalizedRole !== 'admin' && beneficiary.merchant_id !== user.id) {
    return res.status(403).json({ success: false, message: 'You are not allowed to update this beneficiary' });
  }

  const allowedUpdates = [
    'beneficiary_name',
    'account_number',
    'ifsc_code',
    'bank_name',
    'branch_name',
    'state',
    'mobile_number',
    'email',
    'status',
  ];

  const updates = {};
  allowedUpdates.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      updates[field] = req.body[field];
    }
  });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'No valid fields provided for update' });
  }

  await beneficiary.update(updates);
  return res.status(200).json({ success: true, data: beneficiary });
});

module.exports = {
  listPayoutBeneficiaries,
  updatePayoutBeneficiary,
};
