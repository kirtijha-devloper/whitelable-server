const razorpayWebhookQueue = require("../queues/razorpayWebhookQueue");
const RazorpayNotification = require("../models/RazorpayNotification");

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

  console.log(`[Razorpay Webhook Worker] Processing business logic for txn: ${txnId}, status: ${status}`);

  try {
    // Verify the notification exists in DB (safety check)
    const notification = await RazorpayNotification.findOne({
      where: { txn_id: txnId },
    });

    if (!notification) {
      throw new Error(`Notification not found in database for txn: ${txnId}`);
    }

    console.log(`[Razorpay Webhook Worker] Notification found in database for txn: ${txnId}`);

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
        console.log(`[Razorpay Webhook Worker] Unhandled status: ${status} for txn: ${txnId}`);
        // You can add more status handlers here as needed
    }

    console.log(`[Razorpay Webhook Worker] ✅ Successfully processed txn: ${txnId}`);
    return { success: true, txnId, status };

  } catch (error) {
    console.error(`[Razorpay Webhook Worker] ❌ Error processing txn: ${txnId}`, error);
    // Re-throw to trigger Bull's retry mechanism
    throw error;
  }
});

/**
 * Handle authorized transactions
 * Find merchant by mid/tid, calculate POS transaction charges, and add net amount to merchant wallet
 */
