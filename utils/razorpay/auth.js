const fs   = require("fs");
const path = require("path");

// ── Minimal file logger ───────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, "../../logs/webhookAuth.log");

function logAuth(result, source, username, ip) {
    try {
        const ts   = new Date().toISOString();
        const line = `[${ts}] result=${result} source=${source || '-'} user=${username || '-'} ip=${ip || '-'}\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch (_) { /* never crash on log failure */ }
}
// ─────────────────────────────────────────────────────────────────────────────

function verifyRzpAuth(req, res, next) {
    const ip = req.ip || req.headers["x-forwarded-for"] || '-';
    try {
        const authHeader = req.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Basic ")) {
            logAuth("NO_HEADER", null, null, ip);
            return res.status(401)
                      .set('Content-Type', 'text/xml; charset=utf-8')
                      .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Unauthorized</status></response>');
        }

        const base64Credentials = authHeader.split(" ")[1];
        const decoded = Buffer.from(base64Credentials, "base64").toString("utf8");

        const [username, password] = decoded.split(":");

        // check both the original Razorpay credentials and the new Everlife ones
        let valid = false;
        let source = null;

        if (
            username === process.env.WEBHOOK_USERNAME &&
            password === process.env.WEBHOOK_PASSWORD
        ) {
            valid = true;
            source = 'razorpay';
        }

        if (
            username === process.env.WEBHOOK_USERNAME_EVERLIFE &&
            password === process.env.WEBHOOK_PASSWORD_EVERLIFE
        ) {
            valid = true;
            source = 'everlife';
        }

        if (!valid) {
            logAuth("INVALID", null, username, ip);
            return res.status(401)
                      .set('Content-Type', 'text/xml; charset=utf-8')
                      .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Invalid credentials</status></response>');
        }

        logAuth("OK", source, username, ip);
        // attach the determined source to the request for downstream handlers
        req.webhookSource = source;
        next();
    } catch (err) {
        logAuth("ERROR", null, null, ip);
        return res.status(500)
                  .set('Content-Type', 'text/xml; charset=utf-8')
                  .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Auth parsing failed</status></response>');
    }
}

module.exports = { verifyRzpAuth };
