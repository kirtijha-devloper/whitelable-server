const razorpayWebhookQueue = require("../queues/razorpayWebhookQueue");
const RazorpayNotification = require("../models/RazorpayNotification");
const fs = require("fs");
const path = require("path");

// ── File-based logger for diagnostics ────────────────────────────────────────
const LOG_DIR = path.join(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "razorpayWebhookWorker.log");

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
  } catch (_) { /* ignore write errors so worker never crashes on logging */ }
}

const logger = {
  log:   (...args) => { console.log(...args);   _fileLog("INFO",  args); },
  warn:  (...args) => { console.warn(...args);  _fileLog("WARN",  args); },
  error: (...args) => { console.error(...args); _fileLog("ERROR", args); },
};
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Worker to process Razorpay webhook business logic
 * This runs after the notification has been stored in the database
 * 
 * Production-ready features:
 * - Automatic retries with exponential backoff
 * - Error handling and logging
 * - Idempotency checks
 */
razorpayWebhookQueue.process(async (job) => {
  const { txnId, status, event } = job.data;

  logger.log(`[Razorpay Webhook Worker] Processing business logic for txn: ${txnId}, status: ${status}`);

  // we'll resolve the actual source after we fetch the notification record below
  let src = 'razorpay';  // default fallback

  try {
    // Verify the notification exists in DB (safety check)
    const notification = await RazorpayNotification.findOne({
      where: { txn_id: txnId },
    });

    if (!notification) {
      throw new Error(`Notification not found in database for txn: ${txnId}`);
    }

    // once we have the record we can determine which source triggered this webhook
    src = notification.source || (event && event.source) || 'razorpay';

    logger.log(`[Razorpay Webhook Worker] Notification found in database for txn: ${txnId} (source=${src})`);

    // Business logic based on transaction status
    switch (status) {
      case "AUTHORIZED":
        await handleAuthorizedTransaction(txnId, event, notification);
        break;

      case "FAILED":
        await handleFailedTransaction(txnId, event, notification);
        break;

      case "VOIDED":
        await handleVoidedTransaction(txnId, event, notification);
        break;

      case "CAPTURED":
        await handleCapturedTransaction(txnId, event, notification);
        break;

      default:
        logger.log(`[Razorpay Webhook Worker] Unhandled status: ${status} for txn: ${txnId}`);
        // You can add more status handlers here as needed
    }

    logger.log(`[Razorpay Webhook Worker] ✅ Successfully processed txn: ${txnId}`);
    return { success: true, txnId, status };

  } catch (error) {
    logger.error(`[Razorpay Webhook Worker] ❌ Error processing txn: ${txnId}`, error);
    // Re-throw to trigger Bull's retry mechanism
    throw error;
  }
});

/**
 * Handle authorized transactions
 * Find POS operator (merchant or franchise owner) by mid/tid, calculate charges, and credit via ledger
 */
