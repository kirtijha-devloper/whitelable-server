const express = require('express');
const asyncHandler = require('express-async-handler');
const db = require('../../config/database');
const { Op } = require('sequelize');
const User = require('../../models/User');
const Tpin = require('../../models/Tpin');
const RefSequence = require('../../models/RefSequence');
const PayoutRequest = require('../../models/PayoutRequest');
const PayoutBeneficiary = require('../../models/PayoutBeneficiary');
const ServiceChargeSlab = require('../../models/ServiceChargeSlab');
const ledgerService = require('../../services/ledgerService');
const credxpayService = require('../../services/credxpayService');
const PayoutAuditLog = require('../../models/PayoutAuditLog');

const router = express.Router();

// POST /payout/credxpay  -- finalize payout request
router.post('/', asyncHandler(async (req, res) => {
  const {
    user_id,
    beneficiary_id,
    amount: rawAmount,
    tpin,
    latitude,
    longitude,
    purpose
  } = req.body;

  if (!user_id) {
    return res.status(401).json({ success: false, message: 'Unauthorized: user_id required' });
  }

  // verify T-PIN if provided
  if (!tpin) {
    return res.status(400).json({ success: false, message: 'T-PIN is required' });
  }
  const savedTpin = await Tpin.findOne({ where: { user_id } });
  if (!savedTpin) {
    return res.status(404).json({ success: false, message: 'T-PIN not found. Please generate one.' });
  }
  if (new Date(savedTpin.expires_at) < new Date()) {
    return res.status(400).json({ success: false, message: 'T-PIN has expired. Please generate a new one.' });
  }
  const bcrypt = require('bcrypt');
  const isMatch = await bcrypt.compare(tpin.toString(), savedTpin.tpin);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid T-PIN' });
  }

  const amount = parseFloat(rawAmount);
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payout amount' });
  }

  if (!beneficiary_id) {
    return res.status(400).json({ success: false, message: 'beneficiary_id is required' });
  }

  // fetch beneficiary for details
  const beneficiary = await PayoutBeneficiary.findByPk(beneficiary_id);
  if (!beneficiary) {
    return res.status(404).json({ success: false, message: 'Beneficiary not found' });
  }
  if (!beneficiary.is_verified) {
    return res.status(400).json({ success: false, message: 'Beneficiary is not verified' });
  }

  // compute service charge using slabs
  let service_charge = 0;
  const slab = await ServiceChargeSlab.findOne({
    where: {
      service_name: 'payout',
      min_amount: { [Op.lte]: amount },
      max_amount: { [Op.gte]: amount }
    },
    order: [['min_amount', 'DESC']]
  });
  if (slab) {
    service_charge = parseFloat(slab.service_charge || 0);
  }

  const total_amount = amount + service_charge;

  // wrap critical wallet/debit operations in a transaction
  const transaction = await db.transaction();
  try {
      if (!['merchant', 'franchaise'].includes(req.user.role)) {
      await transaction.rollback();
      return res.status(403).json({ success: false, message: 'Only merchant or franchise can initiate payouts' });
    }

    // lock user row to avoid concurrent debits
    const user = await User.findByPk(user_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.is_payout_enabled) {
      await transaction.rollback();
      return res.status(403).json({ success: false, message: 'Payout service is disabled for this user' });
    }
    const availableBalance = await ledgerService.getAvailableBalance(user_id);
    if (availableBalance < total_amount) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    // generate a unique request id
    const seq = await RefSequence.findOne({ where: { service: 'payout' }, transaction, lock: transaction.LOCK.UPDATE });
    if (!seq) {
      throw new Error('Reference sequence for payout not initialized');
    }
    const requestId = `PX${seq.current_number}`; // prefix to differentiate
    seq.current_number = seq.current_number + 1;
    await seq.save({ transaction });

    const openingBalance = parseFloat(user.wallet || 0);
    const closingBalance = openingBalance - total_amount;

    // insert processing request
    const payoutReq = await PayoutRequest.create({
      request_id: requestId,
      user_id,
      amount,
      charge: service_charge,
      beneficiary_name: beneficiary.name,
      mobile_number: beneficiary.mobile,
      account_number: beneficiary.account_number,
      ifsc_code: beneficiary.ifsc_code,
      bank_name: beneficiary.bank_name,
      transfer_mode: 'IMPS',
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      response_status: 'PROCESSING',
      service_provider: 'CredXPay',
      latitude: latitude || null,
      longitude: longitude || null,
      email_id: beneficiary.email || null,
      purpose: purpose || null
    }, { transaction });

    // audit log entry for request creation
    await PayoutAuditLog.create({
      payout_id: payoutReq.id,
      action: 'USER_INIT',
      details: {
        user_id,
        amount,
        service_charge,
        beneficiary_id,
        request_id: requestId
      }
    }, { transaction });

    // immediately debit via ledger
    await ledgerService.createPayoutEntry({
      userId: user_id,
      payoutTransactionId: payoutReq.id,
      amount: total_amount,
      description: `CredXPay payout ${requestId}`,
      metadata: {
        amount,
        service_charge,
        request_id: requestId
      }
    }, { transaction });

    await transaction.commit();

    // call external API asynchronously; status update will be via webhook/cron
    credxpayService.initiateTransaction({
      requestId,
      amount,
      // other data such as beneficiary information should be sent
    }).then(response => {
      // update request record to pending with api details
      PayoutRequest.update({
        response_status: 'PENDING',
        api_txn_id: response.txnId || null,
        response: response
      }, {
        where: { id: payoutReq.id }
      }).catch(err => console.error('Failed to update payout request post-API', err));
    }).catch(err => {
      // we do not rollback wallet here; webhook or cron will eventually handle failure
      console.error('CredXPay initiate transaction failed', err);
    });

    return res.json({ success: true, message: 'Transaction submitted', requestId });
  } catch (err) {
    await transaction.rollback();
    console.error('payout finalize error', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'error' });
  }
}));

module.exports = router;