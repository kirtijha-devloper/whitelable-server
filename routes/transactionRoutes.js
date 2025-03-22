const express = require("express");
const multer = require("multer");

const { uploadCSV } = require("../controllers/transactionController");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save files in the 'uploads' folder
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname); // Unique filename
  },
});

const upload = multer({ storage });

router.post("/upload-csv", upload.single("csv"), uploadCSV);

module.exports = router;