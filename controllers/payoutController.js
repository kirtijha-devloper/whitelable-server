const asyncHandler = require('express-async-handler');
const Beneficiary = require('../models/Beneficiary');

const listPayoutBeneficiaries = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user || !user.id) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const normalizedRole = (user.role || '').toLowerCase();

  if (normalizedRole === 'admin') {
    const beneficiaries = await Beneficiary.findAll({ order: [['createdAt', 'DESC']] });
    return res.status(200).json({ success: true, data: beneficiaries });
  }

  if (['merchant', 'franchaise', 'franchise'].includes(normalizedRole)) {
    const beneficiaries = await Beneficiary.findAll({
      where: { merchant_id: user.id },
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({ success: true, data: beneficiaries });
  }

  return res.status(403).json({ success: false, message: 'Unauthorized role for payout beneficiaries' });
});

module.exports = {
  listPayoutBeneficiaries,
};
