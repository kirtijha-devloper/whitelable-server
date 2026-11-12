const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const db = require('../config/database');
const PgTransaction = require('../models/PgTransaction');
const PgChargeRule = require('../models/PgChargeRule');
const User = require('../models/User');
const UserServiceSetting = require('../models/UserServiceSetting');
const Ledger = require('../models/Ledger');
const SettlementHold = require('../models/SettlementHold');
const ChargeService = require('../services/chargeService');
const PgChargeService = require('../services/pgChargeService');
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

  // Ensure unique order_id - never allow duplicate order_id
  const existingOrder = await PgTransaction.findOne({ where: { order_id: gatewayOrder.order_id } });
  if (existingOrder) {
    return res.status(409).json({ success: false, message: `Order ID '${gatewayOrder.order_id}' already exists.` });
  }

  // Save Transaction in local DB
  let txn;
  try {
    txn = await PgTransaction.create({
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
  } catch (createErr) {
    if (createErr.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: `Order ID '${gatewayOrder.order_id}' already exists.` });
    }
    throw createErr;
  }

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
  // 1. Parse Payload
  const {
    status,
    order_id,
    payment_id,
    amount,
    payment_amount,
    method,
    payment_mode,
    brand,
    card_brand,
    card_type,
    issuer,
    sub_type,
    card,
    gateway: payloadGateway
  } = req.body || {};

  const rawAmount = amount !== undefined && amount !== null ? amount : payment_amount;
  if (!order_id || rawAmount === undefined || rawAmount === null) {
    return res.status(400).json({ success: false, message: 'Missing order_id or amount in webhook payload' });
  }

  const parsedAmount = parseFloat(rawAmount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid transaction amount in webhook payload' });
  }

  // 2. Search in pg_transactions table with order_id and payment_amount
  const txn = await PgTransaction.findOne({ where: { order_id } });
  if (!txn) {
    console.warn(`[PG Webhook] Order '${order_id}' not found in pg_transactions table`);
    return res.status(404).json({
      success: false,
      message: `Transaction not found for order_id '${order_id}'`
    });
  }

  if (Math.abs(parseFloat(txn.amount) - parsedAmount) >= 0.01) {
    console.warn(`[PG Webhook] Amount mismatch for order '${order_id}'. Txn amount: ${txn.amount}, payload amount: ${parsedAmount}`);
    return res.status(404).json({
      success: false,
      message: `Transaction not found with matching payment_amount for order_id '${order_id}'. Expected ${txn.amount}, received ${parsedAmount}`
    });
  }

  // 3. Resolve Gateway (PG 1 - Cognate vs PG 2 - BharatGrain)
  // Priority: URL param (/webhook/:gateway) > Transaction saved gateway > Webhook headers > Payload gateway > Default pg_1
  let detectedGateway = req.params.gateway || txn.gateway || payloadGateway;
  if (!detectedGateway) {
    if (req.headers['x-bharatgrain-client-id'] || req.headers['x-pg3-client-id']) {
      detectedGateway = 'pg_2';
    } else {
      detectedGateway = 'pg_1';
    }
  }

  const gatewayConfig = pgService.getGatewayConfig(detectedGateway);
  if (!gatewayConfig) {
    return res.status(400).json({ success: false, error: `Unknown gateway route '${detectedGateway}'` });
  }

  // 4. Verify Security Headers (if gateway signature is enforced)
  const isValid = pgService.verifyWebhookHeaders({
    gateway: gatewayConfig.key,
    headers: req.headers
  });

  if (!isValid) {
    console.warn(`[PG Webhook] Unauthorized attempt on ${gatewayConfig.key} from IP ${req.ip}`);
    return res.status(401).json({ success: false, error: 'Unauthorized webhook request' });
  }

  // 5. Idempotency check: if already success, do not duplicate credit
  if (txn.status === 'success') {
    return res.status(200).json({ status: 'success', message: 'Payment already processed' });
  }

  // Handle failure / cancellation status
  if (String(status).toLowerCase() !== 'success') {
    await txn.update({
      gateway: gatewayConfig.key,
      status: 'failed',
      payment_id: payment_id || txn.payment_id,
      webhook_payload: req.body
    });
    return res.status(200).json({ status: 'success', message: 'Payment marked as failed' });
  }

  // 3. Get user_id and calculate charges from charge service functions
  const user = await User.findByPk(txn.user_id);
  if (!user) {
    return res.status(404).json({ success: false, message: `User id ${txn.user_id} not found` });
  }

  // Normalize specifications from payload or transaction record
  const normalizedMethod = String(method || payment_mode || card?.payment_mode || txn.payment_mode || 'CARD').toUpperCase();
  const normalizedBrand = String(brand || card_brand || card?.network || card?.brand || txn.card_network || 'VISA').toUpperCase();
  const normalizedCardType = String(card_type || card?.card_type || txn.card_type || 'CREDIT').toUpperCase();
  const normalizedSubType = String(sub_type || card?.sub_type || txn.card_sub_type || 'consumer').toLowerCase();
  const settlementType = user.settlement_type || 'T0';

  // Calculate merchant charge using PgChargeService (falling back to PosChargeRule if not configured)
  let chargeRule = await PgChargeService.getChargeRule({
    userId: user.id,
    userRole: user.role,
    franchiseId: user.franchaise_id || null,
    superFranchiseId: user.super_franchise_id || null,
    companyId: user.company_id || null,
    gateway: txn.gateway,
    paymentMode: normalizedMethod,
    cardType: normalizedCardType,
    cardBrand: normalizedBrand,
    classification: normalizedSubType,
    sub_type: normalizedSubType,
    settlement: settlementType,
    amount: parsedAmount
  });

  let chargeResult;
  if (chargeRule && !chargeRule.is_fallback) {
    chargeResult = PgChargeService.calculateCharge(parsedAmount, chargeRule);
  } else {
    // Check if PG has a super admin default rule first before falling back to POS
    const pgSaDefault = await PgChargeService.getSuperAdminDefaultRule({
      gateway: txn.gateway || gatewayConfig.key,
      paymentMode: normalizedMethod,
      cardType: normalizedCardType,
      cardBrand: normalizedBrand,
      classification: normalizedSubType,
      settlement: settlementType,
      amount: parsedAmount
    });

    if (pgSaDefault) {
      chargeRule = pgSaDefault;
    } else {
      const posRule = await ChargeService.getChargeRule({
        userId: user.id,
        userRole: user.role,
        franchiseId: user.franchaise_id || null,
        superFranchiseId: user.super_franchise_id || null,
        companyId: user.company_id || null,
        paymentMode: normalizedMethod,
        cardType: normalizedCardType,
        cardBrand: normalizedBrand,
        classification: normalizedSubType,
        settlement: settlementType,
        amount: parsedAmount,
        companyName: gatewayConfig.providerName
      });
      chargeRule = (posRule && !posRule.is_fallback ? posRule : null) || chargeRule || {
        charge_percent: 0,
        charge_flat: 0,
        gst_required: false,
        gst_percent: 0
      };
    }
    chargeResult = PgChargeService.calculateCharge(parsedAmount, chargeRule);
  }

  const feeAmount = parseFloat((chargeResult.charge || 0).toFixed(2));
  const gstAmount = parseFloat((chargeResult.gstAmount || 0).toFixed(2));
  const totalDeduction = parseFloat((feeAmount + gstAmount).toFixed(2));
  const netAmount = parseFloat(Math.max(0, parsedAmount - totalDeduction).toFixed(2));

  // 7. Calculate upstream commissions (Franchise, Super Franchise, Admin) following worldlineWebhookWorker.js
  let resolvedSuperFranchiseId = user.super_franchise_id || null;
  if (!resolvedSuperFranchiseId && user.franchaise_id) {
    const franchiseUserRec = await User.findByPk(user.franchaise_id);
    resolvedSuperFranchiseId = franchiseUserRec ? franchiseUserRec.super_franchise_id : null;
  }

  let adminUser = null;
  if (user.admin_id) {
    adminUser = await User.findByPk(user.admin_id);
  }
  if (!adminUser && user.company_id) {
    adminUser = await User.findOne({
      where: { role: 'admin', company_id: user.company_id }
    });
  }

  // Franchise commission calculation
  let franchiseChargeAmount = 0;
  let franchiseEarning = 0;
  let franchiseUser = null;
  if (user.role === 'merchant' && user.franchaise_id) {
    franchiseUser = await User.findByPk(user.franchaise_id);
    let franchiseRule = await PgChargeService.getAdminChargeRuleForFranchise({
      franchiseId: user.franchaise_id,
      superFranchiseId: resolvedSuperFranchiseId,
      companyId: user.company_id || null,
      adminId: adminUser ? adminUser.id : (user.admin_id || null),
      gateway: txn.gateway,
      paymentMode: normalizedMethod,
      cardType: normalizedCardType,
      cardBrand: normalizedBrand,
      classification: normalizedSubType,
      settlement: settlementType,
      amount: parsedAmount
    });

    if (!franchiseRule) {
      franchiseRule = await ChargeService.getAdminChargeRuleForFranchise({
        franchiseId: user.franchaise_id,
        superFranchiseId: resolvedSuperFranchiseId,
        companyId: user.company_id || null,
        adminId: adminUser ? adminUser.id : (user.admin_id || null),
        paymentMode: normalizedMethod,
        cardType: normalizedCardType,
        cardBrand: normalizedBrand,
        classification: normalizedSubType,
        settlement: settlementType,
        amount: parsedAmount
      });
    }

    if (franchiseRule) {
      franchiseChargeAmount = PgChargeService.calculateCharge(parsedAmount, franchiseRule).charge;
    } else {
      const saDefault = await PgChargeService.getSuperAdminDefaultRule({
        gateway: txn.gateway,
        paymentMode: normalizedMethod,
        cardType: normalizedCardType,
        cardBrand: normalizedBrand,
        classification: normalizedSubType,
        settlement: settlementType,
        amount: parsedAmount
      });
      franchiseChargeAmount = saDefault ? PgChargeService.calculateCharge(parsedAmount, saDefault).charge : 0;
    }
    franchiseEarning = Math.max(0, parseFloat((feeAmount - franchiseChargeAmount).toFixed(2)));
  }

  // Super Franchise commission calculation
  let superFranchiseChargeAmount = 0;
  let superFranchiseEarning = 0;
  let superFranchiseUser = null;
  if (resolvedSuperFranchiseId) {
    superFranchiseUser = await User.findByPk(resolvedSuperFranchiseId);
    let sfRule = await PgChargeService.getAdminChargeRuleForSuperFranchise({
      superFranchiseId: resolvedSuperFranchiseId,
      companyId: user.company_id || null,
      adminId: adminUser ? adminUser.id : (user.admin_id || null),
      gateway: txn.gateway,
      paymentMode: normalizedMethod,
      cardType: normalizedCardType,
      cardBrand: normalizedBrand,
      classification: normalizedSubType,
      settlement: settlementType,
      amount: parsedAmount
    });

    if (!sfRule) {
      sfRule = await ChargeService.getAdminChargeRuleForSuperFranchise({
        superFranchiseId: resolvedSuperFranchiseId,
        companyId: user.company_id || null,
        adminId: adminUser ? adminUser.id : (user.admin_id || null),
        paymentMode: normalizedMethod,
        cardType: normalizedCardType,
        cardBrand: normalizedBrand,
        classification: normalizedSubType,
        settlement: settlementType,
        amount: parsedAmount
      });
    }

    if (sfRule) {
      superFranchiseChargeAmount = PgChargeService.calculateCharge(parsedAmount, sfRule).charge;
    } else {
      const saDefault = await PgChargeService.getSuperAdminDefaultRule({
        gateway: txn.gateway,
        paymentMode: normalizedMethod,
        cardType: normalizedCardType,
        cardBrand: normalizedBrand,
        classification: normalizedSubType,
        settlement: settlementType,
        amount: parsedAmount
      });
      superFranchiseChargeAmount = saDefault ? PgChargeService.calculateCharge(parsedAmount, saDefault).charge : 0;
    }

    const upwardToSF = user.franchaise_id ? franchiseChargeAmount : feeAmount;
    superFranchiseEarning = Math.max(0, parseFloat((upwardToSF - superFranchiseChargeAmount).toFixed(2)));
  }

  // Admin commission calculation
  let adminCostAmount = 0;
  let adminEarning = 0;
  let paidUpwardToAdmin = feeAmount;
  if (resolvedSuperFranchiseId) {
    paidUpwardToAdmin = superFranchiseChargeAmount;
  } else if (user.franchaise_id) {
    paidUpwardToAdmin = franchiseChargeAmount;
  }

  if (adminUser) {
    let adminRule = await PgChargeService.getSuperAdminChargeRuleForAdmin({
      adminId: adminUser.id,
      gateway: txn.gateway,
      paymentMode: normalizedMethod,
      cardType: normalizedCardType,
      cardBrand: normalizedBrand,
      classification: normalizedSubType,
      settlement: settlementType,
      amount: parsedAmount
    });

    if (!adminRule) {
      adminRule = await ChargeService.getSuperAdminChargeRuleForAdmin({
        adminId: adminUser.id,
        paymentMode: normalizedMethod,
        cardType: normalizedCardType,
        cardBrand: normalizedBrand,
        classification: normalizedSubType,
        settlement: settlementType,
        amount: parsedAmount
      });
    }

    if (adminRule) {
      adminCostAmount = PgChargeService.calculateCharge(parsedAmount, adminRule).charge;
    } else {
      const saDefault = await PgChargeService.getSuperAdminDefaultRule({
        gateway: txn.gateway,
        paymentMode: normalizedMethod,
        cardType: normalizedCardType,
        cardBrand: normalizedBrand,
        classification: normalizedSubType,
        settlement: settlementType,
        amount: parsedAmount
      });
      adminCostAmount = saDefault ? PgChargeService.calculateCharge(parsedAmount, saDefault).charge : 0;
    }

    adminEarning = Math.max(0, parseFloat((paidUpwardToAdmin - adminCostAmount).toFixed(2)));
  }

  // 8. Atomic Database Transaction: all table updates performed inside the transaction block
  await db.transaction(async (t) => {
    // 1. Lock merchant user
    const lockedUser = await User.findByPk(user.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!lockedUser) throw new Error(`User id ${user.id} not found during lock`);

    const balanceBefore = parseFloat(lockedUser.wallet || 0);
    const creditBalance = parseFloat((balanceBefore + parsedAmount).toFixed(2));
    const balanceAfter = parseFloat((creditBalance - totalDeduction).toFixed(2));

    // 4. Deduct amount of commission and update ledger
    // 4a. Merchant Gross Credit Ledger Entry
    const creditEntry = await Ledger.create({
      user_id: lockedUser.id,
      company_id: lockedUser.company_id,
      transaction_type: 'pg_credit',
      transaction_id: order_id,
      reference_id: txn.id,
      reference_table: 'pg_transactions',
      description: `PG payment credit: ${order_id} (${gatewayConfig.displayName || txn.gateway})`,
      balance_before: balanceBefore,
      debit: 0.00,
      credit: parsedAmount,
      balance: creditBalance,
      metadata: JSON.stringify({
        gross_amount: parsedAmount,
        order_id,
        payment_id,
        gateway: txn.gateway,
        payment_mode: normalizedMethod,
        card: {
          brand: normalizedBrand,
          card_type: normalizedCardType,
          sub_type: normalizedSubType,
          issuer: issuer || null
        }
      })
    }, { transaction: t });

    // 4b. Merchant Fee/GST Deduction Ledger Entry
    await Ledger.create({
      user_id: lockedUser.id,
      company_id: lockedUser.company_id,
      transaction_type: 'pg_charge',
      transaction_id: order_id,
      reference_id: txn.id,
      reference_table: 'pg_transactions',
      description: `PG charge deducted: ${order_id} - Fee: ₹${feeAmount}, GST: ₹${gstAmount}`,
      balance_before: creditBalance,
      debit: totalDeduction,
      credit: 0.00,
      balance: balanceAfter,
      metadata: JSON.stringify({
        gross_amount: parsedAmount,
        fee_amount: feeAmount,
        gst_amount: gstAmount,
        total_deduction: totalDeduction,
        net_amount: netAmount,
        order_id,
        payment_id
      })
    }, { transaction: t });

    // Handle T1 Settlement Hold if applicable
    const upperSettlement = String(settlementType || '').trim().toUpperCase();
    if (upperSettlement === 'T1' || upperSettlement === 'NEXT_DAY_SETTLEMENT') {
      try {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istNow = new Date(now.getTime() + istOffset);
        const holdDate = istNow.toISOString().slice(0, 10);
        const releaseIST = new Date(holdDate + 'T10:30:00+05:30');
        releaseIST.setDate(releaseIST.getDate() + 1);

        await SettlementHold.create({
          user_id: lockedUser.id,
          company_id: lockedUser.company_id,
          ledger_id: creditEntry.id,
          amount: netAmount,
          hold_date: holdDate,
          release_at: releaseIST,
          released: false
        }, { transaction: t });
      } catch (holdErr) {
        console.error(`[PG Webhook] Settlement hold error: ${holdErr.message}`);
      }
    }

    // 4c. Upstream Franchise Earning & Ledger
    if (franchiseUser && franchiseEarning > 0) {
      const lockedFranchise = await User.findByPk(franchiseUser.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (lockedFranchise) {
        const fBalBefore = parseFloat(lockedFranchise.wallet || 0);
        const fBalAfter = parseFloat((fBalBefore + franchiseEarning).toFixed(2));

        await Ledger.create({
          user_id: lockedFranchise.id,
          company_id: lockedFranchise.company_id,
          transaction_type: 'pg_franchise_earning',
          transaction_id: order_id,
          reference_id: txn.id,
          reference_table: 'pg_transactions',
          description: `Franchise earning on PG txn ${order_id} - ₹${franchiseEarning}`,
          balance_before: fBalBefore,
          debit: 0.00,
          credit: franchiseEarning,
          balance: fBalAfter,
          metadata: JSON.stringify({
            merchant_id: lockedUser.id,
            order_id,
            payment_id,
            transaction_amount: parsedAmount,
            merchant_fee: feeAmount,
            franchise_charge: franchiseChargeAmount,
            earning: franchiseEarning
          })
        }, { transaction: t });

        await lockedFranchise.update({ wallet: fBalAfter, start_ledger: true }, { transaction: t });
      }
    }

    // 4d. Upstream Super Franchise Earning & Ledger
    if (superFranchiseUser && superFranchiseEarning > 0) {
      const lockedSf = await User.findByPk(superFranchiseUser.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (lockedSf) {
        const sfBalBefore = parseFloat(lockedSf.wallet || 0);
        const sfBalAfter = parseFloat((sfBalBefore + superFranchiseEarning).toFixed(2));

        await Ledger.create({
          user_id: lockedSf.id,
          company_id: lockedSf.company_id,
          transaction_type: 'pg_super_franchise_earning',
          transaction_id: order_id,
          reference_id: txn.id,
          reference_table: 'pg_transactions',
          description: `Super Franchise earning on PG txn ${order_id} - ₹${superFranchiseEarning}`,
          balance_before: sfBalBefore,
          debit: 0.00,
          credit: superFranchiseEarning,
          balance: sfBalAfter,
          metadata: JSON.stringify({
            merchant_id: lockedUser.id,
            order_id,
            payment_id,
            transaction_amount: parsedAmount,
            super_franchise_charge: superFranchiseChargeAmount,
            earning: superFranchiseEarning
          })
        }, { transaction: t });

        await lockedSf.update({ wallet: sfBalAfter, start_ledger: true }, { transaction: t });
      }
    }

    // 4e. Upstream Admin Earning & Ledger
    if (adminUser && adminEarning > 0) {
      const lockedAdmin = await User.findByPk(adminUser.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (lockedAdmin) {
        const aBalBefore = parseFloat(lockedAdmin.wallet || 0);
        const aBalAfter = parseFloat((aBalBefore + adminEarning).toFixed(2));

        await Ledger.create({
          user_id: lockedAdmin.id,
          company_id: lockedAdmin.company_id,
          transaction_type: 'pg_admin_earning',
          transaction_id: order_id,
          reference_id: txn.id,
          reference_table: 'pg_transactions',
          description: `Admin earning on PG txn ${order_id} - ₹${adminEarning}`,
          balance_before: aBalBefore,
          debit: 0.00,
          credit: adminEarning,
          balance: aBalAfter,
          metadata: JSON.stringify({
            merchant_id: lockedUser.id,
            order_id,
            payment_id,
            transaction_amount: parsedAmount,
            admin_cost: adminCostAmount,
            earning: adminEarning
          })
        }, { transaction: t });

        await lockedAdmin.update({ wallet: aBalAfter, start_ledger: true }, { transaction: t });
      }
    }

    // 5. Update the transaction status
    await txn.update({
      gateway: gatewayConfig.key,
      payment_id: payment_id || txn.payment_id,
      fee_amount: feeAmount,
      gst_amount: gstAmount,
      net_amount: netAmount,
      status: 'success',
      payment_mode: normalizedMethod,
      card_network: normalizedBrand,
      card_type: normalizedCardType,
      card_sub_type: normalizedSubType,
      webhook_payload: req.body
    }, { transaction: t });

    // 6. Last: Update the wallet of user with the amount from which we deduct the commission and all
    await lockedUser.update({
      wallet: balanceAfter,
      start_ledger: true
    }, { transaction: t });
  });

  console.log(`[PG Webhook] Order ${order_id} processed successfully. Gross: ₹${parsedAmount}, Deduction: ₹${totalDeduction}, Net credited: ₹${netAmount} to user ${txn.user_id}`);
  return res.status(200).json({
    status: 'success',
    message: 'Payment processed successfully',
    data: {
      order_id,
      payment_id: payment_id || txn.payment_id,
      amount: parsedAmount,
      fee_amount: feeAmount,
      gst_amount: gstAmount,
      net_amount: netAmount
    }
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// CHARGE RULE CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Get PG charge rules visible to the calling user (hierarchy-aware)
 * @route   GET /api/pg/charge-rules
 * @access  Private
 *
 * Visibility by role:
 *   super_admin    → admin_default + super_admin_admin + super_admin_default
 *   admin          → all scopes under their company (admin_default and below)
 *   super_franchise→ super_franchise_* + admin_franchise + admin_super_franchise + admin_default + super_admin_*
 *   franchise      → franchise_* + super_franchise_franchise + admin_franchise + admin_default + super_admin_*
 *   merchant       → all rules that can apply to them (read-only view)
 */
const getChargeRules = asyncHandler(async (req, res) => {
  const { id: callerId, role: callerRole, company_id: companyId,
          franchaise_id: franchiseId, super_franchise_id: superFranchiseId } = req.user;

  const PgChargeRule = db.models.PgChargeRule;
  const { Op } = require('sequelize');

  let where = { is_active: true };

  const normalizedRole = String(callerRole || '').trim().toLowerCase().replace(/[-\s]/g, '_');

  const {
    scope,
    user_id,
    franchaise_id,
    super_franchise_id,
    gateway,
    payment_mode,
    card_type,
    card_brand,
    sub_type,
    card_classification,
    settlement_type,
    page,
    limit,
    all
  } = req.query;

  let parentAdminId = req.user.admin_id || null;
  let effectiveSuperFranchiseId = superFranchiseId || null;
  if (callerId && (!parentAdminId || !effectiveSuperFranchiseId)) {
    try {
      const u = await db.models.User.findByPk(callerId, { attributes: ['id', 'super_franchise_id', 'admin_id'] });
      if (u?.super_franchise_id && !effectiveSuperFranchiseId) effectiveSuperFranchiseId = u.super_franchise_id;
      if (u?.admin_id && !parentAdminId) parentAdminId = u.admin_id;
    } catch (e) {}
  }
  if (!parentAdminId && companyId) {
    try {
      const adminUser = await db.models.User.findOne({
        where: { role: 'admin', company_id: companyId },
        attributes: ['id']
      });
      if (adminUser) parentAdminId = adminUser.id;
    } catch (e) {}
  }

  // Base scope filters by role
  if (normalizedRole === 'super_admin') {
    if (scope) {
      where.scope = scope;
      if (scope === 'super_admin_default') {
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      }
    } else {
      where.scope = { [Op.in]: ['super_admin_default', 'super_admin_admin', 'admin_default'] };
    }
  } else if (normalizedRole === 'admin') {
    if (scope) {
      where.scope = scope;
      if (scope === 'super_admin_default') {
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      } else if (scope === 'admin_default') {
        where.company_id = companyId;
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      } else if (scope === 'super_admin_admin') {
        where.user_id = callerId;
      } else if (scope === 'admin_super_franchise' || scope === 'super_franchise_default' || scope === 'super_franchise_franchise') {
        if (companyId) where.company_id = companyId;
        if (req.query.super_franchise_id) {
          where.super_franchise_id = parseInt(req.query.super_franchise_id, 10);
        }
        if (req.query.franchaise_id) {
          where.franchaise_id = parseInt(req.query.franchaise_id, 10);
        }
      } else if (scope === 'admin_franchise' || scope === 'franchise_default' || scope === 'franchise_merchant') {
        if (companyId) where.company_id = companyId;
        if (req.query.franchaise_id) {
          where.franchaise_id = parseInt(req.query.franchaise_id, 10);
        }
        if (req.query.user_id) {
          where[Op.or] = [
            { user_id: parseInt(req.query.user_id, 10) },
            { user_id: { [Op.is]: null } }
          ];
        }
      } else {
        where[Op.or] = [
          { company_id: companyId },
          { scope: { [Op.in]: ['super_admin_default', 'super_admin_admin', 'admin_default'] } }
        ];
      }
    } else {
      where[Op.or] = [
        { company_id: companyId },
        { scope: 'super_admin_default', user_id: { [Op.is]: null } },
        { scope: 'super_admin_admin', user_id: callerId }
      ];
    }
  } else if (normalizedRole === 'super_franchise') {
    if (scope) {
      where.scope = scope;
      if (scope === 'super_franchise_default') {
        where.super_franchise_id = callerId;
        where.franchaise_id = { [Op.is]: null };
        where.user_id = { [Op.is]: null };
      } else if (scope === 'super_admin_admin') {
        where.user_id = parentAdminId;
      } else if (scope === 'super_admin_default') {
        where.user_id = { [Op.is]: null };
      } else if (scope === 'admin_default') {
        if (companyId) where.company_id = companyId;
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      } else if (scope === 'admin_super_franchise') {
        if (companyId) where.company_id = companyId;
        where.super_franchise_id = callerId;
      } else if (scope === 'super_franchise_franchise') {
        where.super_franchise_id = callerId;
        if (req.query.franchaise_id) {
          where.franchaise_id = parseInt(req.query.franchaise_id, 10);
        }
      } else if (scope === 'franchise_merchant' || scope === 'franchise_default') {
        if (req.query.franchaise_id) {
          where.franchaise_id = parseInt(req.query.franchaise_id, 10);
        }
        if (req.query.user_id) {
          where[Op.or] = [
            { user_id: parseInt(req.query.user_id, 10) },
            { user_id: { [Op.is]: null } }
          ];
        }
      }
    } else {
      if (req.query.user_id) {
        where.user_id = parseInt(req.query.user_id, 10);
      } else if (req.query.super_franchise_id) {
        where.super_franchise_id = parseInt(req.query.super_franchise_id, 10);
      } else {
        where[Op.or] = [
          { super_franchise_id: callerId, scope: { [Op.in]: ['super_franchise_default', 'admin_super_franchise'] } },
          { scope: 'admin_super_franchise', ...(companyId ? { company_id: companyId } : {}) },
          { scope: 'admin_default', ...(companyId ? { company_id: companyId } : {}) },
          ...(parentAdminId ? [{ scope: 'super_admin_admin', user_id: parentAdminId }] : []),
          { scope: 'super_admin_default', user_id: { [Op.is]: null } },
        ];
      }
    }
  } else if (normalizedRole === 'franchise' || normalizedRole === 'franchaise') {
    if (scope) {
      where.scope = scope;
      if (scope === 'franchise_default') {
        where.franchaise_id = callerId;
        where.user_id = { [Op.is]: null };
      } else if (scope === 'super_admin_admin') {
        where.user_id = parentAdminId;
      } else if (scope === 'super_admin_default') {
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      } else if (scope === 'super_franchise_franchise') {
        const targetSfId = req.query.super_franchise_id || effectiveSuperFranchiseId;
        if (targetSfId) where.super_franchise_id = parseInt(targetSfId, 10);
        where.franchaise_id = callerId;
        where.user_id = { [Op.is]: null };
      } else if (scope === 'super_franchise_default' || scope === 'admin_super_franchise') {
        const targetSfId = req.query.super_franchise_id || effectiveSuperFranchiseId;
        if (targetSfId) where.super_franchise_id = parseInt(targetSfId, 10);
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
      } else if (scope === 'admin_default') {
        if (companyId) where.company_id = companyId;
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      } else if (scope === 'admin_franchise') {
        if (companyId) where.company_id = companyId;
        where.franchaise_id = callerId;
        where.user_id = { [Op.is]: null };
      } else if (scope === 'franchise_merchant') {
        where.franchaise_id = callerId;
        if (req.query.user_id) {
          where[Op.or] = [
            { user_id: parseInt(req.query.user_id, 10) },
            { user_id: { [Op.is]: null } }
          ];
        }
      }
    } else {
      if (req.query.user_id) {
        where.user_id = parseInt(req.query.user_id, 10);
      } else if (req.query.franchaise_id) {
        where.franchaise_id = parseInt(req.query.franchaise_id, 10);
      } else {
        where[Op.or] = [
          { franchaise_id: callerId, scope: { [Op.in]: ['franchise_default', 'super_franchise_franchise', 'admin_franchise'] } },
          ...(effectiveSuperFranchiseId ? [{ super_franchise_id: effectiveSuperFranchiseId, scope: { [Op.in]: ['super_franchise_franchise', 'super_franchise_default', 'admin_super_franchise'] } }] : []),
          { scope: { [Op.in]: ['admin_franchise', 'admin_default'] }, ...(companyId ? { company_id: companyId } : {}) },
          ...(parentAdminId ? [{ scope: 'super_admin_admin', user_id: parentAdminId }] : []),
          { scope: 'super_admin_default', user_id: { [Op.is]: null } }
        ];
      }
    }
  } else {
    // Merchant: Fetch all active applicable rules according to hierarchy
    if (scope) {
      where.scope = scope;
      if (scope === 'super_admin_admin') {
        where.user_id = parentAdminId;
      } else if (scope === 'super_admin_default') {
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      } else if (scope === 'admin_default') {
        if (companyId) where.company_id = companyId;
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
        where.super_franchise_id = { [Op.is]: null };
      } else if (scope === 'admin_merchant') {
        if (companyId) where.company_id = companyId;
        where.user_id = callerId;
      } else if (scope === 'admin_super_franchise') {
        const targetSfId = req.query.super_franchise_id || superFranchiseId;
        if (targetSfId) where.super_franchise_id = parseInt(targetSfId, 10);
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
      } else if (scope === 'super_franchise_default') {
        const targetSfId = req.query.super_franchise_id || superFranchiseId;
        if (targetSfId) where.super_franchise_id = parseInt(targetSfId, 10);
        where.user_id = { [Op.is]: null };
        where.franchaise_id = { [Op.is]: null };
      } else if (scope === 'super_franchise_franchise') {
        const targetSfId = req.query.super_franchise_id || superFranchiseId;
        if (targetSfId) where.super_franchise_id = parseInt(targetSfId, 10);
        const targetFId = req.query.franchaise_id || franchiseId;
        if (targetFId) where.franchaise_id = parseInt(targetFId, 10);
        where.user_id = { [Op.is]: null };
      } else if (scope === 'super_franchise_merchant') {
        const targetSfId = req.query.super_franchise_id || superFranchiseId;
        if (targetSfId) where.super_franchise_id = parseInt(targetSfId, 10);
        where.user_id = callerId;
      } else if (scope === 'franchise_default') {
        const targetFId = req.query.franchaise_id || franchiseId;
        if (targetFId) where.franchaise_id = parseInt(targetFId, 10);
        where.user_id = { [Op.is]: null };
      } else if (scope === 'franchise_merchant') {
        const targetFId = req.query.franchaise_id || franchiseId;
        if (targetFId) where.franchaise_id = parseInt(targetFId, 10);
        where[Op.or] = [
          { user_id: callerId },
          { user_id: { [Op.is]: null } }
        ];
      }
    } else {
      if (req.query.user_id) {
        where.user_id = parseInt(req.query.user_id, 10);
      } else {
        where[Op.or] = [
          { user_id: callerId },
          ...(franchiseId ? [{ franchaise_id: franchiseId, scope: { [Op.in]: ['franchise_merchant', 'franchise_default'] } }] : []),
          ...(superFranchiseId && franchiseId ? [{ super_franchise_id: superFranchiseId, franchaise_id: franchiseId, scope: 'super_franchise_franchise' }] : []),
          ...(superFranchiseId ? [{ super_franchise_id: superFranchiseId, franchaise_id: { [Op.is]: null }, scope: { [Op.in]: ['super_franchise_merchant', 'super_franchise_default', 'admin_super_franchise'] } }] : []),
          ...(companyId ? [{ company_id: companyId, scope: { [Op.in]: ['admin_merchant', 'admin_default'] } }] : [{ scope: { [Op.in]: ['admin_merchant', 'admin_default'] } }]),
          ...(parentAdminId ? [{ scope: 'super_admin_admin', user_id: parentAdminId }] : []),
          { scope: 'super_admin_default', user_id: { [Op.is]: null } }
        ];
      }
    }
  }

  // Parameter-level overrides
  const GLOBAL_DEFAULT_SCOPES = [
    'super_admin_default',
    'super_admin_admin',
    'admin_default',
    'admin_super_franchise',
    'super_franchise_default',
    'franchise_default'
  ];
  if (user_id && !where[Op.or] && !GLOBAL_DEFAULT_SCOPES.includes(scope)) {
    where.user_id = parseInt(user_id, 10);
  }
  if (franchaise_id && !['super_admin_default', 'admin_default', 'admin_super_franchise'].includes(scope) && !where[Op.or]) {
    where.franchaise_id = parseInt(franchaise_id, 10);
  }
  if (super_franchise_id && !['super_admin_default', 'admin_default'].includes(scope) && !where[Op.or]) {
    where.super_franchise_id = parseInt(super_franchise_id, 10);
  }
  if (gateway && gateway !== 'ALL') where.gateway = gateway;
  if (payment_mode && payment_mode !== 'ALL') where.payment_mode = payment_mode;
  if (card_type && card_type !== 'ALL') where.card_type = card_type;
  if (card_brand && card_brand !== 'ALL') where.card_brand = card_brand;
  if (sub_type && sub_type !== 'ALL' && sub_type !== 'any') where.sub_type = sub_type;
  if (card_classification && card_classification !== 'ANY') where.card_classification = card_classification;
  if (settlement_type && settlement_type !== 'all') where.settlement_type = settlement_type;

  const queryOptions = {
    where,
    order: [['createdAt', 'DESC']]
  };

  let count = 0, rows = [], rules = [];
  try {
    if (limit) {
      const pageNum = parseInt(page || '1', 10);
      const limitNum = parseInt(limit, 10);
      queryOptions.limit = limitNum;
      queryOptions.offset = (pageNum - 1) * limitNum;
      const resData = await PgChargeRule.findAndCountAll(queryOptions);
      return res.status(200).json({
        success: true,
        data: resData.rows,
        total: resData.count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(resData.count / limitNum)
      });
    }
    rules = await PgChargeRule.findAll(queryOptions);
  } catch (dbErr) {
    if (dbErr.message && dbErr.message.includes('pg_charge_rules') && dbErr.message.includes('does not exist')) {
      await PgChargeRule.sync();
      if (limit) {
        const pageNum = parseInt(page || '1', 10);
        const limitNum = parseInt(limit, 10);
        queryOptions.limit = limitNum;
        queryOptions.offset = (pageNum - 1) * limitNum;
        const resData = await PgChargeRule.findAndCountAll(queryOptions);
        return res.status(200).json({
          success: true,
          data: resData.rows,
          total: resData.count,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(resData.count / limitNum)
        });
      }
      rules = await PgChargeRule.findAll(queryOptions);
    } else {
      throw dbErr;
    }
  }

  // Collapse applicable rules by specificity priority when querying effective rules without a specific scope
  const isMerchantViewer = (normalizedRole === 'merchant' || normalizedRole === 'retailer' || normalizedRole === 'user');
  const shouldCollapseByPriority = !scope && !req.query.user_id && !req.query.franchaise_id && !req.query.super_franchise_id;
  if ((isMerchantViewer || shouldCollapseByPriority) && !scope) {
    let priorityMap = {};
    if (isMerchantViewer) {
      priorityMap = {
        merchant: 120,
        franchise_merchant: 110,
        franchise_default: 100,
        super_franchise_merchant: 90,
        super_franchise_franchise: 80,
        super_franchise_default: 70,
        admin_merchant: 60,
        admin_franchise: 50,
        admin_super_franchise: 40,
        admin_default: 30,
        super_admin_admin: 20,
        super_admin_default: 10
      };
    } else if (normalizedRole === 'franchise' || normalizedRole === 'franchaise') {
      priorityMap = {
        franchise_default: 80,
        super_franchise_franchise: 70,
        super_franchise_default: 60,
        admin_franchise: 50,
        admin_super_franchise: 40,
        admin_default: 30,
        super_admin_admin: 20,
        super_admin_default: 10
      };
    } else if (normalizedRole === 'super_franchise') {
      priorityMap = {
        super_franchise_default: 50,
        admin_super_franchise: 40,
        admin_default: 30,
        super_admin_admin: 20,
        super_admin_default: 10
      };
    } else if (normalizedRole === 'admin') {
      priorityMap = {
        admin_default: 30,
        super_admin_admin: 20,
        super_admin_default: 10
      };
    } else {
      priorityMap = {
        super_admin_admin: 20,
        super_admin_default: 10
      };
    }

    const map = new Map();
    const sorted = [...rules].sort((a, b) => {
      const pA = (a.user_id && a.user_id === callerId && isMerchantViewer) ? 200 : (priorityMap[a.scope] || 0);
      const pB = (b.user_id && b.user_id === callerId && isMerchantViewer) ? 200 : (priorityMap[b.scope] || 0);
      return pA - pB;
    });

    const canonicalGenericVal = (val) => {
      if (!val) return 'ALL';
      const s = String(val).trim().toUpperCase();
      if (['ALL', 'ANY', 'N/A', 'NA', 'UNKNOWN', 'NULL', ''].includes(s)) return 'ALL';
      return s;
    };

    const canonicalSettlementVal = (val) => {
      if (!val) return 'ANY';
      const s = String(val).trim().toUpperCase();
      if (['ALL', 'ANY', 'N/A', 'NA', 'UNKNOWN', 'NULL', ''].includes(s)) return 'ANY';
      return s;
    };

    for (const rule of sorted) {
      const mode = canonicalGenericVal(rule.payment_mode);
      const cType = canonicalGenericVal(rule.card_type);
      const brand = canonicalGenericVal(rule.card_brand);
      const subType = canonicalGenericVal(rule.card_classification || rule.sub_type);
      const st = canonicalSettlementVal(rule.settlement_type);
      const min = parseFloat(rule.min_amount || 0);
      const max = rule.max_amount !== null && rule.max_amount !== undefined ? parseFloat(rule.max_amount) : 'INF';
      const key = `${mode}_${cType}_${brand}_${subType}_${st}_${min}_${max}`;
      map.set(key, rule);
    }
    rules = Array.from(map.values());

    // Fallback: If no dedicated active PG charge rules exist, return active POS charge rules
    if (rules.length === 0) {
      try {
        const PosChargeRule = require('../models/PosChargeRule');
        const posRules = await PosChargeRule.findAll({
          where: {
            is_active: true,
            [Op.or]: [
              { user_id: callerId },
              ...(franchiseId ? [{ franchaise_id: franchiseId }] : []),
              ...(superFranchiseId ? [{ super_franchise_id: superFranchiseId }] : []),
              ...(companyId ? [{ company_id: companyId }] : []),
              { scope: 'super_admin_default' }
            ]
          },
          order: [['min_amount', 'ASC'], ['id', 'DESC']]
        });
        if (posRules && posRules.length > 0) {
          rules = posRules;
        }
      } catch (posErr) {
        // ignore fallback error
      }
    }
  }

  return res.status(200).json({ success: true, data: rules });
});

/**
 * @desc    Get single PG charge rule by ID
 * @route   GET /api/pg/charge-rules/:id
 * @access  Private
 */
const getChargeRuleById = asyncHandler(async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  const PgChargeRule = db.models.PgChargeRule;
  const rule = await PgChargeRule.findByPk(ruleId);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Charge rule not found' });
  }
  return res.status(200).json({ success: true, data: rule });
});

/**
 * @desc    Create a new PG charge rule
 * @route   POST /api/pg/charge-rules
 * @access  Private
 *
 * Scope is auto-derived from caller role + target ids.
 * Each role can only create rules at their own level or below.
 */
const createChargeRule = asyncHandler(async (req, res) => {
  const { id: callerId, role: callerRole, company_id: companyId } = req.user;
  const normalizedRole = String(callerRole || '').trim().toLowerCase().replace(/[-\s]/g, '_');

  let targetUserId = req.body.target_user_id ?? req.body.user_id ?? null;
  let targetFranchiseId = req.body.target_franchise_id ?? req.body.franchaise_id ?? req.body.franchiseId ?? null;
  let targetSuperFranchiseId = req.body.target_super_franchise_id ?? req.body.super_franchise_id ?? req.body.superFranchiseId ?? null;
  const targetRole = req.body.target_role ?? req.body.role ?? null;

  // Derive ownership: if caller is super_franchise, any rule they create belongs to their super_franchise_id
  if (normalizedRole === 'super_franchise') {
    targetSuperFranchiseId = callerId;
  }
  // If caller is franchise, any rule they create belongs to their franchise_id
  if (normalizedRole === 'franchise' || normalizedRole === 'franchaise') {
    targetFranchiseId = callerId;
  }
  const gateway = req.body.gateway || 'ALL';
  const paymentMode = req.body.payment_mode || req.body.method || 'ALL';
  const cardType = req.body.card_type || req.body.cardType || null;
  const cardBrand = req.body.card_brand || req.body.network || null;
  const subType = req.body.sub_type || req.body.subType || req.body.classification_sub_type || req.body.card_classification || req.body.cardClassification || 'any';
  const cardClassification = req.body.card_classification || req.body.cardClassification || subType || null;
  const settlementType = req.body.settlement_type || req.body.settlementType || null;
  const channel = req.body.channel || 'WEB';
  const minAmount = req.body.min_amount != null ? parseFloat(req.body.min_amount) : (req.body.minAmount != null ? parseFloat(req.body.minAmount) : 0);
  const maxAmount = req.body.max_amount != null ? parseFloat(req.body.max_amount) : (req.body.maxAmount != null ? parseFloat(req.body.maxAmount) : null);
  let chargePercent = req.body.charge_percent != null ? parseFloat(req.body.charge_percent) : (req.body.chargePercent != null ? parseFloat(req.body.chargePercent) : (req.body.base_rate != null ? parseFloat(req.body.base_rate) : 0));
  let chargeFlat = req.body.charge_flat != null ? parseFloat(req.body.charge_flat) : (req.body.chargeFlat != null ? parseFloat(req.body.chargeFlat) : 0);
  let gstRequired = req.body.gst_required != null ? Boolean(req.body.gst_required) : Boolean(req.body.gstRequired);
  let gstPercent = req.body.gst_percent != null ? parseFloat(req.body.gst_percent) : (req.body.gstPercent != null ? parseFloat(req.body.gstPercent) : (req.body.gst_rate != null ? parseFloat(req.body.gst_rate) : 0));
  const companyName = req.body.company_name || req.body.companyName || null;

  if (isNaN(chargePercent) && isNaN(chargeFlat)) {
    return res.status(400).json({ success: false, message: 'charge_percent or charge_flat is required' });
  }

  // Normalized tokens for consistent DB storage & matching
  const normGateway = String(gateway || 'ALL').trim().toUpperCase();
  const normPaymentMode = String(paymentMode || 'ALL').trim().toUpperCase();
  const rawTypeStr = cardType ? String(cardType).trim().toUpperCase().replace(/[\s_-]/g, '').replace('CARD', '') : null;
  const normCardType = (!rawTypeStr || rawTypeStr === 'ALL' || rawTypeStr === 'UNKNOWN') ? null : rawTypeStr;
  const rawBrandNorm = cardBrand ? PgChargeService.normalizeCardBrand(cardBrand) : null;
  const cleanCardBrand = (!rawBrandNorm || rawBrandNorm === 'ALL') ? null : rawBrandNorm;

  // Derive scope from caller's role + provided target ids
  let scope = req.body.scope;
  if (!scope) {
    scope = PgChargeService.deriveScope(
      callerRole,
      targetUserId,
      targetFranchiseId,
      targetSuperFranchiseId,
      targetRole
    );
  } else {
    // Sanitize scope against target entities to prevent mis-tagging
    if (normalizedRole === 'super_admin' && targetUserId && scope === 'super_admin_default') {
      scope = 'super_admin_admin';
    } else if (normalizedRole === 'admin' && targetFranchiseId && scope === 'admin_default') {
      scope = 'admin_franchise';
    } else if (normalizedRole === 'admin' && targetUserId && scope === 'admin_default') {
      scope = 'admin_merchant';
    }
  }

  // Role-based scope guard: each role can only create scopes they own
  const allowedScopesByRole = {
    super_admin:    ['super_admin_default', 'super_admin_admin', 'admin_default'],
    admin:          ['admin_default', 'admin_franchise', 'admin_merchant', 'admin_super_franchise'],
    super_franchise:['super_franchise_default', 'super_franchise_franchise', 'super_franchise_merchant'],
    franchise:      ['franchise_default', 'franchise_merchant'],
    franchaise:     ['franchise_default', 'franchise_merchant']
  };
  const allowed = allowedScopesByRole[normalizedRole] || [];
  if (!allowed.includes(scope) && normalizedRole !== 'super_admin') {
    return res.status(403).json({ success: false, message: `Your role cannot create a '${scope}' rule` });
  }

  const isCallerAdmin = normalizedRole === 'super_admin' || normalizedRole === 'admin';
  const isSuperFranchise = normalizedRole === 'super_franchise';
  const isFranchise = normalizedRole === 'franchise' || normalizedRole === 'franchaise';
  const PgChargeRule = db.models.PgChargeRule;

  if (!isCallerAdmin) {
    const downlineScopes = [
      'super_franchise_default', 'super_franchise_franchise', 'super_franchise_merchant',
      'franchise_default', 'franchise_merchant'
    ];
    if (!downlineScopes.includes(scope)) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin and Super Admin can create base rate rules. Super Franchise and Franchise can only set rates for their downline.'
      });
    }

    // Verify that an upline rule with these payment specifications exists
    let uplineScopes = [];
    if (isSuperFranchise) {
      uplineScopes = ['admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
    } else if (isFranchise) {
      uplineScopes = ['super_franchise_franchise', 'super_franchise_default', 'admin_franchise', 'admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
    } else {
      uplineScopes = ['admin_default', 'super_admin_admin', 'super_admin_default'];
    }

    const scopePriorityOrder = [
      [db.literal(`CASE scope
        WHEN 'super_franchise_franchise' THEN 900000
        WHEN 'super_franchise_default'   THEN 800000
        WHEN 'admin_franchise'           THEN 600000
        WHEN 'admin_super_franchise'     THEN 500000
        WHEN 'super_admin_admin'         THEN 450000
        WHEN 'admin_default'             THEN 400000
        WHEN 'super_admin_default'       THEN 200000
        ELSE 0
      END`), 'DESC'],
      ['id', 'DESC']
    ];

    // 1. Strict exact match
    const uplineWhere = {
      scope: { [Op.in]: uplineScopes },
      payment_mode: normPaymentMode,
      min_amount: minAmount || 0,
      is_active: true
    };
    if (maxAmount !== null && maxAmount !== undefined && maxAmount !== '' && !isNaN(parseFloat(maxAmount))) {
      uplineWhere.max_amount = parseFloat(maxAmount);
    } else {
      uplineWhere.max_amount = null;
    }
    if (cleanCardBrand) uplineWhere.card_brand = cleanCardBrand;
    if (normCardType) uplineWhere.card_type = normCardType;
    if (settlementType) uplineWhere.settlement_type = settlementType;

    if (isSuperFranchise) {
      uplineWhere[Op.or] = [
        { super_franchise_id: callerId },
        { super_franchise_id: null }
      ];
    } else if (isFranchise) {
      uplineWhere[Op.or] = [
        { franchaise_id: callerId },
        { franchaise_id: null }
      ];
    }

    let uplineRule = await PgChargeRule.findOne({ where: uplineWhere, order: scopePriorityOrder });

    // 2. Wildcard fallback: Brand or Type fallback to 'ALL' / NULL
    if (!uplineRule) {
      const wildcardWhere = {
        scope: uplineWhere.scope,
        payment_mode: normPaymentMode,
        min_amount: uplineWhere.min_amount,
        max_amount: uplineWhere.max_amount,
        is_active: true
      };
      if (isSuperFranchise) {
        wildcardWhere[Op.or] = [
          { super_franchise_id: callerId },
          { super_franchise_id: null }
        ];
      } else if (isFranchise) {
        wildcardWhere[Op.or] = [
          { franchaise_id: callerId },
          { franchaise_id: null }
        ];
      }
      if (cleanCardBrand) wildcardWhere.card_brand = { [Op.in]: [cleanCardBrand, 'ALL', null] };
      if (normCardType) wildcardWhere.card_type = { [Op.in]: [normCardType, 'ALL', null] };
      if (settlementType) wildcardWhere.settlement_type = { [Op.in]: [settlementType, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: wildcardWhere, order: scopePriorityOrder });
    }

    // 3. Open slab fallback: slab min/max fallback
    if (!uplineRule) {
      const slabFallbackWhere = {
        scope: uplineWhere.scope,
        payment_mode: normPaymentMode,
        is_active: true
      };
      if (isSuperFranchise) {
        slabFallbackWhere[Op.or] = [
          { super_franchise_id: callerId },
          { super_franchise_id: null }
        ];
      } else if (isFranchise) {
        slabFallbackWhere[Op.or] = [
          { franchaise_id: callerId },
          { franchaise_id: null }
        ];
      }
      if (cleanCardBrand) slabFallbackWhere.card_brand = { [Op.in]: [cleanCardBrand, 'ALL', null] };
      if (normCardType) slabFallbackWhere.card_type = { [Op.in]: [normCardType, 'ALL', null] };
      if (settlementType) slabFallbackWhere.settlement_type = { [Op.in]: [settlementType, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: slabFallbackWhere, order: scopePriorityOrder });
    }

    if (!uplineRule) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create rate: payment mode, network, card type, settlement type, and slab amounts must first be defined by Admin or Super Admin.'
      });
    }

    const uplineFlat = parseFloat(uplineRule.charge_flat || 0);
    const uplinePercent = parseFloat(uplineRule.charge_percent || 0);

    // Downline inherits GST setting from upline rule
    gstRequired = Boolean(uplineRule.gst_required);
    gstPercent = parseFloat(uplineRule.gst_percent || 0);

    // If upline limit is flat, downline cannot convert to percentage
    if (uplineFlat > 0 && uplinePercent <= 0) {
      if (chargePercent > 0 && chargeFlat <= 0) {
        return res.status(400).json({
          success: false,
          message: 'The base rate for this specification is Flat Rate and cannot be converted to percentage.'
        });
      }
      if (chargeFlat < uplineFlat) {
        return res.status(400).json({
          success: false,
          message: `Flat charge (₹${chargeFlat}) cannot be less than the previously set flat rate of ₹${uplineFlat}.`
        });
      }
    } else if (uplinePercent > 0 && chargeFlat <= 0) {
      if (chargeFlat > 0 && chargePercent <= 0) {
        return res.status(400).json({
          success: false,
          message: 'The base rate for this specification is Percentage and cannot be converted to Flat Rate.'
        });
      }
      if (chargePercent < uplinePercent) {
        return res.status(400).json({
          success: false,
          message: `Rate (${chargePercent}%) cannot be less than the previously set rate of ${uplinePercent}%.`
        });
      }
    }
  }
  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId && targetUserId) {
    const targetUser = await db.models.User.findByPk(targetUserId, { attributes: ['id', 'company_id'] });
    if (targetUser?.company_id) {
      resolvedCompanyId = targetUser.company_id;
    }
  }

  // ── Duplicate & Overlap Check Guard ────────────────────────────────────────
  // Rejects duplicate if active rule exists with same company, method, network, card type,
  // classification sub type, settlement and overlapping amount slab
  const duplicateWhere = {
    scope,
    gateway: normGateway || 'ALL',
    payment_mode: normPaymentMode || 'ALL',
    card_type: normCardType || null,
    card_brand: cleanCardBrand || null,
    card_classification: cardClassification || null,
    settlement_type: settlementType || null,
    is_active: true
  };

  if (targetUserId) {
    duplicateWhere.user_id = parseInt(targetUserId, 10);
  } else if (['super_admin_default', 'admin_default', 'super_franchise_default', 'franchise_default'].includes(scope)) {
    duplicateWhere.user_id = null;
  }

  if (targetFranchiseId) {
    duplicateWhere.franchaise_id = parseInt(targetFranchiseId, 10);
  } else if (['super_admin_default', 'admin_default', 'super_franchise_default'].includes(scope)) {
    duplicateWhere.franchaise_id = null;
  }

  if (targetSuperFranchiseId) {
    duplicateWhere.super_franchise_id = parseInt(targetSuperFranchiseId, 10);
  } else if (['super_admin_default', 'admin_default'].includes(scope)) {
    duplicateWhere.super_franchise_id = null;
  }

  if (normalizedRole !== 'super_admin' && resolvedCompanyId) {
    duplicateWhere.company_id = resolvedCompanyId;
  } else if (scope === 'super_admin_default') {
    duplicateWhere.company_id = null;
  } else if (resolvedCompanyId) {
    duplicateWhere.company_id = resolvedCompanyId;
  }

  let existingRules;
  try {
    existingRules = await PgChargeRule.findAll({ where: duplicateWhere });
  } catch (findErr) {
    if (findErr.message && findErr.message.includes('pg_charge_rules') && findErr.message.includes('does not exist')) {
      await PgChargeRule.sync();
      existingRules = await PgChargeRule.findAll({ where: duplicateWhere });
    } else {
      throw findErr;
    }
  }
  const newMin = parseFloat(minAmount || 0);
  const newMax = maxAmount !== null && maxAmount !== undefined && maxAmount !== '' && !isNaN(parseFloat(maxAmount))
    ? parseFloat(maxAmount)
    : null;

  const m1 = newMin;
  const m2 = newMax !== null ? newMax : Infinity;

  // Exact-slab UPSERT: If rule already exists for exact slab and specifications, update it seamlessly
  const exactRule = existingRules.find((rule) => {
    if (rule.is_active === false) return false;
    const rMin = rule.min_amount != null ? parseFloat(rule.min_amount) : 0;
    const rMax = rule.max_amount != null && !isNaN(parseFloat(rule.max_amount)) ? parseFloat(rule.max_amount) : null;
    return rMin === newMin && rMax === newMax;
  });

  if (exactRule) {
    await exactRule.update({
      charge_percent: chargePercent != null ? parseFloat(chargePercent) : 0,
      charge_flat: chargeFlat != null ? parseFloat(chargeFlat) : 0,
      gst_required: Boolean(gstRequired),
      gst_percent: gstPercent != null ? parseFloat(gstPercent) : 0,
      is_active: true
    });
    return res.status(200).json({ success: true, message: 'PG Charge Rule updated', data: exactRule });
  }

  const duplicateOverlap = existingRules.find((rule) => {
    if (rule.is_active === false) return false;
    const rMin = rule.min_amount != null ? parseFloat(rule.min_amount) : 0;
    const rMax = rule.max_amount != null && !isNaN(parseFloat(rule.max_amount)) ? parseFloat(rule.max_amount) : null;
    const s1 = rMin;
    const s2 = rMax !== null ? rMax : Infinity;

    return m1 <= s2 && m2 >= s1;
  });

  if (duplicateOverlap) {
    const existingRange = `${duplicateOverlap.min_amount != null ? duplicateOverlap.min_amount : 0} - ${duplicateOverlap.max_amount != null ? duplicateOverlap.max_amount : 'Open'}`;
    return res.status(400).json({
      success: false,
      message: `A duplicate PG charge rule with matching specifications and overlapping amount slab (${existingRange}) already exists.`
    });
  }

  let rule;
  const ruleData = {
    user_id:            targetUserId ? parseInt(targetUserId, 10) : null,
    company_id:         resolvedCompanyId,
    franchaise_id:      targetFranchiseId ? parseInt(targetFranchiseId, 10) : null,
    super_franchise_id: targetSuperFranchiseId ? parseInt(targetSuperFranchiseId, 10) : null,
    created_by:         callerId,
    scope,
    gateway:            normGateway || 'ALL',
    payment_mode:       normPaymentMode || 'ALL',
    card_type:          normCardType || null,
    card_brand:         cleanCardBrand || null,
    card_classification:cardClassification || null,
    sub_type:           subType || cardClassification || 'any',
    settlement_type:    settlementType || null,
    channel:            channel || 'WEB',
    min_amount:         minAmount,
    max_amount:         maxAmount,
    charge_percent:     chargePercent,
    charge_flat:        chargeFlat,
    gst_required:       gstRequired,
    gst_percent:        gstPercent,
    is_active:          true
  };
  try {
    rule = await PgChargeRule.create(ruleData);
  } catch (createErr) {
    if (createErr.message && createErr.message.includes('pg_charge_rules') && createErr.message.includes('does not exist')) {
      await PgChargeRule.sync();
      rule = await PgChargeRule.create(ruleData);
    } else {
      throw createErr;
    }
  }

  return res.status(201).json({ success: true, message: 'Charge rule created', data: rule });
});

