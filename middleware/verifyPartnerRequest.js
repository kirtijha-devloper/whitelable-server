const crypto = require("crypto");

module.exports = (req, res, next) => {

    const apiKey = req.header("X-API-Key");
    const timestamp = req.header("X-Timestamp");
    const nonce = req.header("X-Nonce");
    const signature = req.header("X-Signature");

    if (!apiKey || !timestamp || !nonce || !signature) {
        return res.status(401).json({ message: "Missing headers" });
    }

    if (apiKey !== process.env.PARTNER_API_KEY) {
        return res.status(401).json({ message: "Invalid API Key" });
    }

    // Reject requests older than 5 minutes
    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - Number(timestamp)) > 300) {
        return res.status(401).json({ message: "Request expired" });
    }

    // Build canonical query string
    const query = new URLSearchParams(req.query);

    const sorted = [...query.entries()]
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join("&");

    const stringToSign =
        req.method + "\n" +
        req.path + "\n" +
        sorted + "\n" +
        timestamp + "\n" +
        nonce;

    const expected = crypto
        .createHmac("sha256", process.env.PARTNER_API_SECRET)
        .update(stringToSign)
        .digest("hex");

    const valid =
        expected.length === signature.length &&
        crypto.timingSafeEqual(
            Buffer.from(expected),
            Buffer.from(signature)
        );

    if (!valid) {
        return res.status(401).json({ message: "Invalid signature" });
    }

    next();
};