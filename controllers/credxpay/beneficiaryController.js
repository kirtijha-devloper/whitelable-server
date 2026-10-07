const express = require('express');
const asyncHandler = require('express-async-handler');
const PayoutBeneficiary = require('../../models/PayoutBeneficiary');

const router = express.Router();

// create beneficiary
router.post('/', asyncHandler(async (req, res) => {
  const { user_id, name, account_number, ifsc_code, bank_name, branch_name, state, mobile, email } = req.body;
  if (!user_id || !name || !account_number || !ifsc_code || !bank_name) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const ben = await PayoutBeneficiary.create({
    user_id,
    name,
    account_number,
    ifsc_code,
    bank_name,
    branch_name: branch_name || null,
    state: state || null,
    mobile: mobile || null,
    email: email || null,
    is_verified: false,
    company_id : companyId,
  });
  res.json({ success: true, data: ben });
}));

// list beneficiaries for a user
router.get('/:user_id', asyncHandler(async (req, res) => {
  const userId = req.params.user_id;
  const list = await PayoutBeneficiary.findAll({ where: { user_id: userId } });
  res.json({ success: true, data: list });
}));

// update beneficiary
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = req.company;

  if(!companyId){
    console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
    return res.status(400).json({message : "No Domain Name is registered"});
  }

  const id = req.params.id;
  const ben = await PayoutBeneficiary.findByPk(id);
  if (!ben) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }
  await ben.update({
    ...req.body,
    company_id : companyId,
  });
  res.json({ success: true, data: ben });
}));

// delete beneficiary
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const ben = await PayoutBeneficiary.findByPk(id);
  if (!ben) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }
  await ben.destroy();
  res.json({ success: true, message: 'Deleted' });
}));

module.exports = router;