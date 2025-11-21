function verifyRzpAuth(req, res, next) {
    try {
        const authHeader = req.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Basic ")) {
            return res.status(401).send("Unauthorized");
        }

        const base64Credentials = authHeader.split(" ")[1];
        const decoded = Buffer.from(base64Credentials, "base64").toString("utf8");

        const [username, password] = decoded.split(":");

        if (
            username !== process.env.WEBHOOK_USERNAME ||
            password !== process.env.WEBHOOK_PASSWORD
        ) {
            return res.status(401).send("Invalid credentials");
        }

        next();
    } catch (err) {
        return res.status(500).send("Auth parsing failed");
    }
}

module.exports = { verifyRzpAuth };
