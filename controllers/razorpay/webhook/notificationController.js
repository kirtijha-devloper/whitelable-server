const asyncHandler = require("express-async-handler");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { processRzpNotification } = require("../../../services/razorpay/webhookService");
const RazorpayNotification = require("../../../models/RazorpayNotification");
const { handleAuthorizedTransaction } = require("../../../workers/razorpayWebhookWorker");
const ChargeService = require("../../../services/chargeService");
const ledgerService = require("../../../services/ledgerService");
const PosMachine = require("../../../models/posMachine");
const User = require("../../../models/User");
const MerchantTransactionCharge = require("../../../models/MerchantTransactionCharge");
const { Op } = require("sequelize");
const { EMPLOYEE_PERMISSIONS, hasPermission } = require("../../../utils/permissions");

// ── Minimal file logger for incoming webhook notifications ────────────────────
const LOG_FILE = path.join(__dirname, "../../../logs/webhookNotifications.log");

function logNotification(source, body) {
    try {
        const ts   = new Date().toISOString();
        const txn  = body.txnId || body.txn_id || body.orderId || '-';
        const amt  = body.amount || body.amountOriginal || '-';
        const mid  = body.mid || body.mid_number || '-';
        const tid  = body.tid || body.tid_number || '-';
        const mode = body.paymentMode || '-';
        const stat = body.status || '-';
        const line = `[${ts}] source=${source} txnId=${txn} status=${stat} amount=${amt} mid=${mid} tid=${tid} paymentMode=${mode}\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch (_) { /* never crash the request due to a log write failure */ }
}
// ─────────────────────────────────────────────────────────────────────────────

async function handleRzpNotification(req, res) {
    try {
        const body = req.body;
        const source = req.webhookSource || 'agro'; // default if somehow not set

        // write a short one-line entry immediately (before anything else can fail)
        logNotification(source, body);

        // Razorpay requires 200 OK IMMEDIATELY
        // Return XML response as Razorpay expects text/xml format
        res.status(200)
           .set('Content-Type', 'text/xml; charset=utf-8')
           .send('<?xml version="1.0" encoding="UTF-8"?><response><status>OK</status></response>');
        
        // Process in background AFTER response is sent
        // Using setImmediate ensures response is sent first, then processing starts
        setImmediate(async () => {
            try {
                // Fire-and-forget forward of the received notification to the reseller endpoint.
                // Choose path based on source
                const forwardUrl = source === 'everlife'
                    ? "https://api.abheepay.com/api/razorpay-notifications/webhook/everlife"
                    : "https://api.abheepay.com/api/razorpay-notifications/webhook";

                // Do not await this response so we don't delay the webhook handling.
                axios.post(
                    forwardUrl,
                    body,
                    {
                        headers: { "Content-Type": "application/json" },
                        timeout: 5000
                    }
                ).catch((err) => {
                    console.error("[Webhook Controller] Forward notification error:", err?.message || err);
                });

                // include source so service can store it
                await processRzpNotification(body, source);
            } catch (error) {
                // Errors are already handled in processRzpNotification
                // But we catch here to prevent unhandled promise rejection
                console.error("[Webhook Controller] Background processing error:", error);
            }
        });
        
    } catch (err) {
        console.error("[Webhook Controller] Error handling webhook:", err);
        // still return OK to avoid retries, but in XML format
        return res.status(200)
                  .set('Content-Type', 'text/xml; charset=utf-8')
                  .send('<?xml version="1.0" encoding="UTF-8"?><response><status>OK</status></response>');
    }
}

/**
 * List Razorpay webhook notifications with pagination and filters
 */
const listNotifications = asyncHandler(async (req, res) => {
    try {
        if (!hasPermission(req.user, EMPLOYEE_PERMISSIONS.RAZORPAY_NOTIFICATIONS_LIST)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view Razorpay notifications'
            });
        }

        const { 
            status,
            txn_id,
            mid,
            tid,
            deviceSerial,
            paymentMode,
            startDate,  
            endDate,
            page = 1, 
            limit = 10 
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const where = {};

        // Apply filters
        if (status) {
            where.status = status;
        }

        if (txn_id) {
            where.txn_id = { [Op.like]: `%${txn_id}%` };
        }

        // Date range filter
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                where.createdAt[Op.gte] = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt[Op.lte] = end;
            }
        }

        // apply filters directly to columns where possible
        if (mid) {
            where.mid = { [Op.like]: `%${mid}%` };
        }
        if (tid) {
            where.tid = { [Op.like]: `%${tid}%` };
        }
        if (paymentMode) {
            where.payment_mode = paymentMode;
        }
        if (deviceSerial) {
            where.device_serial = { [Op.like]: `%${deviceSerial}%` };
        }

        // source filter (razorpay vs everlife)
        if (req.query.source) {
            where.source = req.query.source;
        }

        let formattedNotifications = [];
        let totalCount = 0;

        const { count, rows: notifications } = await RazorpayNotification.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });

        totalCount = count;

        formattedNotifications = notifications.map((notification) => {
            const eventData = typeof notification.event_json === 'string' 
                ? JSON.parse(notification.event_json) 
                : notification.event_json;

            return {
                id: notification.id,
                txn_id: notification.txn_id,
                status: notification.status,
                processing_status: notification.processing_status || null,
                processed: notification.processed || false,
                createdAt: notification.createdAt,
                updatedAt: notification.updatedAt,
                amount: notification.amount || eventData.amount || null,
                amountOriginal: eventData.amountOriginal || null,
                currencyCode: notification.currency_code || eventData.currencyCode || null,
                mid: notification.mid || eventData.mid || null,
                tid: notification.tid || eventData.tid || null,
                deviceSerial: notification.device_serial || eventData.deviceSerial || null,
                paymentMode: notification.payment_mode || eventData.paymentMode || null,
                paymentCardType: notification.payment_card_type || eventData.paymentCardType || null,
                paymentCardBrand: notification.payment_card_brand || eventData.paymentCardBrand || null,
                customerName: eventData.customerName || null,
                payerName: eventData.payerName || null,
                settlementStatus: eventData.settlementStatus || null,
                postingDate: notification.posting_date || eventData.postingDate || null,
                rrNumber: notification.rr_number || eventData.rrNumber || null,
                txnType: eventData.txnType || null,
                orderId: eventData.orderId || null,
                event_json: eventData
            };
        });

        res.status(200).json({
            success: true,
            message: 'Razorpay notifications retrieved successfully',
            data: formattedNotifications,
            pagination: {
                total: totalCount,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(totalCount / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('List notifications error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong'
        });
    }
});

/**
 * Get single notification by ID
 */
const getNotificationById = asyncHandler(async (req, res) => {
    try {
        if (!hasPermission(req.user, EMPLOYEE_PERMISSIONS.RAZORPAY_NOTIFICATIONS_READ)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to view Razorpay notification details'
            });
        }

        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Notification ID is required'
            });
        }

        const notification = await RazorpayNotification.findByPk(id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        const eventData = typeof notification.event_json === 'string' 
            ? JSON.parse(notification.event_json) 
            : notification.event_json;

        const formatted = {
            id: notification.id,
            txn_id: notification.txn_id,
            status: notification.status,
            processing_status: notification.processing_status || null,
            processed: notification.processed || false,
            source: notification.source || 'razorpay',
            createdAt: notification.createdAt,
            updatedAt: notification.updatedAt,
            event_json: eventData
        };

        res.status(200).json({
            success: true,
            data: formatted
        });
    } catch (error) {
        console.error('Get notification error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong'
        });
    }
});

async function _normalizeId(id) {
    if (id == null) return "";
    const digits = id.toString().trim().replace(/\D/g, "");
    const stripped = digits.replace(/^0+/, "");
    return stripped === "" ? digits : stripped;
}

async function _resolvePosContext(notification) {
    const eventData = typeof notification.event_json === 'string' ? JSON.parse(notification.event_json) : notification.event_json;
    const merchantId = notification.mid || eventData.mid || eventData.mid_number;
    const terminalId = notification.tid || eventData.tid || eventData.tid_number;
    const transactionAmount = parseFloat(notification.amount || eventData.amount || eventData.amountOriginal);

    if (!merchantId || !terminalId || !transactionAmount || Number.isNaN(transactionAmount)) {
        throw new Error('Invalid notification data: mid/tid/amount missing or malformed');
    }

    const normalizedMid = await _normalizeId(merchantId);
    const normalizedTid = await _normalizeId(terminalId);

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
    let matchedMid = null;
    let matchedTid = null;

    for (const pm of posMachines) {
        const storedMid = await _normalizeId(pm.mid_number);
        const storedTid = await _normalizeId(pm.tid_number);
        if (storedMid === normalizedMid && storedTid === normalizedTid) {
            posMachine = pm;
            matchedMid = pm.mid_number;
            matchedTid = pm.tid_number;
            break;
        }
    }

    if (!posMachine) {
        const fallback = await PosMachine.findOne({
            where: {
                status: 'active',
                mid_number: { [Op.in]: midCandidates },
                tid_number: { [Op.in]: tidCandidates }
            }
        });
        if (fallback) {
            posMachine = fallback;
            matchedMid = fallback.mid_number;
            matchedTid = fallback.tid_number;
        }
    }

    if (!posMachine) {
        throw new Error(`POS machine not found for mid=${merchantId}, tid=${terminalId}`);
    }

    if (!posMachine.assigned_to) {
        throw new Error(`POS machine ${posMachine.id} has no assigned user`);
    }

    const posOperator = await User.findByPk(posMachine.assigned_to);
    if (!posOperator) {
        throw new Error(`Assigned user not found for POS machine ${posMachine.id}`);
    }

    await notification.update({ pos_machine_id: posMachine.id, user_id: posOperator.id });

    return {
        eventData,
        merchantId,
        terminalId,
        transactionAmount,
        posMachine,
        posOperator,
        paymentMode: (notification.payment_mode || eventData.paymentMode || '').toUpperCase(),
        paymentCardType: notification.payment_card_type || eventData.paymentCardType || null,
        paymentCardBrand: notification.payment_card_brand || eventData.paymentCardBrand || null,
        classificationFromJson: eventData.card_classification || eventData.cardClassification || null,
        rrNumber: notification.rr_number || eventData.rrNumber || null,
        customerName: eventData.customerName || null
    };
}

async function adminProcessNotification(req, res) {
    try {
        if (!req.user || req.user.role !== 'admin') {
            res.status(403).json({ success: false, message: 'Admin role required' });
            return;
        }

        const { id } = req.params;
        const notification = await RazorpayNotification.findByPk(id);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        if (notification.processing_status === 'completed') {
            return res.status(400).json({ success: false, message: 'Notification already processed' });
        }

        await handleAuthorizedTransaction(notification.txn_id, notification.event_json, notification);

        const reloaded = await RazorpayNotification.findByPk(id);
        return res.status(200).json({ success: true, message: 'Notification processed by admin', notification: reloaded });
    } catch (error) {
        console.error('adminProcessNotification error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error processing notification' });
    }
}

async function adminProcessNotificationWithCustomCharge(req, res) {
    try {
        if (!req.user || req.user.role !== 'admin') {
            res.status(403).json({ success: false, message: 'Admin role required' });
            return;
        }

        const { id } = req.params;
        const { charge_percent, charge_flat } = req.body;

        const parsedPercent = charge_percent !== undefined && charge_percent !== null ? parseFloat(charge_percent) : null;
        const parsedFlat = charge_flat !== undefined && charge_flat !== null ? parseFloat(charge_flat) : null;

        if ((parsedPercent === null || Number.isNaN(parsedPercent)) && (parsedFlat === null || Number.isNaN(parsedFlat))) {
            return res.status(400).json({ success: false, message: 'charge_percent or charge_flat must be provided' });
        }

        const notification = await RazorpayNotification.findByPk(id);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        const {
            eventData,
            merchantId,
            terminalId,
            transactionAmount,
            posMachine,
            posOperator,
            paymentMode,
            paymentCardType,
            paymentCardBrand,
            classificationFromJson,
            rrNumber,
            customerName
        } = await _resolvePosContext(notification);

        const existingCharge = await MerchantTransactionCharge.findOne({ where: { razorpay_transaction_id: notification.txn_id } });
        if (existingCharge) {
            return res.status(400).json({ success: false, message: 'Merchant transaction charge already exists for this notification' });
        }

        const effectiveChargePercent = parsedPercent || 0;
        const chargeRuleStub = {
            charge_percent: effectiveChargePercent,
            charge_flat: parsedFlat || 0,
            gst_required: false,
            gst_percent: 0
        };

        const chargeResult = ChargeService.calculateCharge(transactionAmount, chargeRuleStub);
        const chargeAmount = chargeResult.charge;
        const gstAmount = chargeResult.gstAmount || 0;
        const netAmount = parseFloat((transactionAmount - chargeAmount - gstAmount).toFixed(2));

        // Franchise handling (admin charge for franchise)
        let franchiseChargeAmount = 0;
        let franchiseEarning = 0;

        if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
            const franchiseRule = await ChargeService.getAdminChargeRuleForFranchise({
                franchiseId: posOperator.franchaise_id,
                paymentMode,
                cardType: paymentCardType,
                cardBrand: paymentCardBrand,
                classification: classificationFromJson,
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

            if (franchiseChargeAmount > 0) {
                await ledgerService.createLedgerEntry({
                    userId: posOperator.franchaise_id,
                    transactionType: 'franchise_admin_fee',
                    transactionId: notification.txn_id,
                    description: `Admin charge for Razorpay txn ${notification.txn_id}`,
                    debit: franchiseChargeAmount,
                    status: 'completed',
                    metadata: {
                        merchant_id: posOperator.id,
                        transaction_amount: transactionAmount,
                        charge_rate: effectiveChargePercent,
                        franchise_charge: franchiseChargeAmount
                    }
                });
            }

            if (chargeAmount > 0) {
                await ledgerService.createLedgerEntry({
                    userId: posOperator.franchaise_id,
                    transactionType: 'franchise_merchant_charge',
                    transactionId: notification.txn_id,
                    description: `Merchant charge for Razorpay txn ${notification.txn_id}`,
                    credit: chargeAmount,
                    status: 'completed',
                    metadata: {
                        merchant_id: posOperator.id,
                        transaction_amount: transactionAmount,
                        charge_rate: effectiveChargePercent
                    }
                });
            }
        }

        const merchantTransactionCharge = await MerchantTransactionCharge.create({
            merchant_id: posOperator.id,
            pos_machine_id: posMachine.id,
            razorpay_transaction_id: notification.txn_id,
            transaction_amount: transactionAmount,
            charge_amount: chargeAmount,
            gst_amount: gstAmount,
            gst_percent: 0,
            net_amount: netAmount,
            charge_rate: effectiveChargePercent,
            charge_config_id: null,
            payment_method: paymentMode,
            payment_card_type: paymentCardType,
            payment_card_brand: paymentCardBrand,
            wallet_transaction_id: null,
            rr_number: rrNumber,
            mid_number: merchantId.toString(),
            tid_number: terminalId.toString(),
            customer_name: customerName
        });

        await notification.update({
            processed: true,
            processing_status: 'completed',
            processed_at: new Date(),
            processing_error: null
        });

        await ledgerService.createRazorpayChargeEntry({
            userId: posOperator.id,
            razorpayTransactionId: notification.txn_id,
            transactionAmount: transactionAmount,
            chargeAmount: chargeAmount,
            netAmount: netAmount,
            merchantTransactionChargeId: merchantTransactionCharge.id,
            description: `Admin-adjusted Razorpay txn ${notification.txn_id}`,
            metadata: {
                payment_mode: paymentMode,
                charge_rate: effectiveChargePercent,
                charge_flat: parsedFlat || 0,
                gst_amount: gstAmount,
                gst_percent: 0,
                pos_machine_id: posMachine.id,
                merchant_id: posOperator.id
            }
        });

        if (posOperator.role === 'merchant' && posOperator.franchaise_id && franchiseEarning > 0) {
            try {
                await ledgerService.createFranchiseEarningEntry({
                    userId: posOperator.franchaise_id,
                    razorpayTransactionId: notification.txn_id,
                    amount: franchiseEarning,
                    transactionType: 'razorpay_franchise_earning',
                    description: `Franchise earning ₹${franchiseEarning} for merchant ${posOperator.id}`,
                    metadata: {
                        merchant_id: posOperator.id,
                        transaction_amount: transactionAmount,
                        charge_amount: chargeAmount,
                        franchise_charge: franchiseChargeAmount
                    }
                });
            } catch (earnError) {
                console.error('[adminProcessNotificationWithCustomCharge] Franchise earning entry failed:', earnError);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Notification processed with custom charge',
            data: {
                notification: await RazorpayNotification.findByPk(id),
                merchantTransactionCharge
            }
        });
    } catch (error) {
        console.error('adminProcessNotificationWithCustomCharge error:', error);

        // Mark to needs_admin for later manual review
        try {
            if (req.params && req.params.id) {
                const failedNotification = await RazorpayNotification.findByPk(req.params.id);
                if (failedNotification) {
                    await failedNotification.update({
                        processed: false,
                        processing_status: 'needs_admin',
                        processing_error: error.message || String(error),
                        processed_at: new Date()
                    });
                }
            }
        } catch (secondaryErr) {
            console.error('Failed to update notification status after error:', secondaryErr);
        }

        return res.status(500).json({ success: false, message: error.message || 'Error processing notification' });
    }
}

module.exports = { 
    handleRzpNotification,
    listNotifications,
    getNotificationById,
    adminProcessNotification,
    adminProcessNotificationWithCustomCharge
};
