const express = require('express');
const router = express.Router();
const sddsService = require('../../services/payments/sddsService');

// Login Controller
router.post('/login', async (req, res) => {
  try {
    const payload = {
      username: '9024621059',
      password: '12345678',
      otp: 'yes',
      browser_id: '52e49c456f92b900cf0ed2e20172a7c2',
      lat: '26.9194401',
      long: '75.7531271'
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
  try {
    const payload = {
      tpin: '0000',
      login: 'yes',
      browser_id: '52e49c456f92b900cf0ed2e20172a7c2'
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
    const payload = {
      mobileNumber: '9999988888',
      lat: '26.8913845',
      long: '75.7728197'
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
    const payload = {
      mobileNumber: '8888899999',
      otp: '1234',
      name: 'test'
    };

    const data = await sddsService.remitterRegister(payload);
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
    const payload = {
      mobile: '9024621059',
      bank_name: 'Test Bank',
      bank_account_number: '12344895783748',
      bank_account_holder_name: 'Test',
      bank_ifsc: 'TEST1223',
      BeneficiaryMobile: '99999777777',
      status: 1
    };

    const data = await sddsService.addBeneficiary(payload);
    res.json({ message: 'Beneficiary added', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.post('/delete-beneficiary', async (req, res) => {
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
