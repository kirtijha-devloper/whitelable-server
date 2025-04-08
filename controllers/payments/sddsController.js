const express = require('express');
const router = express.Router();
const sddsService = require('../../services/payments/sddsService');

// Login Controller
router.post('/login', async (req, res) => {
  try {
    if (!req.body.browser_id || !req.body.lat || !req.body.long) {
      res.status(400);
      throw new Error('Missing required parameters');
    }
    const payload = {
      username: process.env.SDDS_USERNAME,
      password: process.env.SDDS_USERNAME,
      otp: 'yes',
      browser_id: req.body.browser_id,
      lat: req.body.lat,
      long: req.body.long
    };

    const data = await sddsService.login(payload);

    res.json({
      message: 'Login successful',
      data
    });
  } catch (error) {
    res.status(500).json({ error });
  }
});

// Verify TPIN Controller
router.post('/verify-tpin', async (req, res) => {
   if (!req.body.browser_id) {
      res.status(400);
      throw new Error('Missing required parameters');
    }
  try {
    const payload = {
      tpin: process.env.TPIN,
      login: 'yes',
      browser_id: req.body.browser_id
    };

    const data = await sddsService.verifyTPIN(payload);

    res.json({
      message: 'TPIN verified',
      data
    });
  } catch (error) {
    res.status(500).json({ error });
  }
});

// Remitter Login Controller
router.post('/remitter-login', async (req, res) => {
  try {
      const mobileNumber = req.body.mobile_number
      const lat = req.body.lat
      const long = req.body.long

      if (!mobileNumber || !lat || !long){
          res.status(400);
          throw new Error('Invalid request');
      }
    const payload = {
      mobileNumber: mobileNumber,
      lat: lat,
      long: long
    };

    const data = await sddsService.remitterLogin(payload);

    res.json({
      message: 'Remitter login successful',
      data
    });
  } catch (error) {
    res.status(500).json({ error });
  }
});

// Add other controllers similarly...

router.post('/remitter-register', async (req, res) => {
  try {
      const mobileNumber = req.body.mobile_number
      const otp = req.body.otp
      const name = req.body.name
      if (!mobileNumber|| !otp || !name){
          res.status(400);
          throw new Error('Invalid request');
      }
    const payload = {
      mobileNumber: mobileNumber,
      otp: otp,
      name: name
    };

    const data = await sddsService.remitterRegister(payload);

    await Remitter.create({
      merchant_id: req.user.id,
      mobileNumber,
      otp,
      name,
      external_reference_id: data?.reference_id || null
    });

    res.json({ message: 'Remitter registered', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.post('/remitter-beneficiaries', async (req, res) => {
  try {
    const payload = {
      mobile: '9999988888',
      lat: '26.8913845',
      long: '75.7728197'
    };

    const data = await sddsService.getBeneficiaries(payload);
    res.json({ message: 'Beneficiaries fetched', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.post('/add-beneficiary', async (req, res) => {
  try {
    const remitterId = req.body.remitter_id
    const mobileNumber = req.body.mobile_number
    const bankName = req.body.bank_name
    const accountNumber = req.body.account_number
    const ifscCode = req.body.ifsc_code
    const bankAccountHolderName = req.body.bank_account_holder_name
    const beneficiaryMobile = req.body.beneficiary_mobile

    const payload = {
      mobile: mobileNumber,
      bank_name: bankName,
      bank_account_number: accountNumber,
      bank_account_holder_name: bankAccountHolderName,
      bank_ifsc: ifscCode,
      BeneficiaryMobile: beneficiaryMobile,
      status: 1
    };

    const data = await sddsService.addBeneficiary(payload);

     await Beneficiary.create({
      ...payload,
      external_reference_id: data?.reference_id || null, user_id: req.user.id, remitter_id: remitterId 
    });

    res.json({ message: 'Beneficiary added', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.post('/delete-beneficiary', async (req, res) => {
  const id  = req.body.id;
  try {
    const payload = {
      id: 1,
      mobile: '9999988888',
      lat: '26.8913845',
      long: '75.7728197'
    };

    const data = await sddsService.deleteBeneficiary(payload);
    res.json({ message: 'Beneficiary deleted', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.post('/transfer-imps', async (req, res) => {
  try {
    const payload = {
      TRANSFER_TYPE_DESC: 'IMPS',
      BENE_BANK: 'ABC Bank',
      INPUT_DEBIT_AMOUNT: '101',
      INPUT_VALUE_DATE: '13/12/2024',
      TRANSACTION_TYPE: 'SINGLE',
      BENE_ACC_NAME: 'Lucy',
      BENE_ACC_NO: '5072500101670801',
      BENE_BRANCH: 'NA',
      BENE_IDN_CODE: 'ICIC0000002'
    };

    const data = await sddsService.transferIMPS(payload);
    res.json({ message: 'IMPS transfer successful', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

module.exports = router;
