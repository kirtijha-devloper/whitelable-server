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
    // Parse event data from notification
    const data = typeof notification.event_json === 'string' 
      ? JSON.parse(notification.event_json) 
      : notification.event_json;
    
    // Extract all relevant fields from the event data
    // Note: Some fields like customerEmail may not be available if entered after transaction approval
    const {
      // Required/Core fields
      mid,
      tid,
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

    // Use mid/tid directly, or try mid_number/tid_number if available
    const merchantId = mid || mid_number;
    const terminalId = tid || tid_number;
    const transactionAmount = amount || amountOriginal;
    
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
        tid_number: terminalId.toString()
      }
    });

    if (!posMachine) {
      throw new Error(`POS Machine not found for mid: ${merchantId}, tid: ${terminalId}`);
    }

    if (!posMachine.assigned_user_id) {
      throw new Error(`POS Machine not assigned to any merchant for mid: ${merchantId}, tid: ${terminalId}`);
    }

    // Step 2: Get merchant
    const User = require("../models/User");
    const merchant = await User.findByPk(posMachine.assigned_user_id);

    if (!merchant) {
      throw new Error(`Merchant not found with id: ${posMachine.assigned_user_id}`);
    }

    console.log(`[Razorpay Webhook Worker] Found merchant: ${merchant.id} (${merchant.name || merchant.email})`);

    // Step 3: Find POS Transaction Charge for this merchant
    const PosTransactionCharge = require("../models/PosTransactionCharge");
    
    // Try to find specific charge matching payment method (e.g., UPI, CARD, etc.)
    // First try to find exact match for paymentMode
    const paymentMethod = paymentMode ? paymentMode.toUpperCase() : null;
    
    let chargeConfig = null;
    
    if (paymentMethod) {
      // Try exact match first (e.g., "UPI", "CARD")
      chargeConfig = await PosTransactionCharge.findOne({
        where: {
          merchant_id: merchant.id,
          method: paymentMethod.toLowerCase()
        },
        order: [['createdAt', 'DESC']]
      });
      
      // If no exact match, try with card type and network for card payments
      if (!chargeConfig && paymentMethod === 'CARD' && paymentCardType) {
        chargeConfig = await PosTransactionCharge.findOne({
          where: {
            merchant_id: merchant.id,
            card_type: paymentCardType.toLowerCase()
          },
          order: [['createdAt', 'DESC']]
        });
      }
    }
    
    // If no specific match, try to find any charge for this merchant (default)
    if (!chargeConfig) {
      chargeConfig = await PosTransactionCharge.findOne({
        where: {
          merchant_id: merchant.id
        },
        order: [['createdAt', 'DESC']]
      });
    }

    // If still no charge found, use 0% as default (no charge)
    const chargeRate = chargeConfig ? parseFloat(chargeConfig.rate_percentage) : 0;
    
    console.log(`[Razorpay Webhook Worker] Charge rate: ${chargeRate}% for merchant: ${merchant.id}, paymentMode: ${paymentMethod}`);

    // Step 4: Calculate charge and net amount
    const chargeAmount = (transactionAmount * chargeRate) / 100;
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
    await MerchantTransactionCharge.create({
      merchant_id: merchant.id,
      pos_machine_id: posMachine.id,
      razorpay_transaction_id: txnId,
      transaction_amount: transactionAmount,
      charge_amount: chargeAmount,
      net_amount: netAmount,
      charge_rate: chargeRate,
      charge_config_id: chargeConfig ? chargeConfig.id : null,
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

