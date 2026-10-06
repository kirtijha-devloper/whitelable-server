const Company = require("../models/Company");
const { Op } = require("sequelize");

const validateWhitelabelDomain = async (req, res, next) => {
    const rawHost = req.headers['host'] || '';
    const originHeader = req.headers['origin'] || req.headers['referer'] || '';

    if (!rawHost && !originHeader) {
        res.status(400).json({ success: false, message: "No domain provided in the request headers." });
        return;
    }

    const hostWithoutPort = rawHost.split(':')[0];
    let originHost = '';
    try {
        if (originHeader) {
            originHost = new URL(originHeader).host;
        }
    } catch (_) {}
    const originWithoutPort = originHost.split(':')[0];

    const possibleDomains = [
        rawHost,
        hostWithoutPort,
        originHost,
        originWithoutPort
    ].filter(Boolean);

    // 1. Try exact match from candidate domain names
    let company = await Company.findOne({
        where: {
            domain_name: { [Op.in]: possibleDomains }
        }
    });

    // 2. Try partial match for local dev / IP addresses
    if (!company && (hostWithoutPort || originWithoutPort)) {
        const devHost = hostWithoutPort || originWithoutPort;
        company = await Company.findOne({
            where: {
                [Op.or]: [
                    { domain_name: { [Op.like]: `%${devHost}%` } },
                    { domain_name: { [Op.like]: `%localhost%` } },
                    { domain_name: { [Op.like]: `%127.0.0.1%` } }
                ]
            }
        });
    }

    // 3. Super admin global fallback if company record isn't tied to exact dev port
    if (!company && (req.user?.role === 'super_admin' || req.user?.role === 'admin')) {
        company = await Company.findOne();
    }

    if (!company) {
        res.status(400).json({ success: false, message: "Invalid whitelabel domain." });
        return;
    }

    req.company = company.company_id;
    next();
};

module.exports = validateWhitelabelDomain;