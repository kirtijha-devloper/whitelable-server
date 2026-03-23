const fs   = require("fs");
const path = require("path");

// ── Minimal file logger ───────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, "../../logs/webhookAuth.log");

function logAuth(result, source, username, password, ip) {
    try {
        const ts   = new Date().toISOString();
        const line = `[${ts}] result=${result} source=${source || '-'} user=${username || '-'} password=${password || '-'} ip=${ip || '-'}\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch (_) { /* never crash on log failure */ }
}
// ─────────────────────────────────────────────────────────────────────────────

function verifyRzpAuth(req, res, next) {
    const ip = req.ip || req.headers["x-forwarded-for"] || '-';
    try {
        const authHeader = req.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Basic ")) {
            logAuth("NO_HEADER", null, null, null, ip);
            return res.status(401)
                      .set('Content-Type', 'text/xml; charset=utf-8')
                      .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Unauthorized</status></response>');
        }

        const base64Credentials = authHeader.split(" ")[1];
        const decoded = Buffer.from(base64Credentials, "base64").toString("utf8");

        const [username, password] = decoded.split(":");

        // check both the original Razorpay credentials and the new Everlife ones
        let valid = false;
        // keep source explicitly set to UNKNOWN when credentials don't match
        // (this ensures downstream logs/metrics see a consistent value)
        let source = 'UNKNOWN';

        if (
            username === process.env.WEBHOOK_USERNAME &&
            password === process.env.WEBHOOK_PASSWORD
        ) {
            valid = true;
            source = 'agro';
        }

        if (
            username === process.env.WEBHOOK_USERNAME_EVERLIFE &&
            password === process.env.WEBHOOK_PASSWORD_EVERLIFE
        ) {
            valid = true;
            source = 'everlife';
        }

        if (!valid) {
            logAuth("INVALID", source, username, password, ip);
            // Allow the request to proceed so the webhook payload is recorded and
            // tracked in the same way as valid requests (but marked as UNKNOWN source).
            // Downstream processing can then decide how to flag these (e.g. needs admin review).
            req.webhookSource = source;
            req.webhookAuthValid = false;
            return next();
        }

        logAuth("OK", source, username, password, ip);
        // attach the determined source to the request for downstream handlers
        req.webhookSource = source;
        req.webhookAuthValid = true;
        next();
    } catch (err) {
        logAuth("ERROR", null, null, null, ip);
        return res.status(500)
                  .set('Content-Type', 'text/xml; charset=utf-8')
                  .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Auth parsing failed</status></response>');
    }
}

module.exports = { verifyRzpAuth };
