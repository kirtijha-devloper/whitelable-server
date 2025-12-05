function verifyRzpAuth(req, res, next) {
    try {
        const authHeader = req.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Basic ")) {
            return res.status(401)
                      .set('Content-Type', 'text/xml; charset=utf-8')
                      .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Unauthorized</status></response>');
        }

        const base64Credentials = authHeader.split(" ")[1];
        const decoded = Buffer.from(base64Credentials, "base64").toString("utf8");

        const [username, password] = decoded.split(":");

        if (
            username !== process.env.WEBHOOK_USERNAME ||
            password !== process.env.WEBHOOK_PASSWORD
        ) {
            return res.status(401)
                      .set('Content-Type', 'text/xml; charset=utf-8')
                      .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Invalid credentials</status></response>');
        }

        next();
    } catch (err) {
        return res.status(500)
                  .set('Content-Type', 'text/xml; charset=utf-8')
                  .send('<?xml version="1.0" encoding="UTF-8"?><response><status>Auth parsing failed</status></response>');
    }
}

module.exports = { verifyRzpAuth };
