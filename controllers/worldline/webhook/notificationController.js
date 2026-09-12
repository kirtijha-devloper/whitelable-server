const asyncHandler = require("express-async-handler");
const fs = require("fs");
const path = require("path");
const { processWorldlineNotification } = require("../../../services/worldline/webhookService");
const WorldlineNotification = require("../../../models/WorldlineNotification");
const { Op } = require("sequelize");

// Minimal file logger for incoming Worldline webhook notifications
const LOG_DIR = path.join(__dirname, "../../../logs");
const LOG_FILE = path.join(LOG_DIR, "worldlineNotifications.log");

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logWorldlineNotification(body) {
    try {
        const ts   = new Date().toISOString();
        const txn  = body.rrn || body.urn || body.billing_number || '-';
        const amt  = body.amount || '-';
        const mid  = body.mid || '-';
        const tid  = body.tid || '-';
        const stat = body.status || '-';
        const source = body.source || 'worldline';
        const raw  = JSON.stringify(body);
        const line = `[${ts}] source=${source} rrn/txnId=${txn} status=${stat} amount=${amt} mid=${mid} tid=${tid} raw=${raw}\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch (_) { /* ignore log write errors */ }
}

/**
 * Worldline Type-3 Webhook endpoint (SendTransactionResponseAPI)
 * Responds immediately with JSON { tid, urn, message: "success" }
 * and processes business logic asynchronously.
 */
async function handleWorldlineNotification(req, res) {
    try {
        const body = req.body || {};

        // Log notification immediately upon receipt
        logWorldlineNotification(body);

        const responseTid = body.tid || "";
        const responseUrn = body.urn || body.billing_number || "";

        // Worldline Retail Integration API Type 3 expected acknowledgment:
        // { "tid": "2206047M", "urn": "205", "message": "success" }
        res.status(200).json({
            tid: responseTid,
            urn: responseUrn,
            message: "success"
        });

        // Background processing after HTTP response sent
        setImmediate(async () => {
            try {
                const source = body.source || req.headers['x-source'] || 'worldline';
                await processWorldlineNotification(body, source);
            } catch (bgErr) {
                console.error("[Worldline Webhook Controller] Background processing error:", bgErr);
            }
        });

    } catch (err) {
        console.error("[Worldline Webhook Controller] Error handling webhook:", err);
        return res.status(200).json({
            tid: (req.body && req.body.tid) || "",
            urn: (req.body && (req.body.urn || req.body.billing_number)) || "",
            message: "success"
        });
    }
}

/**
 * List Worldline webhook notifications with pagination & filters
 */
const listNotifications = asyncHandler(async (req, res) => {
    try {
        if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'employee')) {
            return res.status(403).json({
                success: false,
                message: 'Admin or employee role required'
            });
        }

        const {
            status,
            rrn,
            txn_id,
            mid,
            tid,
            startDate,
            endDate,
            page = 1,
            limit = 10
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const where = {};

        if (status) where.status = status;
        if (rrn) where.rrn = { [Op.like]: `%${rrn}%` };
        if (txn_id) where.txn_id = { [Op.like]: `%${txn_id}%` };
        if (mid) where.mid = { [Op.like]: `%${mid}%` };
        if (tid) where.tid = { [Op.like]: `%${tid}%` };

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

        const { count, rows: notifications } = await WorldlineNotification.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            success: true,
            message: 'Worldline notifications retrieved successfully',
            data: notifications,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('List Worldline notifications error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong'
        });
    }
});

/**
 * Get single Worldline notification by ID
 */
const getNotificationById = asyncHandler(async (req, res) => {
    try {
        if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'employee')) {
            return res.status(403).json({
                success: false,
                message: 'Admin or employee role required'
            });
        }

        const { id } = req.params;
        const notification = await WorldlineNotification.findByPk(id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.status(200).json({
            success: true,
            data: notification
        });
    } catch (error) {
        console.error('Get Worldline notification error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Something went wrong'
        });
    }
});

/**
 * Admin manual retry/processing for Worldline notification
 */
const adminProcessNotification = asyncHandler(async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin role required'
            });
        }

        const { id } = req.params;
        const notification = await WorldlineNotification.findByPk(id);

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        await processWorldlineNotification(notification.event_json, 'worldline_admin');
        const reloaded = await WorldlineNotification.findByPk(id);

        res.status(200).json({
            success: true,
            message: 'Worldline notification queued for processing by admin',
            data: reloaded
        });
    } catch (error) {
        console.error('adminProcessWorldlineNotification error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error processing notification'
        });
    }
});

module.exports = {
    handleWorldlineNotification,
    listNotifications,
    getNotificationById,
    adminProcessNotification
};