/**
 * @desc    Update a PG charge rule
 * @route   PUT /api/pg/charge-rules/:id
 * @access  Private
 */
const updateChargeRule = asyncHandler(async (req, res) => {
  const { id: callerId, role: callerRole, company_id: companyId } = req.user;
  const ruleId = parseInt(req.params.id, 10);
  const normalizedRole = String(callerRole || '').trim().toLowerCase().replace(/[-\s]/g, '_');

  const PgChargeRule = db.models.PgChargeRule;

  const where = { id: ruleId };
  if (normalizedRole !== 'super_admin' && companyId) {
    where.company_id = companyId;
  }

  const rule = await PgChargeRule.findOne({ where });

  if (!rule) {
    return res.status(404).json({ success: false, message: 'Charge rule not found' });
  }

  const isSuperFranchise = normalizedRole === 'super_franchise';
  const isFranchise = normalizedRole === 'franchise' || normalizedRole === 'franchaise';
  const isCallerAdmin = normalizedRole === 'super_admin' || normalizedRole === 'admin';

  const isAuthorized = (
    isCallerAdmin ||
    rule.created_by === callerId ||
    (isSuperFranchise && (rule.super_franchise_id === callerId || rule.scope === 'super_franchise_default')) ||
    (isFranchise && (rule.franchaise_id === callerId || rule.scope === 'franchise_default'))
  );

  if (!isAuthorized) {
    return res.status(403).json({ success: false, message: 'Only the creator, parent franchise, or admin can update this rule' });
  }

  const {
    gateway, payment_mode, method, card_type, cardType, card_brand, network,
    card_classification, cardClassification, sub_type, subType,
    settlement_type, settlementType, channel, min_amount, minAmount, max_amount, maxAmount,
    charge_percent, chargePercent, base_rate, charge_flat, chargeFlat,
    gst_required, gstRequired, gst_percent, gstPercent, gst_rate, is_active
  } = req.body;

  const resolvedPercent = charge_percent ?? chargePercent ?? base_rate;
  const resolvedFlat = charge_flat ?? chargeFlat;
  const resolvedMin = min_amount ?? minAmount;
  const resolvedMax = max_amount ?? maxAmount;
  const resolvedGstPercent = gst_percent ?? gstPercent ?? gst_rate;
  const resolvedGstRequired = gst_required ?? gstRequired;
  const resolvedSubType = sub_type ?? subType;
  const resolvedClassification = card_classification ?? cardClassification ?? resolvedSubType;

  // Query upline rule to get base cost floor for this specification and slab
  const normRuleMode = String(rule.payment_mode || 'ALL').trim().toUpperCase();
  const rawRuleBrand = rule.card_brand;
  const normRuleBrand = rawRuleBrand ? PgChargeService.normalizeCardBrand(rawRuleBrand) : null;
  const cleanRuleBrand = (!normRuleBrand || normRuleBrand === 'ALL') ? null : normRuleBrand;
  const rawRuleType = rule.card_type;
  const cleanRuleType = rawRuleType ? String(rawRuleType).trim().toUpperCase().replace(/[\s_-]/g, '').replace('CARD', '') : null;
  const normRuleType = (!cleanRuleType || cleanRuleType === 'ALL' || cleanRuleType === 'UNKNOWN') ? null : cleanRuleType;

  // Determine allowed upline scopes based on the rule being updated
  let uplineScopes = [];
  if (['admin_super_franchise', 'admin_franchise', 'admin_merchant'].includes(rule.scope)) {
    uplineScopes = ['admin_default', 'super_admin_admin', 'super_admin_default'];
  } else if (rule.scope === 'admin_default') {
    uplineScopes = ['super_admin_admin', 'super_admin_default'];
  } else if (rule.scope === 'super_admin_admin') {
    uplineScopes = ['super_admin_default'];
  } else if (['super_franchise_default', 'super_franchise_franchise', 'super_franchise_merchant'].includes(rule.scope)) {
    uplineScopes = ['admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
  } else if (['franchise_default', 'franchise_merchant'].includes(rule.scope)) {
    uplineScopes = ['super_franchise_franchise', 'super_franchise_default', 'admin_franchise', 'admin_super_franchise', 'admin_default', 'super_admin_admin', 'super_admin_default'];
  } else {
    uplineScopes = ['super_admin_default'];
  }

  let uplineRule = null;
  if (rule.scope !== 'super_admin_default' && uplineScopes.length > 0) {
    const scopePriorityOrder = [
      [db.literal(`CASE scope
        WHEN 'super_franchise_franchise' THEN 900000
        WHEN 'super_franchise_default'   THEN 800000
        WHEN 'admin_franchise'           THEN 600000
        WHEN 'admin_super_franchise'     THEN 500000
        WHEN 'super_admin_admin'         THEN 450000
        WHEN 'admin_default'             THEN 400000
        WHEN 'super_admin_default'       THEN 200000
        ELSE 0
      END`), 'DESC'],
      ['id', 'DESC']
    ];

    const uplineWhere = {
      id: { [Op.ne]: rule.id },
      scope: { [Op.in]: uplineScopes },
      payment_mode: normRuleMode,
      min_amount: rule.min_amount != null ? parseFloat(rule.min_amount) : 0,
      is_active: true
    };
    if (rule.max_amount !== null && rule.max_amount !== undefined && !isNaN(parseFloat(rule.max_amount))) {
      uplineWhere.max_amount = parseFloat(rule.max_amount);
    } else {
      uplineWhere.max_amount = null;
    }
    if (cleanRuleBrand) uplineWhere.card_brand = cleanRuleBrand;
    if (normRuleType) uplineWhere.card_type = normRuleType;
    if (rule.settlement_type) uplineWhere.settlement_type = rule.settlement_type;

    if (rule.super_franchise_id) {
      uplineWhere[Op.or] = [
        { super_franchise_id: rule.super_franchise_id },
        { super_franchise_id: null }
      ];
    } else if (rule.franchaise_id) {
      uplineWhere[Op.or] = [
        { franchaise_id: rule.franchaise_id },
        { franchaise_id: null }
      ];
    }

    uplineRule = await PgChargeRule.findOne({ where: uplineWhere, order: scopePriorityOrder });

    // Wildcard fallback: Brand or Type fallback to 'ALL' / NULL
    if (!uplineRule) {
      const wildcardWhere = {
        id: { [Op.ne]: rule.id },
        scope: uplineWhere.scope,
        payment_mode: normRuleMode,
        min_amount: uplineWhere.min_amount,
        max_amount: uplineWhere.max_amount,
        is_active: true
      };
      if (rule.super_franchise_id) {
        wildcardWhere[Op.or] = [
          { super_franchise_id: rule.super_franchise_id },
          { super_franchise_id: null }
        ];
      } else if (rule.franchaise_id) {
        wildcardWhere[Op.or] = [
          { franchaise_id: rule.franchaise_id },
          { franchaise_id: null }
        ];
      }
      if (cleanRuleBrand) wildcardWhere.card_brand = { [Op.in]: [cleanRuleBrand, 'ALL', null] };
      if (normRuleType) wildcardWhere.card_type = { [Op.in]: [normRuleType, 'ALL', null] };
      if (rule.settlement_type) wildcardWhere.settlement_type = { [Op.in]: [rule.settlement_type, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: wildcardWhere, order: scopePriorityOrder });
    }

    // Open slab fallback
    if (!uplineRule) {
      const fallbackWhere = {
        id: { [Op.ne]: rule.id },
        scope: uplineWhere.scope,
        payment_mode: normRuleMode,
        is_active: true
      };
      if (rule.super_franchise_id) {
        fallbackWhere[Op.or] = [
          { super_franchise_id: rule.super_franchise_id },
          { super_franchise_id: null }
        ];
      } else if (rule.franchaise_id) {
        fallbackWhere[Op.or] = [
          { franchaise_id: rule.franchaise_id },
          { franchaise_id: null }
        ];
      }
      if (cleanRuleBrand) fallbackWhere.card_brand = { [Op.in]: [cleanRuleBrand, 'ALL', null] };
      if (normRuleType) fallbackWhere.card_type = { [Op.in]: [normRuleType, 'ALL', null] };
      if (rule.settlement_type) fallbackWhere.settlement_type = { [Op.in]: [rule.settlement_type, 'ANY', null] };
      uplineRule = await PgChargeRule.findOne({ where: fallbackWhere, order: scopePriorityOrder });
    }
  }

  const uplineFlat = uplineRule ? parseFloat(uplineRule.charge_flat || 0) : 0;
  const uplinePercent = uplineRule ? parseFloat(uplineRule.charge_percent || 0) : 0;

  // If the upline rule was flat, downline cannot convert to percentage
  if (uplineFlat > 0 && uplinePercent <= 0) {
    if (resolvedPercent != null && parseFloat(resolvedPercent) > 0 && (resolvedFlat == null || parseFloat(resolvedFlat) <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'This rate is configured as Flat Rate and cannot be converted to percentage.'
      });
    }
    if (resolvedFlat != null && parseFloat(resolvedFlat) < uplineFlat && !(normalizedRole === 'super_admin' && rule.scope === 'super_admin_default')) {
      return res.status(400).json({
        success: false,
        message: `Flat rate (₹${resolvedFlat}) cannot be less than upline flat rate of ₹${uplineFlat}.`
      });
    }
  } else if (uplinePercent > 0 && (resolvedFlat == null || parseFloat(resolvedFlat) <= 0)) {
    if (resolvedFlat != null && parseFloat(resolvedFlat) > 0 && (resolvedPercent == null || parseFloat(resolvedPercent) <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'This rate is configured as Percentage and cannot be converted to Flat Rate.'
      });
    }
    if (resolvedPercent != null && parseFloat(resolvedPercent) < uplinePercent && !(normalizedRole === 'super_admin' && rule.scope === 'super_admin_default')) {
      return res.status(400).json({
        success: false,
        message: `Rate (${resolvedPercent}%) cannot be less than upline rate of ${uplinePercent}%.`
      });
    }
  }

  // Only Admin and Super Admin can edit rate payment mode, company name, network, card type, settlement type, min and max amount.
  // Super Franchise and Franchise can only set/update rates for their downline.
  if (!isCallerAdmin) {
    const downlineScopes = [
      'super_franchise_default', 'super_franchise_franchise', 'super_franchise_merchant',
      'franchise_default', 'franchise_merchant'
    ];
    if (!downlineScopes.includes(rule.scope)) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin and Super Admin can edit base rate rules and payment specifications.'
      });
    }

    await rule.update({
      ...(resolvedPercent != null && { charge_percent: parseFloat(resolvedPercent) }),
      ...(resolvedFlat != null && { charge_flat: parseFloat(resolvedFlat) }),
      ...(is_active != null && { is_active: Boolean(is_active) })
    });

    return res.status(200).json({ success: true, message: 'Downline rate updated successfully', data: rule });
  }

  const targetGateway = gateway != null ? gateway : rule.gateway;
  const targetPaymentMode = (payment_mode || method) != null ? (payment_mode || method) : rule.payment_mode;
  const targetCardType = (card_type || cardType) !== undefined ? (card_type || cardType || null) : rule.card_type;
  const targetCardBrand = (card_brand || network) !== undefined ? (card_brand || network || null) : rule.card_brand;
  const targetClassification = resolvedClassification !== undefined ? (resolvedClassification || null) : rule.card_classification;
  const targetSettlement = (settlement_type || settlementType) !== undefined ? (settlement_type || settlementType || null) : rule.settlement_type;
  const targetMin = resolvedMin != null ? parseFloat(resolvedMin) : parseFloat(rule.min_amount || 0);
  const targetMax = resolvedMax !== undefined ? (resolvedMax !== null && resolvedMax !== '' ? parseFloat(resolvedMax) : null) : rule.max_amount;

  const dupCheckWhere = {
    id: { [Op.ne]: rule.id },
    scope: rule.scope,
    user_id: rule.user_id,
    company_id: rule.company_id,
    franchaise_id: rule.franchaise_id,
    super_franchise_id: rule.super_franchise_id,
    gateway: targetGateway || 'ALL',
    payment_mode: targetPaymentMode || 'ALL',
    card_type: targetCardType,
    card_brand: targetCardBrand,
    card_classification: targetClassification,
    settlement_type: targetSettlement,
    is_active: true
  };

  const existingUpdateRules = await PgChargeRule.findAll({ where: dupCheckWhere });
  const updatedMin = targetMin;
  const updatedMax = targetMax !== null && targetMax !== undefined && targetMax !== '' && !isNaN(parseFloat(targetMax))
    ? parseFloat(targetMax)
    : null;

  const u1 = updatedMin;
  const u2 = updatedMax !== null ? updatedMax : Infinity;

  const duplicateUpdateOverlap = existingUpdateRules.find((other) => {
    if (other.is_active === false) return false;
    const otherMin = other.min_amount != null ? parseFloat(other.min_amount) : 0;
    const otherMax = other.max_amount != null && !isNaN(parseFloat(other.max_amount)) ? parseFloat(other.max_amount) : null;
    const s1 = otherMin;
    const s2 = otherMax !== null ? otherMax : Infinity;

    return u1 <= s2 && u2 >= s1;
  });

  if (duplicateUpdateOverlap) {
    const existingRange = `${duplicateUpdateOverlap.min_amount != null ? duplicateUpdateOverlap.min_amount : 0} - ${duplicateUpdateOverlap.max_amount != null ? duplicateUpdateOverlap.max_amount : 'Open'}`;
    return res.status(400).json({
      success: false,
      message: `Another active PG charge rule with matching specifications and overlapping amount slab (${existingRange}) already exists.`
    });
  }

  await rule.update({
    ...(gateway != null && { gateway }),
    ...((payment_mode || method) != null && { payment_mode: payment_mode || method }),
    ...((card_type || cardType) != null && { card_type: card_type || cardType }),
    ...((card_brand || network) != null && { card_brand: card_brand || network }),
    ...(resolvedClassification != null && { card_classification: resolvedClassification }),
    ...(resolvedSubType != null && { sub_type: resolvedSubType }),
    ...((settlement_type || settlementType) != null && { settlement_type: settlement_type || settlementType }),
    ...(channel != null && { channel }),
    ...(resolvedMin != null && { min_amount: parseFloat(resolvedMin) }),
    ...(resolvedMax !== undefined && { max_amount: resolvedMax !== null && resolvedMax !== '' ? parseFloat(resolvedMax) : null }),
    ...(resolvedPercent != null && { charge_percent: parseFloat(resolvedPercent) }),
    ...(resolvedFlat != null && { charge_flat: parseFloat(resolvedFlat) }),
    ...(resolvedGstRequired != null && { gst_required: Boolean(resolvedGstRequired) }),
    ...(resolvedGstPercent != null && { gst_percent: parseFloat(resolvedGstPercent) }),
    ...(is_active != null && { is_active: Boolean(is_active) })
  });

  return res.status(200).json({ success: true, message: 'Charge rule updated', data: rule });
});

