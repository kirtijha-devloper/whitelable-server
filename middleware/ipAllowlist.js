const { credxpay } = require('../config/config');

module.exports = (req, res, next) => {
  if (!credxpay.webhookIPs.length) return next();
  // Express may populate req.ip in various formats, strip IPv6 prefix if present
  let ip = req.ip || req.connection.remoteAddress;
  if (ip && ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  if (!credxpay.webhookIPs.includes(ip)) {
    return res.status(403).json({ acknowledged: false });
  }
  next();
};