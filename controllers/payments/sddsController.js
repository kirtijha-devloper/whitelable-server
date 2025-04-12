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
      username: '9024621059',
      password: '12345678',
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
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
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
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// Remitter Login Controller
router.post('/remitter-login', async (req, res) => {
  try {
      const mobileNumber = req.body.mobile_number
      const lat = req.body.lat
      const long = req.body.long
      const token = req.body.sddsToken

      if (!mobileNumber || !lat || !long || !token){
          res.status(400);
          throw new Error('Invalid request');
      }

      
    const payload = {
      mobileNumber: mobileNumber,
      lat: lat,
      long: long
    };

    const data = await sddsService.remitterLogin({payload ,token});

    const remitter = await Remitter.findOne({where: {mobile_number: mobileNumber }})
      if (!remitter) {
        return res.status(404).json({ message: "Remitter not found. Please register first." , data});
      }

    res.json({
      message: 'Remitter login successful',
      data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

// Add other controllers similarly...

router.post('/remitter-register', async (req, res) => {
  try {
      const userId =  req.user?.id || 10;
      
      const mobileNumber = req.body.mobile_number
      const otp = req.body.otp
      const name = req.body.name
      const token = req.body.sddsToken
      if (!mobileNumber|| !name){
          res.status(400);
          throw new Error('Invalid request');
      }

    const payload = {
      mobileNumber: mobileNumber,
      otp: otp,
      name: name
    };

    const data = await sddsService.remitterRegister({payload, token});
    
    await Remitter.create({
      merchant_id: userId,
      mobile_number: mobileNumber,
      name: name,
      external_reference_id: data?.reference_id || null // need to change after api response
    });
    res.json({ message: 'Remitter registered' , data});
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

router.post('/remitter-beneficiaries', async (req, res) => {
  try {
    const userId = req.user?.id || 10;
    const role = req.user?.role || "merchant";
    const { lat, long } = req.body;
    const mobileNumber = req.body.mobile_number
    const status = req.body.status
    const thirdPartyDataRequired =  false // case when third party data is required

    if (!mobileNumber || !lat || !long) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const remitter = await Remitter.findOne({ where: { mobile_number: mobileNumber } });

    if (!remitter) {
      return res.status(404).json({ success: false, message: 'Remitter not found. Please register first.' });
    }

    // If you want data from third-party (SDDS)
    if (false) {
      const payload = { mobile: mobileNumber, lat, long };
      const data = await sddsService.getBeneficiaries({ payload, token });
      return res.status(200).json({ message: 'Beneficiaries fetched from SDDS', data });
    }

    // Fetch from local DB
    const where = {
      remitter_id: remitter.id,
      status: 1
    };

    if (role !== "admin") {
      where.user_id = userId;
    }

    const data = await Beneficiary.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({ message: 'Beneficiaries fetched', data });

  } catch (error) {
    console.error("Error fetching beneficiaries:", error);
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
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
    const token = req.body.sddsToken

     if (!remitterId || !mobileNumber || !bankName || !accountNumber || !ifscCode || !bankAccountHolderName || !beneficiaryMobile) {
      res.status(400);
      throw new Error("All fields are required");
    }

    const payload = {
      mobile: mobileNumber,
      bank_name: bankName,
      bank_account_number: accountNumber,
      bank_account_holder_name: bankAccountHolderName,
      bank_ifsc: ifscCode,
      BeneficiaryMobile: beneficiaryMobile,
      status: 1
    };

    const data = await sddsService.addBeneficiary({payload, token});

      await Beneficiary.create({
        user_id: req.user?.id || 10,
        remitter_id: remitterId,
        mobile: mobileNumber,
        bank_name: bankName,
        bank_account_number: accountNumber,
        bank_account_holder_name: bankAccountHolderName,
        bank_ifsc: ifscCode,
        beneficiary_mobile: beneficiaryMobile,
        status: 1,
        external_reference_id: data?.data?.data?.id || null
      });

    res.json({ message: 'Beneficiary added', data });
  } catch (error) {
     res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

router.post('/delete-beneficiary', async (req, res) => {
  const {id, lat,long}  = req.body;
  const mobilelNumber = req.body.mobile_number
  const token = req.body.sddsToken

   if (!id || !mobilelNumber || !lat || !long) {
    res.status(400);
    throw new Error("Missing required fields");
  }

    const beneficiary = await Beneficiary.findByPk(id);
     if (!beneficiary) {
    res.status(404);
    throw new Error("Beneficiary not found");
    }
  try {
      const payload = {
        id: beneficiary.external_reference_id,
        mobile: mobilelNumber,
        lat,
        long
      };

    const data = await sddsService.deleteBeneficiary({payload, token});

    beneficiary.status = "in_active"
    await beneficiary.save();

    res.json({ message: 'Beneficiary deleted', data });
  } catch (error) {
    res.status(500).json({ error });
  }
});

router.post('/transfer-imps', async (req, res) => {
  try {
    const userId = req.user.id
    const userRole = req.user.role
    const token = req.body.sddsToken

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

    const data = await sddsService.transferIMPS({payload, token});
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

  router.get('/imps-transactions-list', async (req, res) => {
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
