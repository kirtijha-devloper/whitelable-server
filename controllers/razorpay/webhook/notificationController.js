const { processRzpNotification } = require("../../../services/razorpay/webhookService");

async function handleRzpNotification(req, res) {
    try {
        const body = req.body;
        // Razorpay requires 200 OK IMMEDIATELY (no slow operations)
        // Return XML response as Razorpay expects text/xml format
        res.status(200)
           .set('Content-Type', 'text/xml; charset=utf-8')
           .send('<?xml version="1.0" encoding="UTF-8"?><response><status>OK</status></response>');
        // Process in background (async)
        processRzpNotification(body);
        
    } catch (err) {
        console.error("Webhook error", err);
        // still return OK to avoid retries, but in XML format
        return res.status(200)
                  .set('Content-Type', 'text/xml; charset=utf-8')
                  .send('<?xml version="1.0" encoding="UTF-8"?><response><status>OK</status></response>');
    }
}

module.exports = { handleRzpNotification };
