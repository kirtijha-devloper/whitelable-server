const WorldlineNotification = require("../../models/WorldlineNotification");
const worldlineWebhookQueue = require("../../queues/worldlineWebhookQueue");

/**
 * Process incoming Worldline webhook notification
 * Step 1: Store/Upsert notification in DB
 * Step 2: Enqueue background job to worldlineWebhookQueue (with direct execution fallback)
 */
async function processWorldlineNotification(event, source = 'worldline', companyId = null) {
    try {
        if (!event || typeof event !== 'object') {
            console.error("[Worldline Webhook Service] ❌ Invalid event data:", event);
            return;
        }

        event.source = source;

        // Unique transaction identifier: rrn is mandatory in Worldline Type-3 spec
        const rrn = event.rrn || event.rr_number || null;
        const urn = event.urn || event.billing_number || null;
        const tid = event.tid || null;
        const mid = event.mid || null;
        const rawAmount = event.amount != null ? parseFloat(event.amount) : 0;

        // Auto-detect / normalize status:
        // Worldline uses resp_code "00" for success, or explicit status "success"/"approved"
        const respCode = event.resp_code || event.response_code || event.responseCode || null;
        let status = event.status ? String(event.status).toLowerCase() : null;
        if (!status) {
            if (respCode === '00' || respCode === '0' || respCode === 0) {
                status = 'success';
            } else if (respCode && respCode !== '00' && respCode !== '0') {
                status = 'failed';
            } else {
                status = rawAmount > 0 ? 'success' : 'unknown';
            }
        }

        const txnId = rrn || (urn && tid ? `${tid}-${urn}` : null) || `WL-${tid || 'UNK'}-${Date.now()}`;

        console.log("[Worldline Webhook Service] New Worldline Notification:", {
            txnId,
            rrn,
            status,
            resp_code: respCode,
            amount: rawAmount,
            card_scheme: event.card_scheme,
            mid,
            tid,
            txn_date: event.txn_date,
            txn_time: event.txn_time
        });

        const defaults = {
            txn_id: txnId,
            rrn: rrn,
            mid: mid,
            tid: tid,
            amount: rawAmount,
            status: status,
            card_scheme: event.card_scheme || null,
            txn_date: event.txn_date || null,
            txn_time: event.txn_time || null,
            masked_card_number: event.masked_card_number || null,
            txn_type: event.txn_type || null,
            app_code: event.app_code || null,
            urn: urn,
            billing_number: event.billing_number || null,
            event_json: event,
            source: source,
            company_id: companyId
        };

        const [notification, created] = await WorldlineNotification.findOrCreate({
            where: { txn_id: txnId },
            defaults
        });

        if (!created) {
            const prevTransactionStatus = notification.status;
            if(prevTransactionStatus && prevTransactionStatus.toLowerCase() === 'success' && status.toLowerCase() === 'failed') {
                console.warn(`[Worldline Webhook Service] ⚠️ Received a failed notification for an already successful transaction (txnId: ${txnId}). Ignoring update to prevent overwriting success status.`);
                return notification;
            }
            await notification.update({
                rrn: rrn,
                mid: mid,
                tid: tid,
                amount: rawAmount,
                status: status,
                card_scheme: event.card_scheme || notification.card_scheme,
                txn_date: event.txn_date || notification.txn_date,
                txn_time: event.txn_time || notification.txn_time,
                masked_card_number: event.masked_card_number || notification.masked_card_number,
                txn_type: event.txn_type || notification.txn_type,
                app_code: event.app_code || notification.app_code,
                urn: urn,
                billing_number: event.billing_number || notification.billing_number,
                event_json: event,
                source: source,
                processed: false,
                processing_status: 'pending',
                processing_error: null,
                processed_at: null,
                ...(companyId ? { company_id: companyId } : {})
            });
        }

        console.log(`[Worldline Webhook Service] Notification ${created ? 'created' : 'updated'}: ${txnId}`);

        try {
            const queueJobId = `wl-webhook-${txnId}-${Date.now()}`;
            await worldlineWebhookQueue.add(
                {
                    txnId,
                    status,
                    event,
                    notificationId: notification.id
                },
                {
                    jobId: queueJobId,
                    removeOnComplete: true,
                    priority: (status.toLowerCase() === 'failed') ? 10 : 5
                }
            );

            console.log(`[Worldline Webhook Service] ✅ Enqueued job ${queueJobId} for txn: ${txnId}`);
        } catch (queueError) {
            console.error(`[Worldline Webhook Service] ⚠️ Failed to enqueue job for txn: ${txnId} (${queueError.message}). Executing fallback directly...`);
            try {
                const { processWorldlineJob } = require("../../workers/worldlineWebhookWorker");
                if (typeof processWorldlineJob === 'function') {
                    setImmediate(async () => {
                        try {
                            await processWorldlineJob({
                                txnId,
                                status,
                                event,
                                notificationId: notification.id
                            }, `direct-${Date.now()}`);
                        } catch (directErr) {
                            console.error(`[Worldline Webhook Service] Direct processing failed:`, directErr);
                        }
                    });
                }
            } catch (fallbackErr) {
                console.error(`[Worldline Webhook Service] Fallback direct worker load failed:`, fallbackErr);
            }
        }

        return notification;
    } catch (error) {
        console.error("[Worldline Webhook Service] ❌ Failed to process notification:", error);
    }
}

module.exports = { processWorldlineNotification };
