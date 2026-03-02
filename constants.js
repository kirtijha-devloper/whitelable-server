exports.constants = {
    VALIDATION_ERROR: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    SERVER_ERROR: 500
};

// pre‑defined service names for the ServiceFee table.
// use these constants anywhere you need to reference a particular
// charge type so that typos are impossible and search/replace is easy.
exports.serviceNames = {
    BANK_VERIFICATION: 'bank_verification',     // fee for verifying a bank account
    ACTIVATION: 'activation',                   // generic activation fee
    KYC: 'kyc',                                 // etc. (add more as needed)
    // add additional service identifiers below
};