async function handleAuthorizedTransaction(txnId, event, notification) {
  logger.log(`[Razorpay Webhook Worker] Processing authorized transaction: ${txnId}`);
  
  try {
    // Parse event data from notification (keep full object if needed)
    const data = typeof notification.event_json === 'string' 
      ? JSON.parse(notification.event_json) 
      : notification.event_json;
    
    // extract fields from both JSON and new columns in case of backfilled data
    const {
      // Required/Core fields (fallback to JSON when column not populated)
      amount,
      amountOriginal,
      amountAdditional,
      amountCashBack,
      paymentMode,
      status: transactionStatus,
      currencyCode,
      
      // Card payment fields
      paymentCardType,
      paymentCardBrand,
      formattedPan,
      authCode,
      acquirerCode,
      
      // Customer information (may not be available)
      customerName,
      customerEmail, // NOT available if entered after transaction approval
      payerName,
      customerReceiptUrl,
      
      // Device and terminal info
      deviceSerial,
      rrNumber,
      
      // Wallet payment fields
      walletProvider,
      walletCustomerAuthId,
      walletRefTxnId,
      
      // Cheque payment fields
      chequeNumber,
      chequeDate,
      bankCode,
      bankName,
      
      // Payment gateway
      paymentGateway,
      
      // Settlement and transaction info
      settlementStatus,
      settlement_type,
      postingDate,
      txnType,
      orderId,
      externalRefNumber,
      username,
      
      // Alternative field names (fallback)
      mid_number,
      tid_number,
      
      // Additional transaction identifiers
      stan, // System Trace Audit Number
      batchNumber,
      invoiceNumber,
      pgInvoiceNumber,
      
      // Additional reference fields
      externalRefNumber4,
      externalRefNumber5,
      externalRefNumber6,
      externalRefNumber7,
      
      // Additional payment info
      userAgreement
    } = data;
    // card classification might be supplied in JSON in future
    const classificationFromJson = data.card_classification || null;

    // derive merchant, terminal, and amount using the notification columns when available
    // fall back to JSON payload values if the column was not back‑filled yet
    const merchantId = notification.mid || mid || mid_number;
    const terminalId = notification.tid || tid || tid_number;
    // always parse to float so arithmetic (netAmount, etc.) produces a proper
    // number rather than string concatenation or unrounded floating-point values
    const transactionAmount = parseFloat(notification.amount || amount || amountOriginal);

    logger.log(`[Razorpay Webhook Worker] Transaction details:`, {
      txnId,
      merchantId,
      terminalId,
      amount: transactionAmount,
      paymentMode,
      paymentCardType,
      paymentCardBrand,
      cardClassification: classificationFromJson,
      settlementType: 'N/A',
      status: transactionStatus,
      settlementStatus,
      customerName,
      customerEmail: customerEmail || 'N/A (entered after approval)',
      walletProvider,
      paymentGateway,
      rrNumber,
      authCode,
      customerReceiptUrl
    });
    
    if (!merchantId || !terminalId || !transactionAmount) {
      throw new Error(`Missing required fields: mid/mid_number: ${merchantId}, tid/tid_number: ${terminalId}, or amount: ${transactionAmount} for txn: ${txnId}`);
    }

    // Step 1: Find POS Machine by mid and tid to get merchant
    const PosMachine = require("../models/posMachine");
    const posMachine = await PosMachine.findOne({
      where: {
        mid_number: merchantId.toString(),
        tid_number: terminalId.toString(),
        status: "active"
      }
    });

    if (!posMachine) {
      logger.warn(`[Razorpay Webhook Worker] ⚠️ POS Machine not found for mid: ${merchantId}, tid: ${terminalId}. Notification stored without user link.`);
      // mark for admin review so it can be fixed later
      await notification.update({
        processed: false,
        processing_status: 'needs_admin',
        processing_error: 'POS machine not found',
        processed_at: new Date()
      });
      return;
    }

    // Stamp the POS machine link on the notification immediately so the record
    // is traceable even when no user is assigned yet.
    await notification.update({ pos_machine_id: posMachine.id });

    // Prefer the assigned merchant; fall back to the franchise owner if no merchant is assigned.
    const operatorUserId = posMachine.assigned_user_id || posMachine.franchaise_id;
    if (!operatorUserId) {
      logger.warn(`[Razorpay Webhook Worker] ⚠️ POS Machine (id: ${posMachine.id}) mid: ${merchantId}, tid: ${terminalId} has no assigned user. Financial processing skipped. Notification stored with pos_machine_id only.`);
      await notification.update({
        processed: false,
        processing_status: 'needs_admin',
        processing_error: 'POS machine has no assigned user',
        processed_at: new Date()
      });
      return;
    }

    // Step 2: Get POS operator (merchant or franchise owner)
    const User = require("../models/User");
    const posOperator = await User.findByPk(operatorUserId);

    if (!posOperator) {
      logger.warn(`[Razorpay Webhook Worker] ⚠️ POS operator not found with id: ${posMachine.assigned_user_id} for txn: ${txnId}. Financial processing skipped.`);
      await notification.update({
        processed: false,
        processing_status: 'needs_admin',
        processing_error: 'Assigned user not found',
        processed_at: new Date()
      });
      return;
    }

    // Stamp the POS operator link on the notification
    await notification.update({ user_id: posOperator.id });

    logger.log(`[Razorpay Webhook Worker] Found POS operator: ${posOperator.id} (${posOperator.name || posOperator.email})`);
    logger.log(`[Razorpay Webhook Worker] Settlement type: ${posOperator.settlement_type || 'N/A'}`);

    // Step 3: Resolve POS charge using the new rule engine
    // The service takes all relevant parameters and returns the most specific rule.
    // Always supply the franchiseId when available so that franchise‑level defaults
    // are considered.  This is important for merchants under a franchise as well
    // as for franchise operators themselves (admin may configure franchise
    // specific rates with franchaise_id).
    const ChargeService = require("../services/chargeService");

    const paymentMethod = paymentMode ? paymentMode.toUpperCase() : null;

    // settlement_type is stored on the user record rather than in the notification
    const franchiseId = posOperator.franchaise_id || (posOperator.role === 'franchaise' ? posOperator.id : null);

    const rule = await ChargeService.getTransactionChargeRule({
      userId: posOperator.id,
      franchiseId: franchiseId,
      paymentMode: paymentMethod,
      cardType: paymentCardType || null,
      cardBrand: paymentCardBrand || null,
      classification: classificationFromJson, // currently typically null
      settlement: posOperator.settlement_type || null,
      amount: parseFloat(transactionAmount)
    });

    logger.log(`[Razorpay Webhook Worker] Charge lookup parameters: userId=${posOperator.id}, franchiseId=${franchiseId || 'none'}`);

    logger.log('[Razorpay Webhook Worker] Using card classification from JSON:', classificationFromJson);

    let chargeRate = 0;
    let chargeSource = 'fallback';
    if (rule) {
      chargeRate = parseFloat(rule.charge_percent);
      chargeSource = 'rule';
    } else {
      // no applicable rule – financial policy requires manual intervention
      logger.warn(`[Razorpay Webhook Worker] ⚠️ No charge rule matched for txn: ${txnId}`);
      await notification.update({
        processed: false,
        processing_status: 'needs_admin',
        processing_error: 'No matching charge rule',
        processed_at: new Date()
      });
      return;
    }

    const chargeResult = ChargeService.calculateCharge(parseFloat(transactionAmount), rule || { charge_percent: chargeRate, charge_flat: 0, gst_required: false, gst_percent:0 });
    const chargeAmount = chargeResult.charge;
    const gstAmount = chargeResult.gstAmount;

    logger.log(`[Razorpay Webhook Worker] POS charge resolved (${chargeSource}): ${chargeRate}% for user: ${posOperator.id}, paymentMode: ${paymentMethod}`, { chargeAmount, gstAmount });

    // If merchant belongs to a franchise we also determine the rate that the
    // franchise would pay to admin so that the franchise keeps the difference
    // between merchant charge and admin charge.
    let franchiseChargeAmount = 0;
    let franchiseEarning = 0;
    if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
      const franchiseRule = await ChargeService.getAdminChargeRuleForFranchise({
        franchiseId: posOperator.franchaise_id,
        paymentMode: paymentMethod,
        cardType: paymentCardType || null,
        cardBrand: paymentCardBrand || null,
        classification: classificationFromJson,
        settlement: posOperator.settlement_type || null,
        amount: parseFloat(transactionAmount)
      });
      if (franchiseRule) {
        franchiseChargeAmount = ChargeService.calculateCharge(parseFloat(transactionAmount), franchiseRule).charge;
      } else {
        // use default MDR if no specific franchise/admin rule
        const DEFAULT_MDR = 2.5;
        franchiseChargeAmount = parseFloat((parseFloat(transactionAmount) * (DEFAULT_MDR/100)).toFixed(2));
      }
      franchiseEarning = chargeAmount - franchiseChargeAmount;
      logger.log(`[Razorpay Webhook Worker] Franchise charge: ${franchiseChargeAmount}, earning: ${franchiseEarning}`);
    }

    // Step 4: Calculate net amount (deduct both charge and GST)
    // round to 2 decimal places, matching posChargeRuleController's calculateCharge endpoint
    const netAmount = parseFloat((transactionAmount - chargeAmount - gstAmount).toFixed(2));

    logger.log(`[Razorpay Webhook Worker] Transaction Amount: ${transactionAmount}, Charge: ${chargeAmount}, Net Amount: ${netAmount}`);

    // Step 5: Check if transaction already processed (idempotency)
    const MerchantTransactionCharge = require("../models/MerchantTransactionCharge");
    
    // Check if charge record already exists
    const existingChargeRecord = await MerchantTransactionCharge.findOne({
      where: {
        razorpay_transaction_id: txnId
      }
    });

    if (existingChargeRecord) {
      logger.log(`[Razorpay Webhook Worker] Transaction charge record already exists for txn: ${txnId}`);
      await notification.update({
        processed: true,
        processing_status: 'completed',
        processed_at: new Date()
      });
      return;
    }

    // Step 6: If merchant belongs to a franchise record, apply the franchise-level ledger entries
    if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
      const franchiseId = posOperator.franchaise_id;
      const ledgerService = require("../services/ledgerService");

      if (franchiseChargeAmount > 0) {
        // debit franchise
        const desc = `Admin charge for Razorpay txn ${txnId}`;
        await ledgerService.createLedgerEntry({
          userId: franchiseId,
          transactionType: "franchise_admin_fee",
          transactionId: txnId,
          description: desc,
          debit: franchiseChargeAmount,
          status: "completed",
          metadata: {
            merchant_id: posOperator.id,
            transaction_amount: transactionAmount,
            charge_rate: chargeRate,
            franchise_charge: franchiseChargeAmount
          }
        });
        logger.log(`[Razorpay Webhook Worker] Debited franchise ${franchiseId} ₹${franchiseChargeAmount}`);
      }

      if (chargeAmount > 0) {
        const desc2 = `Merchant charge for Razorpay txn ${txnId}`;
        await ledgerService.createLedgerEntry({
          userId: franchiseId,
          transactionType: "franchise_merchant_charge",
          transactionId: txnId,
          description: desc2,
          credit: chargeAmount,
          status: "completed",
          metadata: {
            merchant_id: posOperator.id,
            transaction_amount: transactionAmount,
            charge_rate: chargeRate
          }
        });
        logger.log(`[Razorpay Webhook Worker] Credited franchise ${franchiseId} ₹${chargeAmount}`);
      }
    }

    // Step 7: Create MerchantTransactionCharge record to track deducted amount
    const merchantTransactionCharge = await MerchantTransactionCharge.create({
      merchant_id: posOperator.id,
      pos_machine_id: posMachine.id,
      razorpay_transaction_id: txnId,
      transaction_amount: transactionAmount,   // already a parsed float
      charge_amount: chargeAmount,
      gst_amount: gstAmount,
      gst_percent: rule && rule.gst_required ? rule.gst_percent : null,
      net_amount: netAmount,
      charge_rate: chargeRate,
      charge_config_id: rule ? rule.id : null,
      payment_method: paymentMethod,
      payment_card_type: paymentCardType,
      payment_card_brand: paymentCardBrand,
      wallet_transaction_id: null,
      rr_number: rrNumber,
      mid_number: merchantId.toString(),
      tid_number: terminalId.toString(),
      customer_name: customerName
    });

    logger.log(`[Razorpay Webhook Worker] ✅ Created merchant transaction charge record for user: ${posOperator.id}, txn: ${txnId}, charge: ${chargeAmount}`);
    // mark notification fully processed
    await notification.update({
      processed: true,
      processing_status: 'completed',
      processed_at: new Date()
    });

    // Step 8: Create ledger entries for transaction tracking (ledger service syncs wallet automatically)
    const ledgerService = require("../services/ledgerService");
    try {
      const ledgerDescription = [
        `Razorpay Transaction: ${txnId}`,
        `Amount: ₹${transactionAmount}`,
        `Charge: ₹${chargeAmount} (${chargeRate}%)`,
        gstAmount ? `GST: ₹${gstAmount}` : '',
        `Net: ₹${netAmount}`,
        paymentMethod ? `Payment: ${paymentMethod}` : '',
        customerName ? `Customer: ${customerName}` : ''
      ].filter(Boolean).join(' | ');

      await ledgerService.createRazorpayChargeEntry({
        userId: posOperator.id,
        razorpayTransactionId: txnId,
        transactionAmount: transactionAmount,
        chargeAmount: chargeAmount,
        netAmount: netAmount,
        merchantTransactionChargeId: merchantTransactionCharge.id,
        description: ledgerDescription,
        metadata: {
          razorpay_notification_id: notification.id,

          pos_machine_id: posMachine.id,
          payment_method: paymentMethod,
          payment_card_type: paymentCardType,
          payment_card_brand: paymentCardBrand,
          rr_number: rrNumber,
          mid_number: merchantId.toString(),
          tid_number: terminalId.toString(),
          customer_name: customerName,
          charge_rate: chargeRate,
          gst_amount: gstAmount,
          gst_percent: rule && rule.gst_required ? rule.gst_percent : null
        }
      });

      logger.log(`[Razorpay Webhook Worker] ✅ Created ledger entries for user: ${posOperator.id}, txn: ${txnId}`);
    } catch (ledgerError) {
      logger.error(`[Razorpay Webhook Worker] ⚠️ Error creating ledger entry for txn: ${txnId}`, ledgerError);
      // Don't throw - ledger is for tracking, transaction is already processed
    }

    // Step 9: Franchise earning (replaces previous commission logic)
    if (posOperator.role === 'merchant' && posOperator.franchaise_id && typeof franchiseEarning === 'number' && franchiseEarning > 0) {
      try {
        // ledger entry for franchise earning
        await ledgerService.createFranchiseEarningEntry({
          userId: posOperator.franchaise_id,
          razorpayTransactionId: txnId,
          amount: franchiseEarning,
          transactionType: "razorpay_franchise_earning",
          description: `Franchise earning ₹${franchiseEarning} | Merchant: ${posOperator.id}`,
          metadata: {
            merchant_id: posOperator.id,
            transaction_amount: transactionAmount,
            charge_amount: chargeAmount,
            franchise_charge: franchiseChargeAmount,
          }
        });

        logger.log(`[Razorpay Webhook Worker] ✅ Franchise earning ₹${franchiseEarning} credited to user ${posOperator.franchaise_id}`);
      } catch (earnError) {
        logger.error(`[Razorpay Webhook Worker] ⚠️ Error crediting franchise earning for txn: ${txnId}`, earnError);
      }
    }

  } catch (error) {
    logger.error(`[Razorpay Webhook Worker] Error in handleAuthorizedTransaction for txn: ${txnId}`, error);
    // mark failure so admin can inspect; leave processed=false so manual action needed
    try {
      await notification.update({
        processed: false,
        processing_status: 'failed',
        processing_error: error.message || String(error),
        processed_at: new Date()
      });
    } catch (updErr) {
      logger.error('[Razorpay Webhook Worker] Failed to update notification status after error', updErr);
    }
    throw error; // Re-throw to trigger retry mechanism
  }
}

