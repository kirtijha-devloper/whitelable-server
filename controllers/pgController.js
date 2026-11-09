const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const db = require('../config/database');
const PgTransaction = require('../models/PgTransaction');
const User = require('../models/User');
const UserServiceSetting = require('../models/UserServiceSetting');
const Ledger = require('../models/Ledger');
const ChargeService = require('../services/chargeService');
const pgService = require('../services/pgService');

/**
 * @desc    Initiate PG Order
 * @route   POST /api/pg/create-order
 * @access  Private (Authenticated users with PG service enabled)
 */
const createOrder = asyncHandler(async (req, res) => {
  const { gateway = 'pg_1', amount, return_url } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const gatewayConfig = pgService.getGatewayConfig(gateway);
  if (!gatewayConfig) {
    return res.status(400).json({ success: false, message: `Invalid gateway '${gateway}'. Must be pg_1 or pg_2.` });
  }

  // Check if service is enabled for this user
  const setting = await UserServiceSetting.findOne({
    where: { user_id: userId, service_key: gatewayConfig.key }
  });
  if (setting && setting.is_enabled === false) {
    return res.status(403).json({
      success: false,
      message: `${gatewayConfig.displayName} service is disabled for your account. Please contact your administrator.`
    });
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount < 10) {
    return res.status(400).json({ success: false, message: 'Minimum transaction amount is ₹10.00' });
  }

  // Determine return URL
  const baseUrl = process.env.APP_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const effectiveReturnUrl = return_url || `${baseUrl}/pg/payment-return`;

  // Call Gateway API
  const gatewayOrder = await pgService.createOrder({
    gateway: gatewayConfig.key,
    amount: numAmount,
    returnUrl: effectiveReturnUrl
  });

  // Save Transaction in local DB
  const txn = await PgTransaction.create({
    user_id: userId,
    company_id: req.user?.company_id || null,
    gateway: gatewayConfig.key,
    order_id: gatewayOrder.order_id,
    amount: numAmount,
    status: 'pending',
    payment_url: gatewayOrder.payment_url,
    return_url: effectiveReturnUrl,
    payment_mode: 'CARD'
  });

  res.status(200).json({
    success: true,
    message: 'Order created successfully',
    data: {
      transaction_id: txn.id,
      order_id: txn.order_id,
      gateway: txn.gateway,
      amount: txn.amount,
      payment_url: txn.payment_url,
      return_url: txn.return_url
    }
  });
});

/**
 * @desc    Handle Inbound S2S Webhook for PG 1 and PG 2
 * @route   POST /api/pg/webhook/:gateway
 * @access  Public (Authenticated via Gateway Security Headers)
 */
