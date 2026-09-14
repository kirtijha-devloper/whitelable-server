const worldlineWebhookQueue = require("../queues/worldlineWebhookQueue");
const WorldlineNotification = require("../models/WorldlineNotification");
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

const normalizeId = (id) => {
  if (id == null) return "";
  const digits = id.toString().trim().replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "");
  return stripped === "" ? digits : stripped;
};

worldlineWebhookQueue.process(async (job) => {
  const { txnId, status, event, notificationId } = job.data;
  logger.log(`[Worldline Webhook Worker] Processing business logic for txn: ${txnId}, status: ${status}`);

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

    const isSuccessStatus = (status || '').toString().toLowerCase() === 'success' ||
                            (status || '').toString().toLowerCase() === 'approved';

    if (!isSuccessStatus) {
      logger.warn(`[Worldline Webhook Worker] Transaction ${txnId} status is '${status}'. Marking completed without wallet credit.`);
      await notification.update({
        processed: true,
        processing_status: 'completed',
        processing_error: `Transaction status is '${status}'`,
        processed_at: new Date()
      });
      return;
    }

    const merchantId = notification.mid || eventData.mid;
    const terminalId = notification.tid || eventData.tid;
    const transactionAmount = parseFloat(notification.amount || eventData.amount || 0);

    if (!merchantId || !terminalId || !transactionAmount || Number.isNaN(transactionAmount)) {
      const errMsg = `Missing mid (${merchantId}), tid (${terminalId}), or amount (${transactionAmount}) for txn: ${txnId}`;
      logger.error(`[Worldline Webhook Worker] ${errMsg}`);
      await notification.update({
        processed: false,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    // Match active POS machine by tid / mid
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

    let posMachine = null;
    for (const pm of posMachines) {
      const storedMid = normalizeId(pm.mid_number);
      const storedTid = normalizeId(pm.tid_number);
      if (storedMid === normalizedMid && storedTid === normalizedTid) {
        posMachine = pm;
        break;
      }
    }

    if (!posMachine) {
      posMachine = await PosMachine.findOne({
        where: {
          status: 'active',
          mid_number: { [Op.in]: midCandidates },
          tid_number: { [Op.in]: tidCandidates }
        }
      });
    }

    if (!posMachine) {
      const errMsg = `POS machine not found for Worldline mid=${merchantId}, tid=${terminalId}`;
      logger.warn(`[Worldline Webhook Worker] ⚠️ ${errMsg}. Marking for admin review.`);
      await notification.update({
        processed: false,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    if (!posMachine.assigned_to) {
      const errMsg = `POS machine ${posMachine.id} has no assigned merchant`;
      logger.warn(`[Worldline Webhook Worker] ⚠️ ${errMsg}. Marking for admin review.`);
      await notification.update({
        pos_machine_id: posMachine.id,
        processed: false,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    const posOperator = await User.findByPk(posMachine.assigned_to);
    if (!posOperator) {
      const errMsg = `Assigned user ID ${posMachine.assigned_to} not found for POS machine ${posMachine.id}`;
      logger.warn(`[Worldline Webhook Worker] ⚠️ ${errMsg}. Marking for admin review.`);
      await notification.update({
        pos_machine_id: posMachine.id,
        processed: false,
        processing_status: 'needs_admin',
        processing_error: errMsg,
        processed_at: new Date()
      });
      return;
    }

    // Check duplicate processing
    const existingCharge = await MerchantTransactionCharge.findOne({
      where: { razorpay_transaction_id: txnId }
    });

    if (existingCharge) {
      logger.log(`[Worldline Webhook Worker] MerchantTransactionCharge already exists for txn: ${txnId}`);
      await notification.update({
        user_id: posOperator.id,
        pos_machine_id: posMachine.id,
        processed: true,
        processing_status: 'completed',
        processed_at: new Date()
      });
      return;
    }

    const { resolveEffectiveSettlement } = require("../services/settlementService");
    const settlementResolution = await resolveEffectiveSettlement({
      user: posOperator,
      incomingTxnAmount: transactionAmount
    });
    const settlementTypeSnapshot = settlementResolution.effectiveSettlement;

    // Calculate MDR charges via ChargeService
    const paymentMode = (eventData.txn_type || 'CRDB').toUpperCase();
    const cardScheme = (notification.card_scheme || eventData.card_scheme || 'VISA').toUpperCase();

    let chargeRule = await ChargeService.getChargeRule({
      userId: posOperator.id,
      paymentMode: paymentMode,
      cardType: 'CREDIT',
      cardBrand: cardScheme,
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

    // Franchise earning calculation if applicable
    let franchiseChargeAmount = 0;
    let franchiseEarning = 0;
    if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
      const franchiseRule = await ChargeService.getAdminChargeRuleForFranchise({
        franchiseId: posOperator.franchaise_id,
        paymentMode: paymentMode,
        cardType: 'CREDIT',
        cardBrand: cardScheme,
        settlement: posOperator.settlement_type || null,
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
        logger.error(`[Worldline Webhook Worker] Franchise earning entry failed: ${earnError.message}`);
      }
    }

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
    logger.error(`[Worldline Webhook Worker] ❌ Error processing Worldline job ${job.id}:`, err);
    try {
      if (notificationId || txnId) {
        const notif = await WorldlineNotification.findOne({
          where: notificationId ? { id: notificationId } : { txn_id: txnId }
        });
        if (notif) {
          await notif.update({
            processing_status: 'needs_admin',
            processing_error: err.message || String(err)
          });
        }
      }
    } catch (_) {}
    throw err;
  }
});

module.exports = worldlineWebhookQueue;