/**
 * Handle failed transactions
 */
async function handleFailedTransaction(txnId, event, notification) {
  logger.log(`[Razorpay Webhook Worker] Processing failed transaction: ${txnId}`);
  
  // TODO: Add your business logic here
  // Example:
  // - Update order status to "PAYMENT_FAILED"
  // - Send failure notification to user
  // - Log failure reason for analytics
  
  // Example implementation:
  // const Order = require("../models/Order");
  // await Order.update(
  //   { status: "PAYMENT_FAILED", failureReason: event.failureReason },
  //   { where: { orderNumber: event.orderNumber } }
  // );
}

/**
 * Handle voided transactions
 */
async function handleVoidedTransaction(txnId, event, notification) {
  logger.log(`[Razorpay Webhook Worker] Processing voided transaction: ${txnId}`);
  
  // TODO: Add your business logic here
  // Example:
  // - Reverse any wallet credits
  // - Update order status to "CANCELLED"
  // - Send cancellation notification
}

/**
 * Handle captured transactions
 */
async function handleCapturedTransaction(txnId, event, notification) {
  logger.log(`[Razorpay Webhook Worker] Processing captured transaction: ${txnId}`);
  
  // TODO: Add your business logic here
  // Example:
  // - Finalize order processing
  // - Initiate shipping
  // - Update accounting records
}

// Export for potential testing or manual triggering
module.exports = {
  handleAuthorizedTransaction,
  handleFailedTransaction,
  handleVoidedTransaction,
  handleCapturedTransaction,
};

