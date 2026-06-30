const fs   = require("fs");
const path = require("path");
const { WEBHOOK_SOURCES } = require("./sources");

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

        // Support separate credential pairs so AGRO Axis and AGRO HDFC can be
        // reported independently while reusing the same webhook endpoint.
        let valid = false;
        let source = WEBHOOK_SOURCES.UNKNOWN;

        const credentialSets = [
            {
                source: WEBHOOK_SOURCES.AGRO_AXIS,
                username: process.env.WEBHOOK_USERNAME_AXIS || process.env.WEBHOOK_USERNAME,
                password: process.env.WEBHOOK_PASSWORD_AXIS || process.env.WEBHOOK_PASSWORD,
            },
            {
                source: WEBHOOK_SOURCES.AGRO_HDFC,
                username: process.env.WEBHOOK_USERNAME_HDFC,
                password: process.env.WEBHOOK_PASSWORD_HDFC,
            },
            {
                source: WEBHOOK_SOURCES.EVERLIFE,
                username: process.env.WEBHOOK_USERNAME_EVERLIFE,
                password: process.env.WEBHOOK_PASSWORD_EVERLIFE,
            },
        ].filter((entry) => entry.username && entry.password);

        for (const entry of credentialSets) {
            if (username === entry.username && password === entry.password) {
                valid = true;
                source = entry.source;
                break;
            }
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
