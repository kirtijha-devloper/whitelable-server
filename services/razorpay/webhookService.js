const fs = require("fs");
const path = require("path");
const RazorpayNotification = require("../../models/RazorpayNotification.js");

async function processRzpNotification(event) {
    try {
        const txnId = event.txnId;   // unique
        const status = event.status; // AUTHORIZED, FAILED, VOIDED etc.

        console.log("New Razorpay Notification:", txnId, status);

        /**
         * Step 1 — Store in DB with upsert to avoid duplicates
         * Razorpay retries up to 3 times, so we use findOrCreate
         */
        const [notification, created] = await RazorpayNotification.findOrCreate({
            where: { txn_id: txnId },
            defaults: {
                txn_id: txnId,
                event_json: event,
                status: status || null
            }
        });

        // If notification already exists, update it (in case of retry with updated data)
        if (!created) {
            await notification.update({
                event_json: event,
                status: status || notification.status
            });
        }

        console.log(`Notification ${created ? 'created' : 'updated'}:`, txnId);

        /**
         * Step 2 — Trigger your business logic
         * Example: update order status, process payment, etc.
         */
        if (status === "AUTHORIZED") {
            // Add your business logic here
            // Example: await OrderModel.updateOne({ orderNumber: event.orderNumber }, { status: "PAID" });
            console.log("Processing authorized transaction:", txnId);
        } else if (status === "FAILED") {
            // Handle failed transactions
            console.log("Processing failed transaction:", txnId);
        } else if (status === "VOIDED") {
            // Handle voided transactions
            console.log("Processing voided transaction:", txnId);
        }
    } catch (error) {
        console.error("Failed to process notification", error);
        // Don't throw - we already sent 200 OK to Razorpay
    }
}

module.exports = { processRzpNotification };