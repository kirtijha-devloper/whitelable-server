const asyncHandler = require("express-async-handler");
const { processRzpNotification } = require("../../../services/razorpay/webhookService");
const RazorpayNotification = require("../../../models/RazorpayNotification");
const { Op } = require("sequelize");

async function handleRzpNotification(req, res) {
    try {
        const body = req.body;
        
        // Razorpay requires 200 OK IMMEDIATELY (no slow operations)
        // Return XML response as Razorpay expects text/xml format
        res.status(200)
           .set('Content-Type', 'text/xml; charset=utf-8')
           .send('<?xml version="1.0" encoding="UTF-8"?><response><status>OK</status></response>');
        
        // Process in background AFTER response is sent
        // Using setImmediate ensures response is sent first, then processing starts
        setImmediate(async () => {
            try {
                await processRzpNotification(body);
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

        // Check if we need to filter by JSON fields (mid, tid, paymentMode)
        const hasJsonFilters = mid || tid || paymentMode || deviceSerial;
        
        let formattedNotifications = [];
        let totalCount = 0;

        if (hasJsonFilters) {
            // For JSON filters, fetch a larger batch, filter in memory, then paginate
            // Note: For production with large datasets, consider adding indexed columns
            const { count, rows: allNotifications } = await RazorpayNotification.findAndCountAll({
                where,
                limit: 1000, // Fetch up to 1000 records for filtering
                offset: 0,
                order: [['createdAt', 'DESC']]
            });

            // Format and filter notifications
            const filtered = allNotifications.map((notification) => {
                const eventData = typeof notification.event_json === 'string' 
                    ? JSON.parse(notification.event_json) 
                    : notification.event_json;

                // Apply JSON field filters
                if (mid && eventData.mid?.toString() !== mid.toString()) {
                    return null;
                }
                if (tid && eventData.tid?.toString() !== tid.toString()) {
                    return null;
                }
                if (paymentMode && eventData.paymentMode !== paymentMode) {
                    return null;
                }
                if (deviceSerial && eventData.deviceSerial?.toString() !== deviceSerial.toString()) {
                    return null;
                }

                // Extract relevant fields from event_json
                return {
                    id: notification.id,
                    txn_id: notification.txn_id,
                    status: notification.status,
                    createdAt: notification.createdAt,
                    updatedAt: notification.updatedAt,
                    amount: eventData.amount || null,
                    amountOriginal: eventData.amountOriginal || null,
                    currencyCode: eventData.currencyCode || null,
                    mid: eventData.mid || null,
                    tid: eventData.tid || null,
                    deviceSerial: eventData.deviceSerial || null,
                    paymentMode: eventData.paymentMode || null,
                    paymentCardType: eventData.paymentCardType || null,
                    paymentCardBrand: eventData.paymentCardBrand || null,
                    customerName: eventData.customerName || null,
                    payerName: eventData.payerName || null,
                    settlementStatus: eventData.settlementStatus || null,
                    postingDate: eventData.postingDate || null,
                    rrNumber: eventData.rrNumber || null,
                    txnType: eventData.txnType || null,
                    orderId: eventData.orderId || null,
                    event_json: eventData,
                };
            }).filter(item => item !== null);

            totalCount = filtered.length;
            
            // Apply pagination
            const startIndex = parseInt(offset);
            const endIndex = startIndex + parseInt(limit);
            formattedNotifications = filtered.slice(startIndex, endIndex);
        } else {
            // Normal pagination without JSON filters
            const { count, rows: notifications } = await RazorpayNotification.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset: parseInt(offset),
                order: [['createdAt', 'DESC']]
            });

            totalCount = count;

            // Format notifications
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
                    amount: eventData.amount || null,
                    amountOriginal: eventData.amountOriginal || null,
                    currencyCode: eventData.currencyCode || null,
                    mid: eventData.mid || null,
                    tid: eventData.tid || null,
                    deviceSerial: eventData.deviceSerial || null,
                    paymentMode: eventData.paymentMode || null,
                    paymentCardType: eventData.paymentCardType || null,
                    paymentCardBrand: eventData.paymentCardBrand || null,
                    customerName: eventData.customerName || null,
                    payerName: eventData.payerName || null,
                    settlementStatus: eventData.settlementStatus || null,
                    postingDate: eventData.postingDate || null,
                    rrNumber: eventData.rrNumber || null,
                    txnType: eventData.txnType || null,
                    orderId: eventData.orderId || null,
                    event_json: eventData
                };
            });
        }

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
