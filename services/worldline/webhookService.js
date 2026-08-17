const WorldlineNotification = require("../../models/WorldlineNotification");
const worldlineWebhookQueue = require("../../queues/worldlineWebhookQueue");

/**
 * Process incoming Worldline webhook notification
 * Step 1: Store/Upsert notification in DB
 * Step 2: Enqueue background job to worldlineWebhookQueue
 */
async function processWorldlineNotification(event, source = 'worldline') {
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
        const txnId = rrn || (urn && tid ? `${tid}-${urn}` : null) || `WL-${tid || 'UNK'}-${Date.now()}`;
        const status = event.status || 'unknown';
        const rawAmount = event.amount != null ? parseFloat(event.amount) : 0;

        console.log("[Worldline Webhook Service] New Worldline Notification:", {
            txnId,
            rrn,
            status,
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
            source: source
        };

        const [notification, created] = await WorldlineNotification.findOrCreate({
            where: { txn_id: txnId },
            defaults
        });

        if (!created) {
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
                processed_at: null
            });
        }

        console.log(`[Worldline Webhook Service] Notification ${created ? 'created' : 'updated'}: ${txnId}`);

        try {
            await worldlineWebhookQueue.add(
                {
                    txnId,
                    status,
                    event,
                    notificationId: notification.id
                },
                {
                    jobId: `wl-webhook-${txnId}`,
                    priority: (status.toLowerCase() === 'failed') ? 10 : 5
                }
            );

            console.log(`[Worldline Webhook Service] ✅ Enqueued business logic processing for txn: ${txnId}`);
        } catch (queueError) {
            console.error(`[Worldline Webhook Service] ⚠️ Failed to enqueue job for txn: ${txnId}`, queueError);
        }

        return notification;
    } catch (error) {
        console.error("[Worldline Webhook Service] ❌ Failed to process notification:", error);
    }
}

module.exports = { processWorldlineNotification };