const handleWebhook = asyncHandler(async (req, res) => {
  const gateway = req.params.gateway || req.body.gateway || 'pg_1';
  const gatewayConfig = pgService.getGatewayConfig(gateway);

  if (!gatewayConfig) {
    return res.status(400).json({ error: `Unknown gateway route '${gateway}'` });
  }

  // 1. Verify Security Headers
  const isValid = pgService.verifyWebhookHeaders({
    gateway: gatewayConfig.key,
    headers: req.headers
  });

  if (!isValid) {
    console.warn(`[PG Webhook] Unauthorized attempt on ${gatewayConfig.key} from IP ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized webhook request' });
  }

  // 2. Parse Payload
  const { status, order_id, payment_id, amount, method, card } = req.body || {};
  if (!order_id) {
    return res.status(400).json({ error: 'Missing order_id in webhook payload' });
  }

  // 3. Find matching transaction
  const txn = await PgTransaction.findOne({ where: { order_id } });
  if (!txn) {
    console.warn(`[PG Webhook] Order ${order_id} not found in database`);
    return res.status(200).json({ status: 'ignored', message: 'Order not found' });
  }

  // 4. Idempotency Check: if already success, do not double-credit
  if (txn.status === 'success') {
    return res.status(200).json({ status: 'success', message: 'Payment already processed' });
  }

  // 5. Handle Failure / Cancellation
  if (String(status).toLowerCase() !== 'success') {
    await txn.update({
      status: 'failed',
      payment_id: payment_id || txn.payment_id,
      webhook_payload: req.body
    });
    return res.status(200).json({ status: 'success', message: 'Payment marked as failed' });
  }

  // 6. Handle Success: Calculate MDR & Credit Wallet/Ledger
  const network = String(card?.network || 'VISA').toUpperCase();
  const cardType = String(card?.card_type || 'CREDIT').toUpperCase();
  const subType = card?.sub_type || 'consumer';

  // Resolve charge rule via hierarchical engine
  const chargeRule = await ChargeService.getChargeRule({
    userId: txn.user_id,
    companyId: txn.company_id,
    paymentMode: 'CARD',
    cardType: cardType,
    cardBrand: network,
    amount: txn.amount,
    companyName: gatewayConfig.providerName
  });

  const chargeResult = ChargeService.calculateCharge(txn.amount, chargeRule);
  const feeAmount = chargeResult.charge;
  const gstAmount = chargeResult.gstAmount || 0;
  const netAmount = parseFloat((txn.amount - feeAmount - gstAmount).toFixed(2));

  // Execute database transaction to guarantee ledger and wallet consistency
  await db.transaction(async (t) => {
    const user = await User.findByPk(txn.user_id, { transaction: t });
    if (!user) throw new Error(`User id ${txn.user_id} not found`);

    const balanceBefore = parseFloat(user.wallet || 0);
    const balanceAfter = parseFloat((balanceBefore + netAmount).toFixed(2));

    // Update User Wallet
    await user.update({ wallet: balanceAfter }, { transaction: t });

    // Create Ledger Entry
    await Ledger.create({
      user_id: user.id,
      company_id: user.company_id,
      transaction_type: 'wallet_credit',
      transaction_id: order_id,
      reference_id: txn.id,
      reference_table: 'pg_transactions',
      description: `PG payment credit: ${order_id} (${gatewayConfig.displayName})`,
      balance_before: balanceBefore,
      debit: 0.00,
      credit: netAmount,
      balance: balanceAfter,
      metadata: JSON.stringify({
        gross_amount: txn.amount,
        fee_amount: feeAmount,
        gst_amount: gstAmount,
        payment_id,
        card: { network, cardType, subType }
      })
    }, { transaction: t });

    // Update Transaction
    await txn.update({
      payment_id: payment_id || txn.payment_id,
      fee_amount: feeAmount,
      gst_amount: gstAmount,
      net_amount: netAmount,
      status: 'success',
      card_network: network,
      card_type: cardType,
      card_sub_type: subType,
      webhook_payload: req.body
    }, { transaction: t });
  });

  console.log(`[PG Webhook] Order ${order_id} processed successfully. Credited ₹${netAmount} to user ${txn.user_id}`);
  return res.status(200).json({ status: 'success', message: 'Payment processed successfully' });
});

/**
 * @desc    Get PG Transactions List
 * @route   GET /api/pg/transactions
 * @access  Private
 */
const getTransactions = asyncHandler(async (req, res) => {
  const { gateway, status, page = 1, limit = 20, search } = req.query;
  const userId = req.user.id;
  const userRole = req.user.role;
  const companyId = req.user.company_id;

  const where = {};

  // Scope filtering based on role
  if (userRole === 'merchant' || userRole === 'franchise' || userRole === 'franchaise' || userRole === 'super_franchise') {
    where.user_id = userId;
  } else if (userRole === 'admin' && companyId) {
    where.company_id = companyId;
  }

  if (gateway) {
    const config = pgService.getGatewayConfig(gateway);
    if (config) where.gateway = config.key;
  }

  if (status) {
    where.status = status;
  }

  if (search) {
    where[Op.or] = [
      { order_id: { [Op.iLike]: `%${search}%` } },
      { payment_id: { [Op.iLike]: `%${search}%` } }
    ];
  }

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const { count, rows } = await PgTransaction.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: parseInt(limit, 10),
    offset
  });

  res.status(200).json({
    success: true,
    total: count,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    data: rows
  });
});

/**
 * @desc    Get Single Order Status
 * @route   GET /api/pg/order/:orderId
 * @access  Private
 */
const getOrderStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const txn = await PgTransaction.findOne({
    where: {
      [Op.or]: [
        { order_id: orderId },
        ...(isNaN(parseInt(orderId, 10)) ? [] : [{ id: parseInt(orderId, 10) }])
      ]
    }
  });

  if (!txn) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  res.status(200).json({
    success: true,
    data: txn
  });
});

module.exports = {
  createOrder,
  handleWebhook,
  getTransactions,
  getOrderStatus
};
