
const csvParser = require("csv-parser");
const fs = require("fs");
const Transaction = require("../models/Transaction");


const uploadCSV = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const results = [];

  // Read and parse the CSV file
  fs.createReadStream(req.file.path)
    .pipe(csvParser())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      try {
        // Insert data into the database
        console.log("results:", results.count)
        await Transaction.bulkCreate(results);
        res.status(200).json({ message: "CSV data uploaded successfully" });
      } catch (err) {
        console.error("Error inserting data:", err);
        res.status(500).json({ message: "Failed to upload CSV data" });
      } finally {
        // Delete the uploaded file after processing
        fs.unlinkSync(req.file.path);
      }
    });
};

module.exports = { uploadCSV };