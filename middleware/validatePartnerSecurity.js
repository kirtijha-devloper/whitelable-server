/**
 * validatePartnerSecurity.js
 *
 * Security middleware for Third-Party / Partner APIs:
 * 1. IP validation matching PARTNER_API_ALLOWED_IPS in .env
 * 2. Domain / Host / Origin validation matching PARTNER_API_ALLOWED_DOMAINS in .env
 * 3. RSA Signature / Key verification using PARTNER_API_PUBLIC_KEY (SHA256 signature verification)
 *    Optional: If third party sends an encrypted payload or x-partner-signature.
 */

const crypto = require("crypto");

function extractClientIp(req) {
  if (!req) return "127.0.0.1";
  const forwarded = req.headers
    ? (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.headers["cf-connecting-ip"])
    : null;
  if (forwarded) {
    const rawIp = String(forwarded).split(",")[0].trim();
    const cleanIp = rawIp.startsWith("::ffff:") ? rawIp.replace("::ffff:", "") : rawIp;
    if (cleanIp && cleanIp !== "::1" && cleanIp !== "127.0.0.1") {
      return cleanIp;
    }
  }

  let fallbackIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || null;
  if (fallbackIp) {
    if (fallbackIp.startsWith("::ffff:")) {
      fallbackIp = fallbackIp.replace("::ffff:", "");
    }
    if (fallbackIp === "::1") {
      fallbackIp = "127.0.0.1";
    }
    return fallbackIp;
  }

  return "127.0.0.1";
}

function extractRequestHostAndOrigin(req) {
  const rawHost = req.headers["x-forwarded-host"] || req.headers["host"] || "";
  const originHeader = req.headers["origin"] || req.headers["referer"] || "";

  const hostWithoutPort = rawHost.split(":")[0];
  let originHost = "";
  try {
    if (originHeader) {
      originHost = new URL(originHeader).host;
    }
  } catch (_) {}
  const originWithoutPort = originHost.split(":")[0];

  const cleanHost = String(hostWithoutPort || rawHost)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .split(":")[0]
    .replace(/^www\./i, "")
    .trim();

  const cleanOrigin = String(originWithoutPort || originHost)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .split(":")[0]
    .replace(/^www\./i, "")
    .trim();

  return { cleanHost, cleanOrigin, hostWithoutPort, originWithoutPort };
}

function resolveKeyString(keyRaw) {
  if (!keyRaw) return null;
  let val = String(keyRaw).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  // Replace escaped \n with actual newlines if present
  val = val.replace(/\\n/g, "\n");
  return val;
}

const validatePartnerSecurity = (req, res, next) => {
  // ── 1. IP VALIDATION ────────────────────────────────────────────────────────
  const allowedIpsEnv = process.env.PARTNER_API_ALLOWED_IPS || "";
  if (allowedIpsEnv.trim()) {
    const allowedIps = allowedIpsEnv
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const clientIp = extractClientIp(req).toLowerCase();
    const isIpAllowed =
      allowedIps.includes("*") ||
      allowedIps.includes(clientIp) ||
      (clientIp === "127.0.0.1" && (allowedIps.includes("localhost") || allowedIps.includes("127.0.0.1"))) ||
      (clientIp === "::1" && (allowedIps.includes("localhost") || allowedIps.includes("::1")));

    if (!isIpAllowed) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Client IP '${clientIp}' is not authorized.`,
      });
    }
  }

  // ── 2. DOMAIN / ORIGIN VALIDATION ───────────────────────────────────────────
  const allowedDomainsEnv = process.env.PARTNER_API_ALLOWED_DOMAINS || "";
  if (allowedDomainsEnv.trim()) {
    const allowedDomains = allowedDomainsEnv
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const { cleanHost, cleanOrigin } = extractRequestHostAndOrigin(req);
    const domainCandidates = [cleanHost, cleanOrigin].filter(Boolean);

    const isDomainAllowed =
      allowedDomains.includes("*") ||
      domainCandidates.some((d) =>
        allowedDomains.some((allowed) => d === allowed || d.endsWith(`.${allowed}`))
      );

    if (!isDomainAllowed && domainCandidates.length > 0) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Domain '${cleanHost || cleanOrigin}' is not authorized.`,
      });
    }
  }

  // ── 3. PUBLIC / PRIVATE KEY SIGNATURE VALIDATION (OPTIONAL OR ENFORCED IF HEADER SENT) ──
  const signature =
    req.headers["x-partner-signature"] ||
    req.headers["x-signature"] ||
    req.query?.signature ||
    req.body?.signature;

  const rawPublicKey = resolveKeyString(process.env.PARTNER_API_PUBLIC_KEY);

  // If a signature is provided by the third party, verify it using PARTNER_API_PUBLIC_KEY
  if (signature) {
    if (!rawPublicKey) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error: PARTNER_API_PUBLIC_KEY is not configured.",
      });
    }

    try {
      // Data to verify: sorted query params, or JSON body string
      let dataToVerify = "";
      if (req.method === "GET") {
        const queryCopy = { ...req.query };
        delete queryCopy.signature;
        dataToVerify = Object.keys(queryCopy)
          .sort()
          .map((k) => `${k}=${queryCopy[k]}`)
          .join("&");
      } else {
        const bodyCopy = { ...req.body };
        delete bodyCopy.signature;
        dataToVerify = JSON.stringify(bodyCopy);
      }

      const verifier = crypto.createVerify("SHA256");
      verifier.update(dataToVerify);
      verifier.end();

      const isValid = verifier.verify(rawPublicKey, signature, "base64");
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: Invalid digital signature.",
        });
      }
    } catch (sigErr) {
      return res.status(401).json({
        success: false,
        message: `Signature verification failed: ${sigErr.message}`,
      });
    }
  }

  req.isPartnerAuthenticated = true;
  next();
};

module.exports = {
  validatePartnerSecurity,
  extractClientIp,
  resolveKeyString,
};

