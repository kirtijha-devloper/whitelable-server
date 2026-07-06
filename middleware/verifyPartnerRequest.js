const crypto = require("crypto");

module.exports = (req, res, next) => {

    // ===== Debug (remove after testing) =====
    console.log("========== Incoming Request ==========");
    console.log("Headers:", req.headers);
    console.log("Method:", req.method);
    console.log("Path:", req.path);
    console.log("Query:", req.query);
    console.log("======================================");

    const apiKey = req.header("X-API-Key");
    const timestamp = req.header("X-Timestamp");
    const nonce = req.header("X-Nonce");
    const signature = req.header("X-Signature");

    // Check missing headers
    const missing = [];

    if (!apiKey) missing.push("X-API-Key");
    if (!timestamp) missing.push("X-Timestamp");
    if (!nonce) missing.push("X-Nonce");
    if (!signature) missing.push("X-Signature");

    if (missing.length > 0) {
        return res.status(401).json({
            success: false,
            message: "Missing headers",
            missing
        });
    }

    // Verify API Key
    if (apiKey !== process.env.PARTNER_API_KEY) {
        return res.status(401).json({
            success: false,
            message: "Invalid API Key"
        });
    }

    // Verify Timestamp (5 minutes)
    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - Number(timestamp)) > 300) {
        return res.status(401).json({
            success: false,
            message: "Request expired"
        });
    }

    // Sort query parameters
    const query = Object.keys(req.query)
        .sort()
        .map(key => `${key}=${req.query[key]}`)
        .join("&");

    // Build string exactly as Laravel did
    const fullPath = req.baseUrl + req.path;
    const stringToSign =
        req.method + "\n" +
        fullPath + "\n" +
        query + "\n" +
        timestamp + "\n" +
        nonce;

    console.log("\nString To Sign:");
    console.log(stringToSign);

    const expectedSignature = crypto
        .createHmac("sha256", process.env.PARTNER_API_SECRET)
        .update(stringToSign)
        .digest("hex");

    console.log("\nExpected :", expectedSignature);
    console.log("Received :", signature);

    // Verify signature
    const valid =
        expectedSignature.length === signature.length &&
        crypto.timingSafeEqual(
            Buffer.from(expectedSignature),
            Buffer.from(signature)
        );

    if (!valid) {
        return res.status(401).json({
            success: false,
            message: "Invalid Signature",
            expected: expectedSignature,
            received: signature
        });
    }

    next();
};