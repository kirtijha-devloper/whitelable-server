const express = require("express");
const upload = require("../utils/mutlerSetup");

const { 
  uploadCSV, 
  getAllTransaction, 
  getTransactionByID, 
  getAllFileUpload, 
  getFilteredTransactions,
  previewCSV,
  uploadPinelabNotifications,
  processSingleNotificationRow
} = require("../controllers/transactionController");

const validateToken = require("../middleware/validateTokenHandler");
const validateWhitelabelDomain = require("../middleware/validateWhitelabelDomain");

const requireSuperAdmin = (req, res, next) => {
  const role = String(req.user?.role || "").trim().toLowerCase();
  if (role === "super_admin" || role === "superadmin") {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: "Access denied. Only Super Admin is authorized to upload or batch process notifications."
  });
};

const router = express.Router();

router.post("/upload-csv", validateToken, validateWhitelabelDomain, requireSuperAdmin, upload.single("file"), uploadCSV);
router.post("/upload-csv-preview", validateToken, validateWhitelabelDomain, requireSuperAdmin, upload.single("file"), previewCSV);
router.post("/upload-pinelab-notifications", validateToken, validateWhitelabelDomain, requireSuperAdmin, upload.single("file"), uploadPinelabNotifications);
router.post("/process-single-notification", validateToken, validateWhitelabelDomain, requireSuperAdmin, processSingleNotificationRow);

router.route("/").get(validateToken, validateWhitelabelDomain, getAllTransaction);

router.route("/filter").get(validateToken, validateWhitelabelDomain, getFilteredTransactions);

router.route("/file-uploaded").get(validateToken, validateWhitelabelDomain, getAllFileUpload);

router.route("/:id").get(validateToken, validateWhitelabelDomain, getTransactionByID);

module.exports = router;