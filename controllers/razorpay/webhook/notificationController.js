const asyncHandler = require("express-async-handler");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { processRzpNotification } = require("../../../services/razorpay/webhookService");
const RazorpayNotification = require("../../../models/RazorpayNotification");
const { Op } = require("sequelize");

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
                // Do not await this response so we don't delay the webhook handling.
                axios.post(
                    "https://api.abheepay.com/api/razorpay-notifications/webhook",
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
                where.createdAt[Op.gte] = new Date(startDate);
            }
            if (endDate) {
                where.createdAt[Op.lte] = new Date(endDate);
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

module.exports = { 
    handleRzpNotification,
    listNotifications,
    getNotificationById
};
