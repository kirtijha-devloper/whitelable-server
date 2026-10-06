const { getServiceFlagValue } = require('../services/serviceSettingsService');
const ServiceSetting = require('../models/ServiceSetting');

/**
 * Middleware to check if a service is enabled globally or for the user before proceeding.
 * @param {string} serviceKey - Key of the service to check (e.g., 'vimo_payout', 'pos_inventory', 'aadhaar_pay')
 */
const checkServiceEnabled = (serviceKey) => {
  return async (req, res, next) => {
    try {
      if (!serviceKey) return next();

      const serviceRecord = await ServiceSetting.findOne({ where: { service_key: serviceKey } });

      if (serviceRecord && !serviceRecord.is_enabled) {
        return res.status(403).json({
          success: false,
          code: "SERVICE_DISABLED",
          service_key: serviceKey,
          message: `${serviceRecord.label || serviceKey} is currently disabled by Super Admin.`
        });
      }

      const isEnabled = await getServiceFlagValue(serviceKey, true);
      if (!isEnabled) {
        return res.status(403).json({
          success: false,
          code: "SERVICE_DISABLED",
          service_key: serviceKey,
          message: `Service ${serviceKey} is currently disabled by Super Admin.`
        });
      }

      next();
    } catch (err) {
      console.error(`[checkServiceEnabled Error] Failed evaluating flag for ${serviceKey}:`, err);
      next();
    }
  };
};

module.exports = checkServiceEnabled;
