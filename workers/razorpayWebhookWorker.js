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

  try {
    // Verify the notification exists in DB (safety check)
    const notification = await RazorpayNotification.findOne({
      where: { txn_id: txnId },
    });

    if (!notification) {
      throw new Error(`Notification not found in database for txn: ${txnId}`);
    }

    logger.log(`[Razorpay Webhook Worker] Notification found in database for txn: ${txnId}`);

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

    // derive merchant, terminal, and amount using the notification columns when available
    // fall back to JSON payload values if the column was not back‑filled yet
    const merchantId = notification.mid || mid || mid_number;
    const terminalId = notification.tid || tid || tid_number;
    const transactionAmount = notification.amount || amount || amountOriginal;

    logger.log(`[Razorpay Webhook Worker] Transaction details:`, {
      txnId,
      merchantId,
      terminalId,
      amount: transactionAmount,
      paymentMode,
      paymentCardType,
      paymentCardBrand,
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
      return;
    }

    // Stamp the POS machine link on the notification immediately so the record
    // is traceable even when no user is assigned yet.
    await notification.update({ pos_machine_id: posMachine.id });

    if (!posMachine.assigned_user_id) {
      logger.warn(`[Razorpay Webhook Worker] ⚠️ POS Machine (id: ${posMachine.id}) mid: ${merchantId}, tid: ${terminalId} has no assigned user. Financial processing skipped. Notification stored with pos_machine_id only.`);
      // pos_machine_id is already stamped above; user_id stays null.
      return;
    }

    // Step 2: Get POS operator (can be a merchant or franchise owner)
    // Note: This user operates the POS machine and may belong to a franchise (user.franchaise_id)
    const User = require("../models/User");
    const posOperator = await User.findByPk(posMachine.assigned_user_id);

    if (!posOperator) {
      logger.warn(`[Razorpay Webhook Worker] ⚠️ POS operator not found with id: ${posMachine.assigned_user_id} for txn: ${txnId}. Financial processing skipped.`);
      return;
    }

    // Stamp the POS operator link on the notification
    await notification.update({ user_id: posOperator.id });

    logger.log(`[Razorpay Webhook Worker] Found POS operator: ${posOperator.id} (${posOperator.name || posOperator.email})`);

    // Step 3: Resolve POS charge using the PosCharge system
    // Resolution order: user-specific (UserPosCharge) → global default (PosChargeDefault)
    // Matching by payment_mode / payment_card_type / payment_card_brand with specificity scoring
    const { Op } = require("sequelize");
    const PosChargeDefault = require("../models/PosChargeDefault");
    const UserPosCharge = require("../models/UserPosCharge");
    const PosGlobalRate = require("../models/PosGlobalRate");
    const { computeFee, pickMostSpecific } = require("../controllers/posChargeController");

    const paymentMethod = paymentMode ? paymentMode.toUpperCase() : null;
    const search = {
      paymentMode: paymentMethod,
      paymentCardType: paymentCardType || null,
      paymentCardBrand: paymentCardBrand || null,
    };

    let resolvedCharge = null;
    let chargeSource = 'none';

    // 3a: User-specific lookup
    const userLinks = await UserPosCharge.findAll({
      where: { user_id: posOperator.id, is_active: true },
      include: [{ model: PosChargeDefault, as: 'defaultPosCharge' }]
    });

    const userCandidates = userLinks.map(link => {
      const def = link.defaultPosCharge;
      if (!def) return null;
      const base = def.get ? def.get({ plain: true }) : { ...def.dataValues };
      if (link.percent_fee !== null && link.percent_fee !== undefined) base.percent_fee = link.percent_fee;
      return base;
    }).filter(Boolean);

    const bestUser = pickMostSpecific(userCandidates, search);
    if (bestUser && bestUser.is_active) {
      resolvedCharge = bestUser;
      chargeSource = 'user';
    }

    // 3b: Global default fallback (combination-based)
    if (!resolvedCharge) {
      const defaultRecords = await PosChargeDefault.findAll({
        where: {
          is_active: true,
          [Op.and]: [
            { [Op.or]: [{ payment_mode: paymentMethod || null }, { payment_mode: null }] },
            { [Op.or]: [{ payment_card_type: paymentCardType || null }, { payment_card_type: null }] },
            { [Op.or]: [{ payment_card_brand: paymentCardBrand || null }, { payment_card_brand: null }] },
          ]
        }
      });
      const bestDefault = pickMostSpecific(defaultRecords, search);
      if (bestDefault) {
        resolvedCharge = bestDefault;
        chargeSource = 'default';
      }
    }

    // 3c: Global rate fallback — used when no combination-based entry matched
    if (!resolvedCharge) {
      const globalRate = await PosGlobalRate.findOne({ where: { id: 1, is_active: true } });
      if (globalRate) {
        resolvedCharge = { percent_fee: globalRate.percent_fee, is_active: true };
        chargeSource = 'global_rate';
      }
    }

    const chargeRate = resolvedCharge ? parseFloat(resolvedCharge.percent_fee) : 0;
    const feeInfo = resolvedCharge ? computeFee(resolvedCharge, transactionAmount) : { percent_fee: 0, fee: 0 };

    logger.log(`[Razorpay Webhook Worker] POS charge resolved (${chargeSource}): ${chargeRate}% for user: ${posOperator.id}, paymentMode: ${paymentMethod}`);

    // Step 4: Calculate charge and net amount
    const chargeAmount = feeInfo ? parseFloat(feeInfo.fee) : 0;
    const netAmount = transactionAmount - chargeAmount;

    logger.log(`[Razorpay Webhook Worker] Transaction Amount: ${transactionAmount}, Charge: ${chargeAmount}, Net Amount: ${netAmount}`);

    // Step 5: Check if transaction already processed (idempotency)
    const WalletTransaction = require("../models/WalletTransaction");
    const MerchantTransactionCharge = require("../models/MerchantTransactionCharge");
    
    // Check if charge record already exists
    const existingChargeRecord = await MerchantTransactionCharge.findOne({
      where: {
        razorpay_transaction_id: txnId
      }
    });

    if (existingChargeRecord) {
      logger.log(`[Razorpay Webhook Worker] Transaction charge record already exists for txn: ${txnId}`);
      return;
    }

    const existingTransaction = await WalletTransaction.findOne({
      where: {
        reason: `Razorpay transaction: ${txnId}`
      }
    });

    if (existingTransaction) {
      logger.log(`[Razorpay Webhook Worker] Transaction already processed for txn: ${txnId}`);
      return;
    }

    // Step 6: Create WalletTransaction record with comprehensive details
    const walletReason = [
      `Razorpay transaction: ${txnId}`,
      `Amount: ${transactionAmount}`,
      `Charge: ${chargeAmount}`,
      `Net: ${netAmount}`,
      paymentMode ? `Payment: ${paymentMode}` : '',
      paymentCardBrand ? `Card: ${paymentCardBrand}` : '',
      walletProvider ? `Wallet: ${walletProvider}` : '',
      rrNumber ? `RR#: ${rrNumber}` : '',
      customerName ? `Customer: ${customerName}` : ''
    ].filter(Boolean).join(' | ');
    
    const walletTransaction = await WalletTransaction.create({
      type: "razorpay",
      amount: netAmount,
      status: "completed",
      reason: walletReason,
      requested_by: posOperator.id,
      source: "razorpay",
      reference_id: rrNumber || null // Store RR number as reference
    });

    logger.log(`[Razorpay Webhook Worker] ✅ Created wallet transaction for user: ${posOperator.id}, txn: ${txnId}`);

    // Step 7: Create MerchantTransactionCharge record to track deducted amount
    const merchantTransactionCharge = await MerchantTransactionCharge.create({
      merchant_id: posOperator.id,
      pos_machine_id: posMachine.id,
      razorpay_transaction_id: txnId,
      transaction_amount: transactionAmount,
      charge_amount: chargeAmount,
      net_amount: netAmount,
      charge_rate: chargeRate,
      charge_config_id: resolvedCharge ? resolvedCharge.id : null,
      payment_method: paymentMethod,
      payment_card_type: paymentCardType,
      payment_card_brand: paymentCardBrand,
      wallet_transaction_id: walletTransaction.id,
      rr_number: rrNumber,
      mid_number: merchantId.toString(),
      tid_number: terminalId.toString(),
      customer_name: customerName
    });

    logger.log(`[Razorpay Webhook Worker] ✅ Created merchant transaction charge record for user: ${posOperator.id}, txn: ${txnId}, charge: ${chargeAmount}`);

    // Step 8: Create ledger entries for transaction tracking (ledger service syncs wallet automatically)
    const ledgerService = require("../services/ledgerService");
    try {
      const ledgerDescription = [
        `Razorpay Transaction: ${txnId}`,
        `Amount: ₹${transactionAmount}`,
        `Charge: ₹${chargeAmount} (${chargeRate}%)`,
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
          wallet_transaction_id: walletTransaction.id,
          pos_machine_id: posMachine.id,
          payment_method: paymentMethod,
          payment_card_type: paymentCardType,
          payment_card_brand: paymentCardBrand,
          rr_number: rrNumber,
          mid_number: merchantId.toString(),
          tid_number: terminalId.toString(),
          customer_name: customerName,
          charge_rate: chargeRate
        }
      });

      logger.log(`[Razorpay Webhook Worker] ✅ Created ledger entries for user: ${posOperator.id}, txn: ${txnId}`);
    } catch (ledgerError) {
      logger.error(`[Razorpay Webhook Worker] ⚠️ Error creating ledger entry for txn: ${txnId}`, ledgerError);
      // Don't throw - ledger is for tracking, transaction is already processed
    }

    // ── Step 9: Commission ────────────────────────────────────────────────────────
    // Rule: commission is only applicable when the POS operator is a merchant AND
    // belongs to a franchise. In that case the franchise owner earns the commission.
    // - Operator role = merchant + franchaise_id set  → franchise owner gets commission
    // - Operator role = merchant + no franchaise_id   → no commission
    // - Operator role = franchise                     → no commission
    if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
      try {
        const commissionService = require("../services/commissionService");
        const franchiseOwner = await User.findByPk(posOperator.franchaise_id);

        if (!franchiseOwner) {
          logger.warn(`[Razorpay Webhook Worker] Franchise owner not found: ${posOperator.franchaise_id} for txn: ${txnId}`);
        } else {
          const franchiseCommResult = await commissionService.resolveCommission(
            franchiseOwner.id,
            {
              paymentMode: paymentMethod,
              paymentCardBrand: paymentCardBrand || null,
              paymentCardType: paymentCardType || null,
            },
            transactionAmount
          );

          if (franchiseCommResult && franchiseCommResult.fee && franchiseCommResult.fee.charge > 0) {
            const franchCommAmount = franchiseCommResult.fee.charge;
            const franchRateLabel = franchiseCommResult.fee.percent_fee > 0
              ? `${franchiseCommResult.fee.percent_fee}%`
              : `₹${franchiseCommResult.fee.flat_fee} flat`;

            logger.log(`[Razorpay Webhook Worker] Franchise commission (${franchiseCommResult.source}): ₹${franchCommAmount} (${franchRateLabel}) for franchise owner: ${franchiseOwner.id}, txn: ${txnId}`);

            // Create WalletTransaction for the franchise owner's commission credit
            await WalletTransaction.create({
              type: "commission",
              amount: franchCommAmount,
              status: "completed",
              reason: `Franchise commission (${franchRateLabel}) | Operator: ${posOperator.id} | Razorpay txn: ${txnId} | Txn amt: ₹${transactionAmount}`,
              requested_by: franchiseOwner.id,
              source: "razorpay",
              reference_id: null,
            });

            // Ledger entry for franchise owner's commission (also syncs wallet)
            await ledgerService.createCommissionEntry({
              userId: franchiseOwner.id,
              razorpayTransactionId: txnId,
              commissionAmount: franchCommAmount,
              transactionType: "razorpay_franchise_commission",
              description: `Franchise commission (${franchRateLabel}) | Operator: ${posOperator.id} | Razorpay txn: ${txnId} | Amt: ₹${transactionAmount}`,
              metadata: {
                razorpay_notification_id: notification.id,
                merchant_id: posOperator.id,
                commission_source: franchiseCommResult.source,
                payment_method: paymentMethod,
                payment_card_brand: paymentCardBrand || null,
                payment_card_type: paymentCardType || null,
                transaction_amount: transactionAmount,
                commission_rate_percent: franchiseCommResult.fee.percent_fee || 0,
                commission_flat_fee: franchiseCommResult.fee.flat_fee || 0,
                pos_machine_id: posMachine.id,
              },
            });

            logger.log(`[Razorpay Webhook Worker] ✅ Franchise commission ₹${franchCommAmount} credited to franchise owner: ${franchiseOwner.id}`);
          } else {
            logger.log(`[Razorpay Webhook Worker] No commission slab for franchise owner: ${franchiseOwner.id}, txn: ${txnId}, paymentMode: ${paymentMethod}`);
          }
        }
      } catch (franchCommError) {
        logger.error(`[Razorpay Webhook Worker] ⚠️ Error processing franchise commission for txn: ${txnId}`, franchCommError);
        // Non-fatal — core transaction already processed
      }
    } else {
      logger.log(`[Razorpay Webhook Worker] No commission applicable — operator role: ${posOperator.role}, franchaise_id: ${posOperator.franchaise_id || 'none'}, txn: ${txnId}`);
    }

  } catch (error) {
    logger.error(`[Razorpay Webhook Worker] Error in handleAuthorizedTransaction for txn: ${txnId}`, error);
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

