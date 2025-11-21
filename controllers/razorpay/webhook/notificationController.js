const { processRzpNotification } = require("../../../services/razorpay/webhookService");

async function handleRzpNotification(req, res) {
    try {
        const body = req.body;
        // Razorpay requires 200 OK IMMEDIATELY (no slow operations)
        res.status(200).send("OK");
        // Process in background (async)
        processRzpNotification(body);
        
    } catch (err) {
        console.error("Webhook error", err);
        return res.status(200).send("OK"); // still return OK to avoid retries
    }
}

module.exports = { handleRzpNotification };