/**
 * @desc    Delete (soft-deactivate) a PG charge rule
 * @route   DELETE /api/pg/charge-rules/:id
 * @access  Private
 */
const deleteChargeRule = asyncHandler(async (req, res) => {
  const { id: callerId, role: callerRole, company_id: companyId } = req.user;
  const ruleId = parseInt(req.params.id, 10);
  const normalizedRole = String(callerRole || '').trim().toLowerCase().replace(/[-\s]/g, '_');

  const PgChargeRule = db.models.PgChargeRule;

  const where = { id: ruleId };
  if (normalizedRole !== 'super_admin' && companyId) {
    where.company_id = companyId;
  }

  const rule = await PgChargeRule.findOne({ where });

  if (!rule) {
    return res.status(404).json({ success: false, message: 'Charge rule not found' });
  }

  if (rule.created_by && rule.created_by !== callerId && normalizedRole !== 'super_admin' && normalizedRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only the creator or admin can delete this rule' });
  }

  // Soft delete — mark inactive instead of hard delete
  await rule.update({ is_active: false });

  return res.status(200).json({ success: true, message: 'Charge rule deleted (deactivated)' });
});

/**
 * @desc    Calculate PG MDR charge preview
 * @route   POST /api/pg/charge-rules/calculate
 * @access  Private
 */
const calculateCharge = asyncHandler(async (req, res) => {
  const { amount, method, payment_mode, card_type, card_brand, network, sub_type, settlement_type, gateway } = req.body;
  const { id: userId, company_id: companyId } = req.user;

  const rule = await PgChargeService.getChargeRule({
    userId,
    companyId,
    gateway: gateway || 'ALL',
    paymentMode: payment_mode || method || 'CARD',
    cardType: card_type || 'CREDIT',
    cardBrand: card_brand || network || 'VISA',
    classification: sub_type || 'any',
    sub_type: sub_type || 'any',
    settlement: settlement_type || null,
    amount: parseFloat(amount || 0)
  });

  const calculation = PgChargeService.calculateCharge(parseFloat(amount || 0), rule);
  return res.status(200).json({ success: true, data: { rule, calculation } });
});

module.exports = {
  createOrder,
  handleWebhook,
  getTransactions,
  getOrderStatus,
  getChargeRules,
  getChargeRuleById,
  createChargeRule,
  updateChargeRule,
  deleteChargeRule,
  calculateCharge,
};
