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
const { WEBHOOK_SOURCES, LEGACY_AGRO_SOURCE, extractCardClassification } = require("../../../utils/razorpay/sources");

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

function buildSourceFilter(source) {
    if (!source) return null;

    if (source === WEBHOOK_SOURCES.AGRO_AXIS || source === LEGACY_AGRO_SOURCE) {
        return { [Op.in]: [WEBHOOK_SOURCES.AGRO_AXIS, LEGACY_AGRO_SOURCE] };
    }

    return source;
}
// ─────────────────────────────────────────────────────────────────────────────

async function handleRzpNotification(req, res) {
    try {
        const body = req.body;
        const source = req.webhookSource || WEBHOOK_SOURCES.AGRO_AXIS;

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
                const forwardUrl = source === WEBHOOK_SOURCES.EVERLIFE
                    ? "https://api.abheepay.com/api/razorpay-notifications/webhook/everlife"
                    : "https://api.abheepay.com/api/razorpay-notifications/webhook";

                // Forward with same Authorization header so the reseller endpoint
                // can authenticate the request correctly.
                axios.post(
                    forwardUrl,
                    body,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            ...(req.headers["authorization"] ? { "Authorization": req.headers["authorization"] } : {})
                        },
                        timeout: 5000
                    }
                ).catch((err) => {
                    writeDevLog('webhook', {
                        file: 'notificationController.js',
                        error: err.message
                    });
                    console.error("[Webhook Controller] Forward notification error:", err?.message || err);
                });

                // include source so service can store it
                await processRzpNotification(body, source);
            } catch (error) {
                writeDevLog('webhook', {
                    file: 'notificationController.js',
                    error: error.message
                });
                // Errors are already handled in processRzpNotification
                // But we catch here to prevent unhandled promise rejection
                console.error("[Webhook Controller] Background processing error:", error);
            }
        });
        
    } catch (err) {
        writeDevLog('webhook', {
            file: 'notificationController.js',
            error: err.message
        });
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
            limit = 10,
            settlement_type,
            processing_status,
            processed,
            source
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
        if (source) {
            where.source = buildSourceFilter(source);
        }

        if(settlement_type) {
            where.settlement_type = settlement_type
        }

        if (processing_status) {
            where.processing_status = {[Op.like] : `%${processing_status}%`}
        }

        if(processed) {
            where.processed = processed
        }

        // Scope filter: Super Admin sees all notifications.
        // Admin sees only notifications matching machines assigned to them or their merchants.
        if (req.user?.role !== 'super_admin') {
            const adminId = req.user.id;
            const companyId = req.company || req.user.company_id;

            let userIds = [adminId];
            if (companyId) {
                const companyUsers = await User.findAll({
                    where: { company_id: companyId },
                    attributes: ['id']
                });
                userIds = [...new Set([adminId, ...companyUsers.map(u => u.id)])];
            }

            const assignedMachines = await PosMachine.findAll({
                where: {
                    [Op.or]: [
                        { assigned_to: { [Op.in]: userIds } },
                        ...(companyId ? [{ company_name: companyId }] : [])
                    ]
                },
                attributes: ['id', 'mid_number', 'tid_number', 'device_serial_number']
            });

            const machineIds = assignedMachines.map(m => m.id);
            const mids = assignedMachines.map(m => m.mid_number).filter(Boolean);
            const tids = assignedMachines.map(m => m.tid_number).filter(Boolean);
            const serials = assignedMachines.map(m => m.device_serial_number).filter(Boolean);

            const scopeConditions = [];
            if (machineIds.length > 0) {
                scopeConditions.push({ pos_machine_id: { [Op.in]: machineIds } });
            }
            if (mids.length > 0) {
                scopeConditions.push({ mid: { [Op.in]: mids } });
            }
            if (tids.length > 0) {
                scopeConditions.push({ tid: { [Op.in]: tids } });
            }
            if (serials.length > 0) {
                scopeConditions.push({ device_serial: { [Op.in]: serials } });
            }
            if (companyId) {
                scopeConditions.push({ company_id: companyId });
            }
            if (userIds.length > 0) {
                scopeConditions.push({ user_id: { [Op.in]: userIds } });
            }

            if (scopeConditions.length > 0) {
                where[Op.and] = where[Op.and] || [];
                where[Op.and].push({ [Op.or]: scopeConditions });
            } else {
                where.id = -1; // No machines assigned yet
            }
        }

        let formattedNotifications = [];
        let totalCount = 0;

        const { count, rows: notifications } = await RazorpayNotification.findAndCountAll({
            where,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'name', 'email', 'abheepay_id'],
                    required: false
                },
                {
                    model: PosMachine,
                    as: 'posMachine',
                    attributes: ['id', 'mid_number', 'tid_number', 'device_serial_number'],
                    required: false
                }
            ],
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
                source: notification.source || WEBHOOK_SOURCES.AGRO_AXIS,
                status: notification.status,
                processing_status: notification.processing_status || null,
                processing_error: notification.processing_error || null,
                processed: notification.processed || false,
                settlement_type: notification.settlement_type || eventData?.settlement_type || null,
                user: notification.user ? {
                    id: notification.user.id,
                    name: notification.user.name,
                    email: notification.user.email,
                    abheepay_id: notification.user.abheepay_id
                } : null,
                pos_machine: notification.posMachine ? {
                    id: notification.posMachine.id,
                    mid_number: notification.posMachine.mid_number,
                    tid_number: notification.posMachine.tid_number,
                    device_serial_number: notification.posMachine.device_serial_number
                } : null,
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
                cardClassification: extractCardClassification(eventData),
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
            processing_error: notification.processing_error || null,
            processed: notification.processed || false,
            source: notification.source || WEBHOOK_SOURCES.AGRO_AXIS,
            amount: notification.amount || eventData.amount || null,
            currencyCode: notification.currency_code || eventData.currencyCode || null,
            mid: notification.mid || eventData.mid || null,
            tid: notification.tid || eventData.tid || null,
            deviceSerial: notification.device_serial || eventData.deviceSerial || null,
            paymentMode: notification.payment_mode || eventData.paymentMode || null,
            paymentCardType: notification.payment_card_type || eventData.paymentCardType || null,
            paymentCardBrand: notification.payment_card_brand || eventData.paymentCardBrand || null,
            cardClassification: extractCardClassification(eventData),
            postingDate: notification.posting_date || eventData.postingDate || null,
            rrNumber: notification.rr_number || eventData.rrNumber || null,
            createdAt: notification.createdAt,
            updatedAt: notification.updatedAt,
            event_json: eventData
        };

        res.status(200).json({
            success: true,
            data: formatted
        });
    } catch (error) {
        writeDevLog('webhook', {
            file: 'notificationController.js',
            error: error.message
        });
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

async function _resolvePosContext(notification, companyId = null) {
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

    // Fallback to MID-only matching for Paytm
    const source = notification.source || '';
    if (!posMachine && source.includes('paytm')) {
        const fallbackMid = await PosMachine.findOne({
            where: {
                status: 'active',
                mid_number: { [Op.in]: midCandidates }
            }
        });
        if (fallbackMid) {
            posMachine = fallbackMid;
            matchedMid = fallbackMid.mid_number;
            matchedTid = fallbackMid.tid_number;
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

    const updatePayload = { pos_machine_id: posMachine.id, user_id: posOperator.id };
    if (companyId) {
        updatePayload.company_id = companyId;
    }
    await notification.update(updatePayload);

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
        classificationFromJson: extractCardClassification(eventData),
        rrNumber: notification.rr_number || eventData.rrNumber || null,
        customerName: eventData.customerName || null
    };
}

async function adminProcessNotification(req, res) {
    try {
        const companyId = req.company;

        if(!companyId){
            console.log(`UserId --> ${req.user.id} :: Domain is not registered`);
            return res.status(400).json({message : "No Domain Name is registered"});
        }

        const userRole = String(req.user?.role || '').trim().toLowerCase();
        if (!req.user || (userRole !== 'admin' && userRole !== 'super_admin' && userRole !== 'superadmin')) {
            res.status(403).json({ success: false, message: 'Admin or Super Admin role required' });
            return;
        }

        const { id } = req.params;
        const notification = await RazorpayNotification.findByPk(id);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        // Whitelabel admins cannot process notifications belonging to another company
        if (userRole === 'admin' && notification.company_id && notification.company_id !== companyId) {
            return res.status(403).json({ success: false, message: 'Unauthorized: This notification does not belong to your company' });
        }

        if (notification.processing_status === 'completed') {
            return res.status(400).json({ success: false, message: 'Notification already processed' });
        }

        await notification.update({ company_id: companyId });

        await handleAuthorizedTransaction(notification.txn_id, notification.event_json, notification);

        const reloaded = await RazorpayNotification.findByPk(id);
        return res.status(200).json({ success: true, message: 'Notification processed by admin', notification: reloaded });
    } catch (error) {
        writeDevLog('webhook', {
            file: 'notificationController.js',
            error: error.message
        });
        console.error('adminProcessNotification error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error processing notification' });
    }
}

async function adminProcessNotificationWithCustomCharge(req, res) {
    try {
        const userRole = String(req.user?.role || '').trim().toLowerCase();
        const isSuperAdmin = userRole === 'super_admin' || userRole === 'superadmin';
        const isAdmin = userRole === 'admin';

        if (!req.user || (!isAdmin && !isSuperAdmin)) {
            res.status(403).json({ success: false, message: 'Admin or Super Admin role required' });
            return;
        }

        const { id } = req.params;
        const { charge_percent, charge_flat } = req.body;

        const parsedPercent = charge_percent !== undefined && charge_percent !== null && charge_percent !== '' ? parseFloat(charge_percent) : null;
        const parsedFlat = charge_flat !== undefined && charge_flat !== null && charge_flat !== '' ? parseFloat(charge_flat) : null;

        if ((parsedPercent === null || Number.isNaN(parsedPercent)) && (parsedFlat === null || Number.isNaN(parsedFlat))) {
            return res.status(400).json({ success: false, message: 'charge_percent or charge_flat must be provided' });
        }
        if ((parsedPercent !== null && parsedPercent < 0) || (parsedFlat !== null && parsedFlat < 0)) {
            return res.status(400).json({ success: false, message: 'Charge values cannot be negative' });
        }

        const notification = await RazorpayNotification.findByPk(id);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        if (notification.processing_status === 'completed') {
            return res.status(400).json({ success: false, message: 'Notification already processed' });
        }

        const companyId = req.company || notification.company_id || req.user?.company_id || null;

        // Whitelabel admins cannot process notifications belonging to another company
        if (isAdmin && notification.company_id && notification.company_id !== companyId) {
            return res.status(403).json({ success: false, message: 'Unauthorized: This notification does not belong to your company' });
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
        } = await _resolvePosContext(notification, companyId);

        const existingCharge = await MerchantTransactionCharge.findOne({ where: { razorpay_transaction_id: notification.txn_id } });
        if (existingCharge) {
            return res.status(400).json({ success: false, message: 'Merchant transaction charge already exists for this notification' });
        }

        const isNormalEmi = (String(eventData?.externalRefNumber6 || '').trim().toUpperCase() === 'NORMAL_EMI' || 
                             String(eventData?.externalRefNumber7 || '').trim().toUpperCase() === 'NORMAL_EMI');

        const effectiveChargePercent = parsedPercent || 0;
        const effectiveChargeFlat = parsedFlat || 0;
        const chargeRuleStub = {
            charge_percent: effectiveChargePercent,
            charge_flat: effectiveChargeFlat,
            gst_required: false,
            gst_percent: 0
        };

        const chargeResult = ChargeService.calculateCharge(transactionAmount, chargeRuleStub);
        const chargeAmount = chargeResult.charge;
        const gstAmount = chargeResult.gstAmount || 0;
        const netAmount = parseFloat((transactionAmount - chargeAmount - gstAmount).toFixed(2));

        const effectiveCompanyId = posOperator.company_id || companyId || null;
        const companyName = posMachine ? posMachine.company_name : null;

        // ── Hierarchy Resolution & Rate Lookup (Upfront) ──────────────────────
        // 1. Super franchise resolution
        let superFranchiseChargeAmount = 0;
        let superFranchiseEarning = 0;
        let resolvedSuperFranchiseId = null;
        if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
            const franchiseUser = await User.findByPk(posOperator.franchaise_id);
            resolvedSuperFranchiseId = franchiseUser ? franchiseUser.super_franchise_id : null;
        } else if ((posOperator.role === 'franchaise' || posOperator.role === 'franchise') && posOperator.super_franchise_id) {
            resolvedSuperFranchiseId = posOperator.super_franchise_id;
        }

        // 2. Franchise handling
        let franchiseChargeAmount = 0;
        let franchiseEarning = 0;
        let franchiseRatePercent = 0;

        if (posOperator.role === 'merchant' && posOperator.franchaise_id) {
            let franchiseRule = await ChargeService.getAdminChargeRuleForFranchise({
                franchiseId: posOperator.franchaise_id,
                superFranchiseId: resolvedSuperFranchiseId,
                companyId: effectiveCompanyId,
                paymentMode,
                cardType: paymentCardType,
                cardBrand: paymentCardBrand,
                classification: classificationFromJson,
                settlement: posOperator.settlement_type || null,
                amount: transactionAmount,
                companyName
            });

            if (franchiseRule && isNormalEmi) {
                franchiseRule = { ...franchiseRule, charge_percent: parseFloat(franchiseRule.charge_percent || 0) + 1 };
            }

            if (franchiseRule) {
                franchiseChargeAmount = ChargeService.calculateCharge(transactionAmount, franchiseRule).charge;
                franchiseRatePercent = parseFloat(franchiseRule.charge_percent || 0);
            } else {
                let defaultMdr = 2.5 + (isNormalEmi ? 1 : 0);
                franchiseChargeAmount = parseFloat((transactionAmount * (defaultMdr / 100)).toFixed(2));
                franchiseRatePercent = defaultMdr;
            }
            franchiseEarning = Math.max(0, parseFloat((chargeAmount - franchiseChargeAmount).toFixed(2)));
        }

        // 3. Super Franchise handling
        let sfRatePercent = 0;
        if (resolvedSuperFranchiseId) {
            let sfRule = await ChargeService.getAdminChargeRuleForSuperFranchise({
                superFranchiseId: resolvedSuperFranchiseId,
                companyId: effectiveCompanyId,
                paymentMode,
                cardType: paymentCardType,
                cardBrand: paymentCardBrand,
                classification: classificationFromJson,
                settlement: posOperator.settlement_type || null,
                amount: transactionAmount,
                companyName
            });

            if (sfRule && isNormalEmi) {
                sfRule = { ...sfRule, charge_percent: parseFloat(sfRule.charge_percent || 0) + 1 };
            }

            if (sfRule) {
                superFranchiseChargeAmount = ChargeService.calculateCharge(transactionAmount, sfRule).charge;
                sfRatePercent = parseFloat(sfRule.charge_percent || 0);
            } else {
                let defaultMdr = 2.5 + (isNormalEmi ? 1 : 0);
                superFranchiseChargeAmount = parseFloat((transactionAmount * (defaultMdr / 100)).toFixed(2));
                sfRatePercent = defaultMdr;
            }
            const upwardToSF = posOperator.franchaise_id ? franchiseChargeAmount : chargeAmount;
            superFranchiseEarning = Math.max(0, parseFloat((upwardToSF - superFranchiseChargeAmount).toFixed(2)));
        }

        // 4. Admin handling & Super Admin base cost
        let adminUser = null;
        let adminCostAmount = 0;
        let adminCostPercent = 0;
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
        if (!adminUser && effectiveCompanyId) {
            adminUser = await User.findOne({
                where: { role: 'admin', company_id: effectiveCompanyId }
            });
        }

        if (adminUser) {
            let adminRule = await ChargeService.getSuperAdminChargeRuleForAdmin({
                adminId: adminUser.id,
                paymentMode,
                cardType: paymentCardType,
                cardBrand: paymentCardBrand,
                classification: classificationFromJson,
                settlement: posOperator.settlement_type || null,
                amount: transactionAmount,
                companyName
            });

            if (adminRule && isNormalEmi) {
                adminRule = { ...adminRule, charge_percent: parseFloat(adminRule.charge_percent || 0) + 1 };
            }

            if (adminRule) {
                adminCostAmount = ChargeService.calculateCharge(transactionAmount, adminRule).charge;
                adminCostPercent = parseFloat(adminRule.charge_percent || 0);
            } else {
                let defaultMdr = 2.5 + (isNormalEmi ? 1 : 0);
                adminCostAmount = parseFloat((transactionAmount * (defaultMdr / 100)).toFixed(2));
                adminCostPercent = defaultMdr;
            }
            adminEarning = Math.max(0, parseFloat((paidUpwardToAdmin - adminCostAmount).toFixed(2)));
        }

        // 5. Floor Rate Validation: Whitelabel Admin cannot undercut Super Admin base cost or Franchise rate
        if (isAdmin) {
            if (adminCostAmount > 0 && chargeAmount < adminCostAmount) {
                return res.status(400).json({
                    success: false,
                    message: `Custom charge (₹${chargeAmount}) cannot be less than Super Admin base cost (₹${adminCostAmount} / ${adminCostPercent}%).`
                });
            }

            if (posOperator.franchaise_id && franchiseChargeAmount > 0 && chargeAmount < franchiseChargeAmount) {
                return res.status(400).json({
                    success: false,
                    message: `Custom charge (₹${chargeAmount}) cannot be less than Franchise rate (₹${franchiseChargeAmount} / ${franchiseRatePercent}%).`
                });
            }
        }

        // ── Database & Ledger Persistence ────────────────────────────────────
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
            processing_error: null,
            company_id: effectiveCompanyId,
        });

        await ledgerService.createRazorpayChargeEntry({
            userId: posOperator.id,
            razorpayTransactionId: notification.txn_id,
            transactionAmount: transactionAmount,
            chargeAmount: chargeAmount,
            gstAmount: gstAmount,
            netAmount: netAmount,
            merchantTransactionChargeId: merchantTransactionCharge.id,
            description: `Admin-adjusted Razorpay txn ${notification.txn_id}`,
            metadata: {
                razorpay_notification_id: notification.id,
                payment_method: paymentMode,
                charge_rate: effectiveChargePercent,
                charge_flat: effectiveChargeFlat,
                gst_amount: gstAmount,
                gst_percent: 0,
                pos_machine_id: posMachine.id,
                mid_number: merchantId.toString(),
                tid_number: terminalId.toString(),
                merchant_id: posOperator.id,
                customer_name: customerName
            }
        });

        if (posOperator.role === 'merchant' && posOperator.franchaise_id && franchiseEarning > 0) {
            try {
                await ledgerService.createFranchiseEarningEntry({
                    userId: posOperator.franchaise_id,
                    razorpayTransactionId: notification.txn_id,
                    amount: franchiseEarning,
                    description: `Franchise earning on Razorpay txn ${notification.txn_id} | RRN: ${rrNumber || 'N/A'}`,
                    metadata: {
                        merchant_id: posOperator.id,
                        transaction_amount: transactionAmount,
                        charge_amount: chargeAmount,
                        franchise_charge: franchiseChargeAmount,
                        charge_rate: effectiveChargePercent
                    }
                });
            } catch (earnError) {
                console.error('[adminProcessNotificationWithCustomCharge] Franchise earning entry failed:', earnError);
                writeDevLog('webhook', {
                    file: 'notificationController.js',
                    error: earnError.message
                });
            }
        }

        // Super franchise earning credit
        if (resolvedSuperFranchiseId && superFranchiseEarning > 0) {
            try {
                await ledgerService.createSuperFranchiseEarningEntry({
                    userId: resolvedSuperFranchiseId,
                    razorpayTransactionId: notification.txn_id,
                    amount: superFranchiseEarning,
                    description: `SF earning on Razorpay txn ${notification.txn_id} | RRN: ${rrNumber || 'N/A'}`,
                    metadata: {
                        merchant_id: posOperator.id,
                        franchise_id: posOperator.franchaise_id || posOperator.id,
                        transaction_amount: transactionAmount,
                        charge_amount: chargeAmount,
                        franchise_charge: franchiseChargeAmount,
                        super_franchise_charge: superFranchiseChargeAmount,
                        charge_rate: effectiveChargePercent
                    }
                });
            } catch (earnError) {
                console.error('[adminProcessNotificationWithCustomCharge] Super franchise earning entry failed:', earnError);
                writeDevLog('webhook', {
                    file: 'notificationController.js',
                    error: earnError.message
                });
            }
        }

        // Admin earning credit
        if (adminUser && adminEarning > 0) {
            try {
                await ledgerService.createAdminEarningEntry({
                    userId: adminUser.id,
                    razorpayTransactionId: notification.txn_id,
                    amount: adminEarning,
                    description: `Admin earning on Razorpay txn ${notification.txn_id} | RRN: ${rrNumber || 'N/A'}`,
                    metadata: {
                        merchant_id: posOperator.id,
                        franchise_id: posOperator.franchaise_id || null,
                        super_franchise_id: resolvedSuperFranchiseId || null,
                        admin_id: adminUser.id,
                        transaction_amount: transactionAmount,
                        charge_amount: chargeAmount,
                        admin_cost: adminCostAmount,
                        admin_earning: adminEarning,
                        charge_rate: effectiveChargePercent
                    }
                });
            } catch (earnError) {
                writeDevLog('webhook', {
                    file: 'notificationController.js',
                    error: earnError.message
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Notification processed with custom charge',
            data: {
                notification: await RazorpayNotification.findByPk(id),
                merchantTransactionCharge,
                breakdown: {
                    transactionAmount,
                    merchantCharge: chargeAmount,
                    merchantNet: netAmount,
                    franchiseEarning,
                    superFranchiseEarning,
                    adminEarning,
                    superAdminShare: adminCostAmount
                }
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
                        processed_at: new Date(),
                        company_id : companyId,
                    });
                }
            }
        } catch (secondaryErr) {
            console.error('Failed to update notification status after error:', secondaryErr);
        }

        return res.status(500).json({ success: false, message: error.message || 'Error processing notification' });
    }
}

