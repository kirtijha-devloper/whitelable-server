const worldlineWebhookQueue = require("../queues/worldlineWebhookQueue");
const WorldlineNotification = require("../models/WorldlineNotification");
const RazorpayNotification = require("../models/RazorpayNotification");
const PosMachine = require("../models/posMachine");
const User = require("../models/User");
const MerchantTransactionCharge = require("../models/MerchantTransactionCharge");
const ChargeService = require("../services/chargeService");
const ledgerService = require("../services/ledgerService");
const { Op } = require("sequelize");
const fs = require("fs");
const path = require("path");

// File-based logger for Worldline worker diagnostics
const LOG_DIR = path.join(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "worldlineWebhookWorker.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function _ts() {
  return new Date().toISOString();
}

function _fileLog(level, args) {
  const parts = args.map((a) =>
    a instanceof Error
      ? `${a.message}\n${a.stack}`
      : typeof a === "object" && a !== null
      ? JSON.stringify(a, null, 2)
      : String(a)
  );
  const line = `[${_ts()}] [${level}] ${parts.join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) { /* ignore log write errors */ }
}

const logger = {
  log:   (...args) => { console.log(...args);   _fileLog("INFO",  args); },
  warn:  (...args) => { console.warn(...args);  _fileLog("WARN",  args); },
  error: (...args) => { console.error(...args); _fileLog("ERROR", args); },
};

function getTodayIstDateWindow(refDate = new Date()) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(refDate.getTime() + istOffsetMs);
  const startOfDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0) - istOffsetMs);
  const endOfDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999) - istOffsetMs);
  return { startOfDay, endOfDay };
}

const normalizeId = (id) => {
  if (id == null) return "";
  const digits = id.toString().trim().replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "");
  return stripped === "" ? digits : stripped;
};

/**
 * Look up active POS machine by matching mid / tid candidates
 */
async function findActivePosMachine(merchantId, terminalId) {
  if (!merchantId || !terminalId) return null;
  const normalizedMid = normalizeId(merchantId);
  const normalizedTid = normalizeId(terminalId);

  const midCandidates = [merchantId.toString().trim()];
  if (normalizedMid && normalizedMid !== midCandidates[0]) midCandidates.push(normalizedMid);

  const tidCandidates = [terminalId.toString().trim()];
  if (normalizedTid && normalizedTid !== tidCandidates[0]) tidCandidates.push(normalizedTid);

  const posMachines = await PosMachine.findAll({
    where: {
      status: 'active',
      tid_number: { [Op.in]: tidCandidates }
    }
  });

  for (const pm of posMachines) {
    const storedMid = normalizeId(pm.mid_number);
    const storedTid = normalizeId(pm.tid_number);
    if (storedMid === normalizedMid && storedTid === normalizedTid) {
      return pm;
    }
  }

  return await PosMachine.findOne({
    where: {
      status: 'active',
      mid_number: { [Op.in]: midCandidates },
      tid_number: { [Op.in]: tidCandidates }
    }
  });
}

/**
 * Creates or updates an entry in RazorpayNotification for a Worldline transaction.
 * Records the transaction whether it succeeds or fails.
 */
async function recordRazorpayNotification({
  txnId,
  notification,
  eventData,
  status,
  isSuccess,
  posMachine = null,
  posOperator = null,
  settlementType = null,
  processingStatus = 'completed',
  processingError = null
}) {
  try {
    const merchantId = notification?.mid || eventData?.mid || null;
    const terminalId = notification?.tid || eventData?.tid || null;
    const rawAmount = notification?.amount != null ? notification.amount : (eventData?.amount != null ? eventData.amount : 0);
    const amountVal = rawAmount != null ? Math.round(Number(rawAmount)) : null;

    const rrnVal = notification?.rrn || eventData?.rrn || eventData?.rr_number || null;
    const paymentMode = (eventData?.txn_type || 'CRDB').toUpperCase();
    const cardScheme = (notification?.card_scheme || eventData?.card_scheme || 'VISA').toUpperCase();

    // Map status: if isSuccess: 'SUCCESS', if failed: 'FAILED'
    const statusVal = isSuccess ? 'SUCCESS' : (status ? String(status).toUpperCase() : 'FAILED');

    let postingDateVal = null;
    if (eventData?.txn_date) {
      const d = eventData.txn_date;
      const t = eventData.txn_time || '00:00:00';
      const parsed = new Date(`${d} ${t}`);
      postingDateVal = isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      postingDateVal = new Date();
    }

    const companyId = posOperator?.company_id || posMachine?.company_id || notification?.company_id || null;

    const defaults = {
      txn_id: txnId,
      mid: merchantId ? merchantId.toString() : null,
      tid: terminalId ? terminalId.toString() : null,
      amount: amountVal,
      currency_code: eventData?.currency || eventData?.currency_code || 'INR',
      payment_mode: paymentMode,
      payment_card_type: 'CREDIT',
      payment_card_brand: cardScheme,
      rr_number: rrnVal,
      device_serial: eventData?.device_serial || null,
      posting_date: postingDateVal,
      event_json: eventData || notification?.event_json || {},
      status: statusVal,
      source: notification?.source || 'worldline',
      settlement_type: settlementType || posOperator?.settlement_type || null,
      user_id: posOperator ? posOperator.id : null,
      company_id: companyId,
      pos_machine_id: posMachine ? posMachine.id : null,
      processed: true,
      processing_status: processingStatus,
      processing_error: processingError,
      processed_at: new Date()
    };

    const [record, created] = await RazorpayNotification.findOrCreate({
      where: { txn_id: txnId },
      defaults
    });

    if (!created) {
      await record.update({
        mid: defaults.mid,
        tid: defaults.tid,
        amount: defaults.amount,
        currency_code: defaults.currency_code,
        payment_mode: defaults.payment_mode,
        payment_card_type: defaults.payment_card_type,
        payment_card_brand: defaults.payment_card_brand,
        rr_number: defaults.rr_number,
        device_serial: defaults.device_serial,
        posting_date: defaults.posting_date,
        event_json: defaults.event_json,
        status: statusVal,
        source: defaults.source,
        settlement_type: defaults.settlement_type,
        user_id: defaults.user_id,
        company_id: defaults.company_id,
        pos_machine_id: defaults.pos_machine_id,
        processed: true,
        processing_status: processingStatus,
        processing_error: processingError,
        processed_at: new Date()
      });
    }

    logger.log(`[Worldline Webhook Worker] ${created ? 'Created' : 'Updated'} RazorpayNotification for txn: ${txnId} (status=${statusVal}, processing_status=${processingStatus})`);
    return record;
  } catch (err) {
    writeDevLog("webhook", { file: "worldlineWebhookWorker.js", error: err });
    logger.error(`[Worldline Webhook Worker] Failed to record RazorpayNotification for txn: ${txnId}:`, err);
  }
}

async function processWorldlineJob(jobData, jobId = null) {
  const { txnId, status, event, notificationId } = jobData || {};
  const currentJobId = jobId || `direct-${Date.now()}`;
  logger.log(`[Worldline Webhook Worker] Processing business logic for txn: ${txnId}, status: ${status} (jobId: ${currentJobId})`);

  try {
    const notification = await WorldlineNotification.findOne({
      where: notificationId ? { id: notificationId } : { txn_id: txnId }
    });

    if (!notification) {
      throw new Error(`Worldline notification not found in database for txn: ${txnId}`);
    }

    const eventData = typeof notification.event_json === 'string'
      ? JSON.parse(notification.event_json)
      : notification.event_json;

    const merchantId = notification.mid || eventData.mid;
    const terminalId = notification.tid || eventData.tid;
    const transactionAmount = parseFloat(notification.amount || eventData.amount || 0);

    const respCode = (eventData && (eventData.resp_code || eventData.response_code || eventData.responseCode)) || '';
    const isSuccessStatus = (status || '').toString().toLowerCase() === 'success' ||
                            (status || '').toString().toLowerCase() === 'approved' ||
                            respCode === '00' || respCode === '0' || respCode === 0;

    if (!isSuccessStatus) {
      logger.warn(`[Worldline Webhook Worker] Transaction ${txnId} status is '${status}'. Recording in RazorpayNotification and marking completed without wallet credit.`);
      
      let failedPosMachine = null;
      let failedPosOperator = null;
      if (merchantId && terminalId) {
        failedPosMachine = await findActivePosMachine(merchantId, terminalId);
        if (failedPosMachine && failedPosMachine.assigned_to) {
          failedPosOperator = await User.findByPk(failedPosMachine.assigned_to);
        }
      }

      await recordRazorpayNotification({
        txnId,
        notification,
        eventData,
        status: 'FAILED',
        isSuccess: false,
        posMachine: failedPosMachine,
        posOperator: failedPosOperator,
        settlementType: failedPosOperator?.settlement_type || null,
        processingStatus: 'completed',
        processingError: `Transaction status is '${status}'`
      });

      await notification.update({
        user_id: failedPosOperator ? failedPosOperator.id : null,
        pos_machine_id: failedPosMachine ? failedPosMachine.id : null,
        processed: true,
        processing_status: 'completed',
        processing_error: `Transaction status is '${status}'`,
        processed_at: new Date()
      });
      return;
    }

    if (!merchantId || !terminalId || !transactionAmount || Number.isNaN(transactionAmount)) {
      const errMsg = `Missing mid (${merchantId}), tid (${terminalId}), or amount (${transactionAmount}) for txn: ${txnId}`;
      logger.error(`[Worldline Webhook Worker] ${errMsg}`);
      await recordRazorpayNotification({
        txnId,
        notification,
        eventData,
        status: 'FAILED',
        isSuccess: false,
        processingStatus: 'needs_admin',
        processingError: errMsg
      });
      await notification.update({
        status: 'failed',
        processed: true,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    // Match active POS machine by tid / mid
    const posMachine = await findActivePosMachine(merchantId, terminalId);

    if (!posMachine) {
      const errMsg = `POS machine not found for Worldline mid=${merchantId}, tid=${terminalId}`;
      logger.warn(`[Worldline Webhook Worker] ⚠️ ${errMsg}. Transaction marked as FAILED.`);
      await recordRazorpayNotification({
        txnId,
        notification,
        eventData,
        status: 'FAILED',
        isSuccess: false,
        processingStatus: 'needs_admin',
        processingError: errMsg
      });
      await notification.update({
        status: 'failed',
        processed: true,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    if (!posMachine.assigned_to) {
      const errMsg = `POS machine ${posMachine.id} (mid=${merchantId}, tid=${terminalId}) has no assigned merchant`;
      logger.warn(`[Worldline Webhook Worker] ⚠️ ${errMsg}. Transaction marked as FAILED.`);
      await recordRazorpayNotification({
        txnId,
        notification,
        eventData,
        status: 'FAILED',
        isSuccess: false,
        posMachine,
        processingStatus: 'needs_admin',
        processingError: errMsg
      });
      await notification.update({
        status: 'failed',
        pos_machine_id: posMachine.id,
        processed: true,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    const posOperator = await User.findByPk(posMachine.assigned_to);
    if (!posOperator) {
      const errMsg = `Assigned user ID ${posMachine.assigned_to} not found for POS machine ${posMachine.id}`;
      logger.warn(`[Worldline Webhook Worker] ⚠️ ${errMsg}. Transaction marked as FAILED.`);
      await recordRazorpayNotification({
        txnId,
        notification,
        eventData,
        status: 'FAILED',
        isSuccess: false,
        posMachine,
        processingStatus: 'needs_admin',
        processingError: errMsg
      });
      await notification.update({
        status: 'failed',
        pos_machine_id: posMachine.id,
        processed: true,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    // Settlement Type Evaluation:
    // If the settlement amount exceeds the merchant's assigned T0 limit, transaction goes to T1 (T+1), otherwise T0.
    // If merchant is explicitly configured for T1 (next_day_settlement), it always goes to T1.
    let settlementTypeSnapshot = 'T0';
    const userSettlementMode = String(posOperator.settlement_type || 'T0').toUpperCase();
    const isExplicitT1 = userSettlementMode === 'T1' || userSettlementMode === 'NEXT_DAY_SETTLEMENT';

    if (isExplicitT1) {
      settlementTypeSnapshot = 'T1';
      logger.log(`[Worldline Webhook Worker] Merchant ${posOperator.id} is explicitly configured for Next-Day Settlement (T1).`);
    } else {
      const rawLimit = posOperator.t0_daily_limit;
      const isLimitAssigned = rawLimit !== null && rawLimit !== undefined && rawLimit !== '' && String(rawLimit).toLowerCase() !== 'unlimited';
      const t0Limit = isLimitAssigned ? Number(rawLimit) : null;

      if (isLimitAssigned && !isNaN(t0Limit)) {
        let todayT0Total = 0;
        try {
          const { startOfDay, endOfDay } = getTodayIstDateWindow(new Date());
          const sumResult = await RazorpayNotification.sum('amount', {
            where: {
              user_id: posOperator.id,
              status: { [Op.in]: ['CAPTURED', 'SUCCESS', 'AUTHORIZED', 'captured', 'success', 'authorized'] },
              settlement_type: { [Op.in]: ['T0', 'today_settlement', 'TODAY_SETTLEMENT', 't0'] },
              createdAt: { [Op.between]: [startOfDay, endOfDay] }
            }
          });
          todayT0Total = parseFloat(sumResult) || 0;
        } catch (sumErr) {
          todayT0Total = 0;
        }

        const projectedTotal = todayT0Total + transactionAmount;
        if (transactionAmount > t0Limit || projectedTotal > t0Limit) {
          settlementTypeSnapshot = 'T1';
          logger.warn(`[Worldline Webhook Worker] ⚠️ Settlement limit exceeded for merchant ${posOperator.id} (Txn: ₹${transactionAmount}, Today T0: ₹${todayT0Total}, Limit: ₹${t0Limit}). Shifted to T1 (T+1).`);
        } else {
          settlementTypeSnapshot = 'T0';
          logger.log(`[Worldline Webhook Worker] Settlement within T0 limit for merchant ${posOperator.id} (Txn: ₹${transactionAmount}, Projected: ₹${projectedTotal}, Limit: ₹${t0Limit}). Assigned T0.`);
        }
      } else {
        // No limit assigned or unlimited -> default to T0
        settlementTypeSnapshot = 'T0';
      }
    }

    // Check duplicate processing
    const existingCharge = await MerchantTransactionCharge.findOne({
      where: { razorpay_transaction_id: txnId }
    });

    if (existingCharge) {
      logger.log(`[Worldline Webhook Worker] MerchantTransactionCharge already exists for txn: ${txnId}`);
      await recordRazorpayNotification({
        txnId,
        notification,
        eventData,
        status: 'SUCCESS',
        isSuccess: true,
        posMachine,
        posOperator,
        settlementType: settlementTypeSnapshot,
        processingStatus: 'completed',
        processingError: null
      });
      await notification.update({
        user_id: posOperator.id,
        pos_machine_id: posMachine.id,
        processed: true,
        processing_status: 'completed',
        processed_at: new Date()
      });
      return;
    }

    // Resolve Super Franchise ID upfront so it's available for chargeRule and earnings
    let resolvedSuperFranchiseId = posOperator.super_franchise_id || null;
    if (!resolvedSuperFranchiseId && posOperator.franchaise_id) {
      const franchiseUser = await User.findByPk(posOperator.franchaise_id);
      resolvedSuperFranchiseId = franchiseUser ? franchiseUser.super_franchise_id : null;
    }

    // Calculate MDR charges via ChargeService
    const paymentMode = (eventData.txn_type || 'CRDB').toUpperCase();
    const cardScheme = (notification.card_scheme || eventData.card_scheme || 'VISA').toUpperCase();

    let chargeRule = await ChargeService.getChargeRule({
      userId: posOperator.id,
      userRole: posOperator.role,
      franchiseId: posOperator.franchaise_id || null,
      superFranchiseId: resolvedSuperFranchiseId || null,
      companyId: posOperator.company_id || null,
      companyName: posMachine ? posMachine.company_name : null,
      paymentMode: paymentMode,
      cardType: 'CREDIT',
      cardBrand: cardScheme,
      classification: eventData?.card_classification || null,
      settlement: settlementTypeSnapshot || null,
      amount: transactionAmount
    });

    if (!chargeRule) {
      const defaultMdr = 2.5;
      chargeRule = {
        charge_percent: defaultMdr,
        charge_flat: 0,
        gst_required: false,
        gst_percent: 0
      };
    }

    const chargeResult = ChargeService.calculateCharge(transactionAmount, chargeRule);
    const chargeAmount = chargeResult.charge;
    const gstAmount = chargeResult.gstAmount || 0;
    const netAmount = parseFloat((transactionAmount - chargeAmount - gstAmount).toFixed(2));

    // Super franchise earning calculation resolution
    let superFranchiseChargeAmount = 0;
    let superFranchiseEarning = 0;

    // Franchise earning calculation if applicable
    let franchiseChargeAmount = 0;
    let franchiseEarning = 0;
    if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
      const franchiseRule = await ChargeService.getAdminChargeRuleForFranchise({
        franchiseId: posOperator.franchaise_id,
        superFranchiseId: resolvedSuperFranchiseId,
        paymentMode: paymentMode,
        cardType: 'CREDIT',
        cardBrand: cardScheme,
        settlement: settlementTypeSnapshot || null,
        amount: transactionAmount
      });

      if (franchiseRule) {
        franchiseChargeAmount = ChargeService.calculateCharge(transactionAmount, franchiseRule).charge;
      } else {
        const DEFAULT_MDR = 2.5;
        franchiseChargeAmount = parseFloat((transactionAmount * (DEFAULT_MDR / 100)).toFixed(2));
      }
      franchiseEarning = parseFloat((chargeAmount - franchiseChargeAmount).toFixed(2));
    }

    if (resolvedSuperFranchiseId) {
      const sfRule = await ChargeService.getAdminChargeRuleForSuperFranchise({
        superFranchiseId: resolvedSuperFranchiseId,
        paymentMode: paymentMode,
        cardType: 'CREDIT',
        cardBrand: cardScheme,
        settlement: settlementTypeSnapshot || null,
        amount: transactionAmount
      });

      if (sfRule) {
        superFranchiseChargeAmount = ChargeService.calculateCharge(transactionAmount, sfRule).charge;
      } else {
        const DEFAULT_MDR = 2.5;
        superFranchiseChargeAmount = parseFloat((transactionAmount * (DEFAULT_MDR / 100)).toFixed(2));
      }
      const upwardToSF = posOperator.franchaise_id ? franchiseChargeAmount : chargeAmount;
      superFranchiseEarning = Math.max(0, parseFloat((upwardToSF - superFranchiseChargeAmount).toFixed(2)));
      logger.log(`[Worldline Webhook Worker] Super franchise charge: ${superFranchiseChargeAmount}, earning: ${superFranchiseEarning}`);
    }

    // Resolve Admin user to calculate Admin earning
    let adminUser = null;
    let adminCostAmount = 0;
    let adminEarning = 0;
    let paidUpwardToAdmin = chargeAmount;
    if (resolvedSuperFranchiseId) {
      paidUpwardToAdmin = superFranchiseChargeAmount;
    } else if (posOperator.franchaise_id) {
      paidUpwardToAdmin = franchiseChargeAmount;
    }

    if (posOperator.admin_id) {
      adminUser = await User.findByPk(posOperator.admin_id);
    }
    if (!adminUser && posOperator.company_id) {
      adminUser = await User.findOne({
        where: { role: 'admin', company_id: posOperator.company_id }
      });
    }

    if (adminUser) {
      const adminRule = await ChargeService.getSuperAdminChargeRuleForAdmin({
        adminId: adminUser.id,
        paymentMode: paymentMode,
        cardType: 'CREDIT',
        cardBrand: cardScheme,
        settlement: settlementTypeSnapshot || null,
        amount: transactionAmount
      });

      if (adminRule) {
        adminCostAmount = ChargeService.calculateCharge(transactionAmount, adminRule).charge;
      } else {
        const DEFAULT_MDR = 2.5;
        adminCostAmount = parseFloat((transactionAmount * (DEFAULT_MDR / 100)).toFixed(2));
      }
      adminEarning = Math.max(0, parseFloat((paidUpwardToAdmin - adminCostAmount).toFixed(2)));
      logger.log(`[Worldline Webhook Worker] Admin cost to Super Admin: ${adminCostAmount}, earning: ${adminEarning}`);
    }

    // Create MerchantTransactionCharge
    const merchantTransactionCharge = await MerchantTransactionCharge.create({
      merchant_id: posOperator.id,
      pos_machine_id: posMachine.id,
      razorpay_transaction_id: txnId,
      transaction_amount: transactionAmount,
      charge_amount: chargeAmount,
      gst_amount: gstAmount,
      gst_percent: chargeRule.gst_percent || 0,
      net_amount: netAmount,
      charge_rate: chargeRule.charge_percent || 0,
      charge_config_id: chargeRule.id || null,
      payment_method: paymentMode,
      payment_card_type: 'CREDIT',
      payment_card_brand: cardScheme,
      wallet_transaction_id: null,
      rr_number: notification.rrn || eventData.rrn || null,
      mid_number: merchantId.toString(),
      tid_number: terminalId.toString(),
      customer_name: null
    });

    // Create ledger entry
    await ledgerService.createRazorpayChargeEntry({
      userId: posOperator.id,
      razorpayTransactionId: txnId,
      transactionAmount: transactionAmount,
      chargeAmount: chargeAmount,
      gstAmount: gstAmount,
      netAmount: netAmount,
      merchantTransactionChargeId: merchantTransactionCharge.id,
      description: `Worldline POS settlement for txn ${txnId} | RRN: ${notification.rrn || 'N/A'}`,
      metadata: {
        worldline_notification_id: notification.id,
        source: 'worldline',
        payment_method: paymentMode,
        card_scheme: cardScheme,
        settlement_type: settlementTypeSnapshot,
        effective_settlement: settlementTypeSnapshot,
        pos_machine_id: posMachine.id,
        mid_number: merchantId.toString(),
        tid_number: terminalId.toString(),
        merchant_id: posOperator.id
      }
    });

    // Handle franchise earning entry if present
    if (posOperator.role === 'merchant' && posOperator.franchaise_id && franchiseEarning > 0) {
      try {
        await ledgerService.createFranchiseEarningEntry({
          userId: posOperator.franchaise_id,
          razorpayTransactionId: txnId,
          amount: franchiseEarning,
          description: `Franchise earning on Worldline POS txn ${txnId} | RRN: ${notification.rrn || 'N/A'}`,
          metadata: {
            merchant_id: posOperator.id,
            transaction_amount: transactionAmount,
            charge_amount: chargeAmount,
            franchise_charge: franchiseChargeAmount
          }
        });
      } catch (earnError) {
        writeDevLog("webhook", { file: "worldlineWebhookWorker.js", error: earnError });
        logger.error(`[Worldline Webhook Worker] Franchise earning entry failed: ${earnError.message}`);
      }
    }

    // Handle super franchise earning entry if present
    if (resolvedSuperFranchiseId && superFranchiseEarning > 0) {
      try {
        await ledgerService.createSuperFranchiseEarningEntry({
          userId: resolvedSuperFranchiseId,
          razorpayTransactionId: txnId,
          amount: superFranchiseEarning,
          description: `SF earning on Worldline POS txn ${txnId} | RRN: ${notification.rrn || 'N/A'}`,
          metadata: {
            merchant_id: posOperator.id,
            franchise_id: posOperator.franchaise_id || posOperator.id,
            transaction_amount: transactionAmount,
            charge_amount: chargeAmount,
            franchise_charge: franchiseChargeAmount,
            super_franchise_charge: superFranchiseChargeAmount
          }
        });
      } catch (earnError) {
        writeDevLog("webhook", { file: "worldlineWebhookWorker.js", error: earnError });
        logger.error(`[Worldline Webhook Worker] Super franchise earning entry failed: ${earnError.message}`);
      }
    }

    // Handle admin earning entry if present
    if (adminUser && adminEarning > 0) {
      try {
        await ledgerService.createAdminEarningEntry({
          userId: adminUser.id,
          razorpayTransactionId: txnId,
          amount: adminEarning,
          description: `Admin earning on Worldline POS txn ${txnId} | RRN: ${notification.rrn || 'N/A'}`,
          metadata: {
            merchant_id: posOperator.id,
            franchise_id: posOperator.franchaise_id || null,
            super_franchise_id: resolvedSuperFranchiseId || null,
            admin_id: adminUser.id,
            transaction_amount: transactionAmount,
            charge_amount: chargeAmount,
            admin_cost: adminCostAmount,
            admin_earning: adminEarning
          }
        });
        logger.log(`[Worldline Webhook Worker] ✅ Admin earning ₹${adminEarning} credited to Admin ${adminUser.id}`);
      } catch (earnError) {
        writeDevLog("webhook", { file: "worldlineWebhookWorker.js", error: earnError });
        logger.error(`[Worldline Webhook Worker] Admin earning entry failed: ${earnError.message}`);
      }
    }

    // Create/update entry in RazorpayNotification
    await recordRazorpayNotification({
      txnId,
      notification,
      eventData,
      status: 'SUCCESS',
      isSuccess: true,
      posMachine,
      posOperator,
      settlementType: settlementTypeSnapshot,
      processingStatus: 'completed',
      processingError: null
    });

    // Mark notification completed
    await notification.update({
      user_id: posOperator.id,
      pos_machine_id: posMachine.id,
      processed: true,
      processing_status: 'completed',
      processing_error: null,
      processed_at: new Date()
    });

    logger.log(`[Worldline Webhook Worker] ✅ Successfully processed Worldline transaction ${txnId} for merchant ${posOperator.id}`);

  } catch (err) {
    writeDevLog("webhook", { file: "worldlineWebhookWorker.js", error: err });
    logger.error(`[Worldline Webhook Worker] ❌ Error processing Worldline job ${currentJobId}:`, err);
    try {
      if (notificationId || txnId) {
        const notif = await WorldlineNotification.findOne({
          where: notificationId ? { id: notificationId } : { txn_id: txnId }
        });
        if (notif) {
          await notif.update({
            status: 'failed',
            processing_status: 'needs_admin',
            processing_error: err.message || String(err)
          });
          const evData = typeof notif.event_json === 'string' ? JSON.parse(notif.event_json) : notif.event_json;
          await recordRazorpayNotification({
            txnId,
            notification: notif,
            eventData: evData,
            status: 'FAILED',
            isSuccess: false,
            processingStatus: 'needs_admin',
            processingError: err.message || String(err)
          });
        }
      }
    } catch (_) {}
    throw err;
  }
}

worldlineWebhookQueue.process(async (job) => {
  return await processWorldlineJob(job.data, job.id);
});

module.exports = {
  worldlineWebhookQueue,
  processWorldlineJob,
  recordRazorpayNotification,
  findActivePosMachine
};
