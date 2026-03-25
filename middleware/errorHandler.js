const {constants} = require("../constants")
const errorHandler = (err, req, res, next) => {
    // Prefer the status already set on the response; fall back to the error's
    // own .status/.statusCode (set by body-parser and similar middleware),
    // and finally default to 500.
    const statusCode = (res.statusCode && res.statusCode !== 200)
        ? res.statusCode
        : (err.status || err.statusCode || 500);
    switch (statusCode) {
        case constants.VALIDATION_ERROR:
            res.status(statusCode).json({title: "Validation Failed", message: err.message, stackTrace: err.stack });
            break;
        case constants.NOT_FOUND:
            res.status(statusCode).json({title: "Not Found", message: err.message, stackTrace: err.stack });
            break;
        case constants.FORBIDDEN:
            res.status(statusCode).json({title: "Forbidden", message: err.message, stackTrace: err.stack });
            break;
        case constants.UNAUTHORIZED:
            res.status(statusCode).json({title: "UNAUTHORIZED", message: err.message, stackTrace: err.stack });
            break;
        case constants.SERVER_ERROR:
        default:
            console.error("[errorHandler]", err.message || err);
            res.status(500).json({title: "SERVER_ERROR", message: err.message, stackTrace: err.stack });
            break;
    }
};

module.exports = {errorHandler}