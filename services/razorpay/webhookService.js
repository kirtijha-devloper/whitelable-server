const RazorpayNotification = require("../../models/RazorpayNotification.js");
const razorpayWebhookQueue = require("../../queues/razorpayWebhookQueue.js");

/**
 * Process Razorpay webhook notification
 * 
 * Step 1: Store notification in database first (idempotent)
 * Step 2: Enqueue business logic processing in background queue
 * 
 * This ensures:
 * - Data is persisted immediately (even if queue fails)
 * - Business logic runs asynchronously (non-blocking)
 * - Production-ready with retries and error handling
 */
async function processRzpNotification(event, source = 'agro') {
    try {
        // tag the incoming payload so downstream code and logs can see where it came from
        if (event && typeof event === 'object') {
            event.source = source;
        }

        // Extract txnId - can be in txnId or Id field (handle both cases)
        const txnId = event.txnId || event.Id || event.id;
        const status = event.status; // AUTHORIZED, FAILED, VOIDED, SETTLED etc.

        if (!txnId) {
            console.error("[Webhook Service] ❌ Missing txnId in event data:", JSON.stringify(event));
            return; // Exit early if no transaction ID
        }

        console.log("[Webhook Service] New Razorpay Notification:", {
            txnId,
            status,
            amount: event.amount,
            paymentMode: event.paymentMode,
            mid: event.mid,
            tid: event.tid,
            // Note: customerEmail may not be available if entered after transaction approval
            customerName: event.customerName,
            customerEmail: event.customerEmail || 'N/A (may be entered after approval)',
            paymentCardBrand: event.paymentCardBrand,
            walletProvider: event.walletProvider
        });

        /**
         * Step 1 — Store in DB with upsert to avoid duplicates
         * Razorpay retries up to 3 times, so we use findOrCreate
         * This MUST complete before enqueueing to ensure data persistence
         */
        // extract fields we'll store directly on the row for reporting
        const midVal = event.mid || event.mid_number || null;
        const tidVal = event.tid || event.tid_number || null;
        const amountVal = event.amount || event.amountOriginal || null;
        const currencyVal = event.currencyCode || null;
        const paymentModeVal = event.paymentMode || null;
        const cardTypeVal = event.paymentCardType || null;
        const cardBrandVal = event.paymentCardBrand || null;
        const rrVal = event.rrNumber || null;
        const deviceSerialVal = event.deviceSerial || null;
        const postingDateVal = event.postingDate ? new Date(event.postingDate) : null;

        const defaults = {
            txn_id: txnId,
            event_json: event,
            status: status || null,
            source: source || 'agro',
            mid: midVal,
            tid: tidVal,
            amount: amountVal,
            currency_code: currencyVal,
            payment_mode: paymentModeVal,
            payment_card_type: cardTypeVal,
            payment_card_brand: cardBrandVal,
            rr_number: rrVal,
            device_serial: deviceSerialVal,
            posting_date: postingDateVal
        };

        const [notification, created] = await RazorpayNotification.findOrCreate({
            where: { txn_id: txnId },
            defaults
        });

        // If notification already exists, update it (in case of retry with updated data).
        // Any update resets the processed flag so the worker can re-run, and clears
        // any previous error/status note.
        if (!created) {
            await notification.update({
                event_json: event,
                status: status || notification.status,
                source: source || notification.source,
                mid: midVal,
                tid: tidVal,
                amount: amountVal,
                currency_code: currencyVal,
                payment_mode: paymentModeVal,
                payment_card_type: cardTypeVal,
                payment_card_brand: cardBrandVal,
                rr_number: rrVal,
                device_serial: deviceSerialVal,
                posting_date: postingDateVal,
                processed: false,
                processing_status: 'pending',
                processing_error: null,
                processed_at: null
            });
        }

        console.log(`[Webhook Service] Notification ${created ? 'created' : 'updated'}:`, txnId);

        /**
         * Step 2 — Enqueue business logic processing
         * This runs asynchronously in a separate worker process
         * The queue handles retries, failures, and monitoring
         */
        try {
            await razorpayWebhookQueue.add(
                {
                    txnId,
                    status,
                    event,
                    notificationId: notification.id,
                },
                {
                    // Job ID based on txnId for idempotency
                    // If same txnId is enqueued again, it will be deduplicated
                    jobId: `rzp-webhook-${txnId}`,
                    // Priority: higher priority for critical statuses
                    priority: status === "FAILED" ? 10 : status === "AUTHORIZED" ? 5 : 1,
                }
            );

            console.log(`[Webhook Service] ✅ Enqueued business logic processing for txn: ${txnId}`);
        } catch (queueError) {
            // Log queue error but don't throw - data is already stored
            console.error(`[Webhook Service] ⚠️ Failed to enqueue job for txn: ${txnId}`, queueError);
            // In production, you might want to send an alert here
        }

    } catch (error) {
        console.error("[Webhook Service] ❌ Failed to process notification", error);
        // Don't throw - we already sent 200 OK to Razorpay
        // The error is logged for monitoring/debugging
    }
}

module.exports = { processRzpNotification };