async function handleAuthorizedTransaction(txnId, event, notification) {
  console.log(`[Razorpay Webhook Worker] Processing authorized transaction: ${txnId}`);
  
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

    console.log(`[Razorpay Webhook Worker] Transaction details:`, {
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
      console.warn(`[Razorpay Webhook Worker] ⚠️ POS Machine not found for mid: ${merchantId}, tid: ${terminalId}. Notification stored without user link.`);
      return;
    }

    // Stamp the POS machine link on the notification immediately so the record
    // is traceable even when no user is assigned yet.
    await notification.update({ pos_machine_id: posMachine.id });

    if (!posMachine.assigned_user_id) {
      console.warn(`[Razorpay Webhook Worker] ⚠️ POS Machine (id: ${posMachine.id}) mid: ${merchantId}, tid: ${terminalId} has no assigned user. Financial processing skipped. Notification stored with pos_machine_id only.`);
      // pos_machine_id is already stamped above; user_id stays null.
      return;
    }

    // Step 2: Get merchant
    const User = require("../models/User");
    const merchant = await User.findByPk(posMachine.assigned_user_id);

    if (!merchant) {
      console.warn(`[Razorpay Webhook Worker] ⚠️ Merchant not found with id: ${posMachine.assigned_user_id} for txn: ${txnId}. Financial processing skipped.`);
      return;
    }

    // Stamp the merchant (user) link on the notification.
    await notification.update({ user_id: merchant.id });

    console.log(`[Razorpay Webhook Worker] Found merchant: ${merchant.id} (${merchant.name || merchant.email})`);

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
      where: { user_id: merchant.id, is_active: true },
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

    console.log(`[Razorpay Webhook Worker] POS charge resolved (${chargeSource}): ${chargeRate}% for merchant: ${merchant.id}, paymentMode: ${paymentMethod}`);

    // Step 4: Calculate charge and net amount
    const chargeAmount = feeInfo ? parseFloat(feeInfo.fee) : 0;
    const netAmount = transactionAmount - chargeAmount;

    console.log(`[Razorpay Webhook Worker] Transaction Amount: ${transactionAmount}, Charge: ${chargeAmount}, Net Amount: ${netAmount}`);

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
      console.log(`[Razorpay Webhook Worker] Transaction charge record already exists for txn: ${txnId}`);
      return;
    }

    const existingTransaction = await WalletTransaction.findOne({
      where: {
        reason: `Razorpay transaction: ${txnId}`
      }
    });

    if (existingTransaction) {
      console.log(`[Razorpay Webhook Worker] Transaction already processed for txn: ${txnId}`);
      return;
    }

    // Step 6: Update merchant wallet
    const currentWallet = parseFloat(merchant.wallet) || 0;
    merchant.wallet = currentWallet + netAmount;
    await merchant.save();

    console.log(`[Razorpay Webhook Worker] Updated merchant wallet: ${currentWallet} -> ${merchant.wallet}`);

    // Step 7: Create WalletTransaction record with comprehensive details
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
      requested_by: merchant.id,
      source: "razorpay",
      reference_id: parseInt(rrNumber) || null // Store RR number as reference if available
    });

    console.log(`[Razorpay Webhook Worker] ✅ Created wallet transaction for merchant: ${merchant.id}, txn: ${txnId}`);

    // Step 8: Create MerchantTransactionCharge record to track deducted amount
    const merchantTransactionCharge = await MerchantTransactionCharge.create({
      merchant_id: merchant.id,
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

    console.log(`[Razorpay Webhook Worker] ✅ Created merchant transaction charge record for merchant: ${merchant.id}, txn: ${txnId}, charge: ${chargeAmount}`);

    // Step 9: Create ledger entries for transaction tracking
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
        userId: merchant.id,
        razorpayTransactionId: txnId,
        transactionAmount: transactionAmount,
        chargeAmount: chargeAmount,
        netAmount: netAmount,
        merchantTransactionChargeId: merchantTransactionCharge.id,
        description: ledgerDescription,
        metadata: {
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

      console.log(`[Razorpay Webhook Worker] ✅ Created ledger entries for merchant: ${merchant.id}, txn: ${txnId}`);
    } catch (ledgerError) {
      console.error(`[Razorpay Webhook Worker] ⚠️ Error creating ledger entry for txn: ${txnId}`, ledgerError);
      // Don't throw - ledger is for tracking, transaction is already processed
    }

    // ── Step 10: Calculate and credit commission for the merchant ─────────────
    // Looks up UserCommission → CommissionDefault for the merchant based on
    // paymentMode / paymentCardBrand / paymentCardType and the transaction amount.
    // Falls back to the global CommissionDefault if no user-specific slab is found.
    try {
      const commissionService = require("../services/commissionService");
      const merchantCommResult = await commissionService.resolveCommission(
        merchant.id,
        {
          paymentMode: paymentMethod,
          paymentCardBrand: paymentCardBrand || null,
          paymentCardType: paymentCardType || null,
        },
        transactionAmount
      );

      if (merchantCommResult && merchantCommResult.fee && merchantCommResult.fee.charge > 0) {
        const commAmount = merchantCommResult.fee.charge;
        const rateLabel = merchantCommResult.fee.percent_fee > 0
          ? `${merchantCommResult.fee.percent_fee}%`
          : `₹${merchantCommResult.fee.flat_fee} flat`;

        console.log(`[Razorpay Webhook Worker] Merchant commission (${merchantCommResult.source}): ₹${commAmount} (${rateLabel}) for txn: ${txnId}`);

        // Create WalletTransaction for the commission credit
        await WalletTransaction.create({
          type: "commission",
          amount: commAmount,
          status: "completed",
          reason: `Commission (${rateLabel}) on Razorpay txn: ${txnId} | Txn amt: ₹${transactionAmount}${paymentMethod ? ' | ' + paymentMethod : ''}`,
          requested_by: merchant.id,
          source: "razorpay",
          reference_id: null,
        });

        // Ledger entry (also syncs merchant.wallet via ledgerService)
        await ledgerService.createCommissionEntry({
          userId: merchant.id,
          razorpayTransactionId: txnId,
          commissionAmount: commAmount,
          transactionType: "razorpay_commission",
          description: `Commission earned (${rateLabel}) | Razorpay txn: ${txnId} | Amt: ₹${transactionAmount}`,
          metadata: {
            commission_source: merchantCommResult.source,
            payment_method: paymentMethod,
            payment_card_brand: paymentCardBrand || null,
            payment_card_type: paymentCardType || null,
            transaction_amount: transactionAmount,
            commission_rate_percent: merchantCommResult.fee.percent_fee || 0,
            commission_flat_fee: merchantCommResult.fee.flat_fee || 0,
            pos_machine_id: posMachine.id,
          },
        });

        console.log(`[Razorpay Webhook Worker] ✅ Merchant commission ₹${commAmount} credited to merchant: ${merchant.id}`);
      } else {
        console.log(`[Razorpay Webhook Worker] No commission slab found for merchant: ${merchant.id}, txn: ${txnId}, paymentMode: ${paymentMethod}`);
      }
    } catch (merchantCommError) {
      console.error(`[Razorpay Webhook Worker] ⚠️ Error processing merchant commission for txn: ${txnId}`, merchantCommError);
      // Non-fatal — core transaction already processed
    }

    // ── Step 11: Calculate and credit commission for the franchisee ───────────
    // The merchant's franchaise_id points to the franchise user.
    // The franchise earns commission when their merchant processes a transaction.
    // Commission slab lookup follows the same UserCommission → CommissionDefault chain.
    if (merchant.franchaise_id) {
      try {
        const commissionService = require("../services/commissionService");
        const franchise = await User.findByPk(merchant.franchaise_id);

        if (!franchise) {
          console.warn(`[Razorpay Webhook Worker] Franchise user not found: ${merchant.franchaise_id} for txn: ${txnId}`);
        } else {
          const franchiseCommResult = await commissionService.resolveCommission(
            franchise.id,
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

            console.log(`[Razorpay Webhook Worker] Franchise commission (${franchiseCommResult.source}): ₹${franchCommAmount} (${franchRateLabel}) for franchise: ${franchise.id}, txn: ${txnId}`);

            // Create WalletTransaction for the franchise commission credit
            await WalletTransaction.create({
              type: "commission",
              amount: franchCommAmount,
              status: "completed",
              reason: `Franchise commission (${franchRateLabel}) | Merchant: ${merchant.id} | Razorpay txn: ${txnId} | Txn amt: ₹${transactionAmount}`,
              requested_by: franchise.id,
              source: "razorpay",
              reference_id: null,
            });

            // Ledger entry for franchise commission (also syncs franchise.wallet)
            await ledgerService.createCommissionEntry({
              userId: franchise.id,
              razorpayTransactionId: txnId,
              commissionAmount: franchCommAmount,
              transactionType: "razorpay_franchise_commission",
              description: `Franchise commission (${franchRateLabel}) | Merchant: ${merchant.id} | Razorpay txn: ${txnId} | Amt: ₹${transactionAmount}`,
              metadata: {
                merchant_id: merchant.id,
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

            console.log(`[Razorpay Webhook Worker] ✅ Franchise commission ₹${franchCommAmount} credited to franchise: ${franchise.id}`);
          } else {
            console.log(`[Razorpay Webhook Worker] No commission slab for franchise: ${franchise.id}, txn: ${txnId}, paymentMode: ${paymentMethod}`);
          }
        }
      } catch (franchCommError) {
        console.error(`[Razorpay Webhook Worker] ⚠️ Error processing franchise commission for txn: ${txnId}`, franchCommError);
        // Non-fatal — core transaction already processed
      }
    } else {
      console.log(`[Razorpay Webhook Worker] No franchise linked for merchant: ${merchant.id}, skipping franchise commission for txn: ${txnId}`);
    }

  } catch (error) {
    console.error(`[Razorpay Webhook Worker] Error in handleAuthorizedTransaction for txn: ${txnId}`, error);
    throw error; // Re-throw to trigger retry mechanism
  }
}

/**
 * Handle failed transactions
 */
async function handleFailedTransaction(txnId, event, notification) {
  console.log(`[Razorpay Webhook Worker] Processing failed transaction: ${txnId}`);
  
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
  console.log(`[Razorpay Webhook Worker] Processing voided transaction: ${txnId}`);
  
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
  console.log(`[Razorpay Webhook Worker] Processing captured transaction: ${txnId}`);
  
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

