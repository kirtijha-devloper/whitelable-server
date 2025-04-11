const express = require('express');
const router = express.Router();
const sddsService = require('../../services/payments/sddsService');
const asyncHandler = require("express-async-handler");
const Remitter = require("../../models/Remitter")
const WalletTransaction = require("../../models/WalletTransaction")
const User = require("../../models/User")
const Beneficiary = require("../../models/Beneficiary")

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

      const remitter = await Remitter.findOne({where: {mobile_number: mobileNumber }})
      if (!remitter) {
        return res.status(404).json({ message: "Remitter not found. Please register first." });
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
    const userId = req.user.id
    const userRole = req.user.role

    const user = await User.findByPk(userId)
    const amount = parseFloat(req.body.amount);
  
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid transfer amount" });
    }

    if (parseFloat(user.wallet) < amount) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }
    
    const payload = {
      TRANSFER_TYPE_DESC: 'IMPS',
      BENE_BANK: req.body.bene_bank,
      INPUT_DEBIT_AMOUNT: amount.toString(),
      INPUT_VALUE_DATE: '13/12/2024',
      TRANSACTION_TYPE: 'SINGLE',
      BENE_ACC_NAME: req.body.bene_acc_name ,
      BENE_ACC_NO: req.body.bene_acc_no,
      BENE_BRANCH: req.body.bene_branch || 'NA',
      BENE_IDN_CODE: req.body.bene_ifsc
    };

    const data = await sddsService.transferIMPS(payload);
    // Deduct balance from user wallet
    user.wallet = parseFloat(user.wallet) - amount;
    await user.save();

    await WalletTransaction.create({
      type: "transfer",
      amount: amount,
      status: "completed",
      reason: `IMPS to ${payload.BENE_ACC_NAME}`,
      requested_by: userId,
      approved_by: userId,
      source: "imps",
      reference_id: data?.transaction_id || null
    });

    res.json({ message: 'IMPS transfer successful', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.get('/remitter-list', async (req, res) => {
  const merchantId = req.user.id;
   const remitters = await Remitter.findAll({
    where: { merchant_id: merchantId },
    order: [["createdAt", "DESC"]],
  });

  res.status(200).json({
    success: true,
    count: remitters.length,
    data: remitters,
  });
});

router.get('/imps-transaction-list', async (req, res) => {
  const merchantId = req.user.id;
   const remitters = await Remitter.findAll({
    where: { merchant_id: merchantId },
    order: [["createdAt", "DESC"]],
  });

  res.status(200).json({
    success: true,
    count: remitters.length,
    data: remitters,
  });
});

  router.get('/imps-transactions', async (req, res) => {
    const userId = req.user.id;
    const role = req.user.role;

     const where = {
        type: "transfer",
        source: "imps"
      };

      if (role !== "admin") {
        where.requested_by = userId;
      }

    const transactions = await WalletTransaction.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      count: transactions.length,
      transactions,
    });
  });

module.exports = router;
