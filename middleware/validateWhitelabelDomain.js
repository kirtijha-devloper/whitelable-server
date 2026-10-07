const Company = require("../models/Company");
const { Op } = require("sequelize");

const validateWhitelabelDomain = async (req, res, next) => {
    const rawHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    const originHeader = req.headers['origin'] || req.headers['referer'] || '';

    if (!rawHost && !originHeader) {
        return res.status(400).json({ success: false, message: "Domain is not registered" });
    }

    const hostWithoutPort = rawHost.split(':')[0];
    let originHost = '';
    try {
        if (originHeader) {
            originHost = new URL(originHeader).host;
        }
    } catch (_) { }
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
        const isDev = devHost.includes('localhost') || devHost.includes('127.0.0.1');

        if (isDev && req.user?.company_id) {
            company = await Company.findOne({
                where: { company_id: req.user.company_id }
            });
        }

        if (!company) {
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
    }

    // 3. Super admin global fallback if company record isn't tied to exact dev port
    if (!company && req.user?.role === 'super_admin') {
        company = await Company.findOne();
    }

    if (!company) {
        return res.status(400).json({ success: false, message: "Domain is not registered" });
    }

    // 4. Match domain company_id with company_id validated by validateTokenHandler
    if (req.user) {
        if (req.user.role === 'super_admin') {
            // Super Admin has global platform-wide access
            req.company = company.company_id;
            return next();
        }

        const tokenCompanyId = req.user.company_id;
        if (!tokenCompanyId || tokenCompanyId !== company.company_id) {
            return res.status(400).json({
                success: false,
                message: "Domain is not registered"
            });
        }
    }

    req.company = company.company_id;
    next();
};

module.exports = validateWhitelabelDomain;