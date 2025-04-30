const express = require('express');
const router = express.Router();
const sddsService = require('../../services/payments/sddsService');
const asyncHandler = require("express-async-handler");
const Remitter = require("../../models/Remitter")
const WalletTransaction = require("../../models/WalletTransaction")
const User = require("../../models/User")
const Beneficiary = require("../../models/Beneficiary");
const ChargeSlab = require('../../models/ChargeSlab');
const Tpin = require('../../models/Tpin');

// Login Controller
router.post('/login', async (req, res) => {
  try {
    if (!req.body.browser_id || !req.body.lat || !req.body.long) {
      res.status(400);
      throw new Error('Missing required parameters');
    }
    const payload = {
      username: '7669978021',
      password: '7669978021',
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
      remitter_id: remitter.id,
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
    
   const remitter =  await Remitter.create({
      merchant_id: userId,
      mobile_number: mobileNumber,
      name: name,
      external_reference_id: data?.user?.id || null // For now api not sending any reference ID
    });
    res.json({ message: 'Remitter registered' , data, remitter_id: remitter.id});
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

router.post('/remitter-beneficiaries', async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role || "merchant";
    const { lat, long } = req.body;
    const mobileNumber = req.body.mobile_number
    const status = req.body.status
    const thirdPartyDataRequired =  req.body.is_third_party_data_required // case when third party data is required
    const token = req.body.sddsToken

    if (!mobileNumber || !lat || !long) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const remitter = await Remitter.findOne({ where: { mobile_number: mobileNumber } });

    if (!remitter) {
      return res.status(404).json({ success: false, message: 'Remitter not found. Please register first.' });
    }

    // If you want data from third-party (SDDS)
    if (thirdPartyDataRequired) {
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
    const branchName = req.body.branch_name
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
        bank_branch_name:  branchName,
        status: 1,
        external_reference_id: data?.data?.id || null
      });

    res.json({ message: 'Beneficiary added', data });
  } catch (error) {
     res.status(500).json({ success: false, message: error.message || 'Something went wrong' });
  }
});

router.post('/delete-beneficiary', async (req, res) => {
  const {reference_id, lat,long, id}  = req.body;
  const mobilelNumber = req.body.mobile_number
  const token = req.body.sddsToken

   if (!reference_id || !id || !mobilelNumber || !lat || !long) {
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
        id: beneficiary.external_reference_id || reference_id,
        mobile: mobilelNumber,
        lat,
        long
      };

    const data = await sddsService.deleteBeneficiary({payload, token});

    beneficiary.status = 0
    await beneficiary.save();

    res.json({ message: 'Beneficiary deleted', data });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});

router.post('/transfer-imps', async (req, res) => {
  let pending_transaction;
  try {
    const userId = req.user?.id || 11
    const userRole = req.user?.role || 'merchant'
    const token = req.body.sddsToken
    const beneficiaryId = req.body.beneficiary_id
    const externalReferenceId = req.body.external_reference_id
    const remitterNumber = req.body.remitter_number

      // const tpin  = req.body.tpin;

      // if (!tpin) {
      //   res.status(400);
      //   throw new Error("T-PIN is required");
      // }

      // const savedTpin = await Tpin.findOne({ where: { user_id: userId } });

      // if (!savedTpin) {
      //   res.status(404);
      //   throw new Error("T-PIN not found. Please generate one.");
      // }

      // if (new Date(savedTpin.expires_at) < new Date()) {
      //   res.status(400);
      //   throw new Error("T-PIN has expired. Please generate a new one.");
      // }

      // const isMatch = await bcrypt.compare(tpin.toString(), savedTpin.tpin);

      // if (!isMatch) {
      //   res.status(401);
      //   throw new Error("Invalid T-PIN");
      // }

    const user = await User.findByPk(userId)
    const amount = parseFloat(req.body.amount);
  
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid transfer amount" });
    }

    if (parseFloat(user.wallet) < amount) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    const beneficiary = await Beneficiary.findByPk(beneficiaryId)
     if (!beneficiary) {
      return res.status(404).json({ message: "Beneficiary not found" });
    }

    if (beneficiary.status === 0) {
      return res.status(400).json({ message: "Beneficiary is disabled" });
    }

    pending_transaction = await WalletTransaction.create({
      type: "request",
      amount: amount,
      status: "pending",
      reason: `IMPS to ${beneficiary.bank_account_holder_name}`,
      requested_by: beneficiary.id,
      source: "imps"
    });


    const payload= {
      TRANSFER_TYPE_DESC: "IMPS",
      BENE_BANK: beneficiary.bank_name,
      INPUT_DEBIT_AMOUNT: req.body.amount,
      INPUT_VALUE_DATE: "12/04/2025",
      TRANSACTION_TYPE: "SINGLE",
      BENE_ACC_NAME: beneficiary.bank_account_holder_name,
      BENE_ACC_NO: beneficiary.bank_account_number,
      BENE_BRANCH: beneficiary.bank_branch_name,
      BENE_IDN_CODE: beneficiary.bank_ifsc,
      REMITTER_BENE_ID: externalReferenceId,
      REMITTER_NUMBER: remitterNumber
    }
    const data = await sddsService.transferIMPS({payload, token});
    // Deduct balance from user wallet
    user.wallet = parseFloat(user.wallet) - amount;
    await user.save();
    pending_transaction.status = "completed"
    await pending_transaction.save()

    await WalletTransaction.create({
      type: "transfer",
      amount: amount,
      status: "completed",
      reason: `IMPS to ${payload.BENE_ACC_NAME}`,
      requested_by: beneficiary.id,
      approved_by: beneficiary.remitter_id,
      source: "imps",
      reference_id: userId // need to think what shuold be passed
    });

    res.json({ message: 'IMPS transfer successful', data });
  } catch (error) {
      if (pending_transaction) {
      pending_transaction.status = "failed"
      pending_transaction.reason = `IMPS FAILED`
      await pending_transaction.save();
    }
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});

router.get('/remitter-list', async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    const where = {};
    if (role === 'merchant') {
      where.merchant_id = userId;
    }

    const remitters = await Remitter.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      count: remitters.length,
      data: remitters,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong while fetching remitter list",
    });
  }
});

  router.get('/remitter/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const remitter = await Remitter.findByPk(id);
    if (!remitter) {
      return res.status(404).json({
        success: false,
        message: 'Remitter not found'
      });
    }

    const slab = await ChargeSlab.findAll({
      where: {
        charge_type_category: "payout_slab",
        user_id: remitter.merchant_id
      }
    });

    if (!slab.length) {
      return res.status(200).json({
        success: true,
        message: "No payout slab found for this remitter's merchant.",
        data: {
          remitter,
          payout_slab: []
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        remitter,
        payout_slab: slab
      }
    });

  } catch (error) {
    console.error("Error fetching remitter:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong"
    });
  }
});

// TODO: Seggrigation on franchise and merhchant level on transaction data

  router.get('/imps-transactions-list', async (req, res) => {
    try {
      const role = req.user?.role || "merchant";

      const { remitter_id, beneficiary_id, user_id, status, type } = req.query;
      const where = {
        source: "imps"
      };

      if (type) {
        where.type = type;
      }
      if (status) {
        where.status = status;
      }

      if(user_id){
        const remitters = await Remitter.findAll({
          where: { merchant_id: user_id },
          attributes: ['id']
        });

         const remitterIds = remitters.map(r => r.id);
         where.approved_by = remitterIds
      }


      // 🔍 Optional filters
      if (remitter_id) {
        where.approved_by = remitter_id;
      }

      if (beneficiary_id) {
        where.requested_by = beneficiary_id;
      }

      const transactions = await WalletTransaction.findAll({
        where,
        order: [["createdAt", "DESC"]],
      });

      res.status(200).json({
        count: transactions.length,
        transactions,
      });
    } catch (error) {
      console.error("IMPS Transaction List Error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch transactions." });
    }
});


module.exports = router;