/**
 * Replay missed Razorpay notifications to api.abheepay.com
 * Admin only — reads event_json from DB and forwards each to the API endpoint.
 *
 * Query params:
 *   from  – ISO datetime (default: yesterday 6:34 PM IST)
 *   to    – ISO datetime (default: now)
 *   dryRun – 'true' to only count, not forward
 */
async function replayNotificationsToApi(req, res) {
    try {
        const userRole = String(req.user?.role || '').trim().toLowerCase();
        if (userRole !== 'super_admin' && userRole !== 'superadmin') {
            return res.status(403).json({ success: false, message: 'Super Admin role required' });
        }

        // Default window: 2026-09-12 18:34:00 IST → now
        const DEFAULT_FROM = new Date('2026-09-12T13:04:00.000Z'); // 18:34 IST = 13:04 UTC
        const DEFAULT_TO   = new Date();

        const from   = req.query.from   ? new Date(req.query.from)   : DEFAULT_FROM;
        const to     = req.query.to     ? new Date(req.query.to)     : DEFAULT_TO;
        const dryRun = req.query.dryRun === 'true';

        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid from/to date format. Use ISO 8601.' });
        }

        // Fetch all notifications in the window
        const notifications = await RazorpayNotification.findAll({
            where: {
                createdAt: { [Op.between]: [from, to] }
            },
            order: [['createdAt', 'ASC']]
        });

        if (dryRun) {
            return res.status(200).json({
                success: true,
                dryRun: true,
                from: from.toISOString(),
                to: to.toISOString(),
                count: notifications.length,
                txnIds: notifications.map(n => ({ id: n.id, txn_id: n.txn_id, source: n.source, createdAt: n.createdAt }))
            });
        }

        let forwarded = 0;
        let skipped   = 0;
        const errors  = [];

        for (const notif of notifications) {
            try {
                const body = typeof notif.event_json === 'string'
                    ? JSON.parse(notif.event_json)
                    : notif.event_json;

                if (!body) { skipped++; continue; }

                // Determine forward URL based on source
                const src = notif.source || 'agro_axis';
                const forwardUrl = (src === WEBHOOK_SOURCES.EVERLIFE || src === 'everlife')
                    ? 'https://api.abheepay.com/api/razorpay-notifications/webhook/everlife'
                    : 'https://api.abheepay.com/api/razorpay-notifications/webhook';

                await axios.post(forwardUrl, body, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 8000
                });

                forwarded++;
            } catch (err) {
                errors.push({ id: notif.id, txn_id: notif.txn_id, error: err.message });
            }
        }

        return res.status(200).json({
            success: true,
            from: from.toISOString(),
            to: to.toISOString(),
            total: notifications.length,
            forwarded,
            skipped,
            errors
        });

    } catch (error) {
        writeDevLog('webhook', {
            file: 'notificationController.js',
            error: error.message
        });
        console.error('[replayNotificationsToApi] Error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Internal error' });
    }
}

module.exports = { 
    handleRzpNotification,
    listNotifications,
    getNotificationById,
    adminProcessNotification,
    adminProcessNotificationWithCustomCharge,
    replayNotificationsToApi
};
