const Company = require("../models/Company");

const validateWhitelabelDomain = async (req, res, next) => {
    const domain = req.headers['origin'];

    if (!domain) {
        res.status(400).json({ message: "No domain provided in the request headers." });
        return;
    }

    // Please commant below local host code before commiting
    // const localhostPort = process.env.PORT;

    // if(domain === `localhost:${localhostPort}`) {
    //     next();
    //     return;
    // }
    //-------------------------------------------------------------

    const company = await Company.findOne({ where: { domain_name: domain } });

    if (!company) {
        res.status(400).json({ message: "Invalid whitelabel domain." });
        return;
    }
    req.company = company.company_id;
    next();
};

module.exports = validateWhitelabelDomain;