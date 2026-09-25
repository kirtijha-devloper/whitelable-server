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

const router = express.Router();

router.post("/upload-csv", upload.single("file"), uploadCSV);
router.post("/upload-csv-preview", upload.single("file"), previewCSV);
router.post("/upload-pinelab-notifications", upload.single("file"), uploadPinelabNotifications);
router.post("/process-single-notification", validateToken, processSingleNotificationRow);

router.route("/").get( getAllTransaction );

router.route("/filter").get(getFilteredTransactions);

router.route("/file-uploaded").get( getAllFileUpload );

router.route("/:id").get( getTransactionByID );

module.exports = router;