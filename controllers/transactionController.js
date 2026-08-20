const asyncHandler = require("express-async-handler")
const fs = require("fs");
const csvParser = require("csv-parser");
const Transaction = require("../models/Transaction");
const WalletTransaction = require("../models/WalletTransaction")
const { Op } = require("sequelize");
const PosMachine = require("../models/posMachine");


const formatMidNumbers = (mids) => {
  return mids
    .filter(mid => mid) // skip null/undefined
    .map(mid => String(mid).replace(/'/g, '').trim()) // remove single quotes + trim
    .map(mid => `'${mid}'`); // wrap in single quotes
};
const uploadCSV = (req, res) => {
  console.log("data:")
  // const cleanMID = (mid) => (mid || "").replace(/'/g, "").trim();
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
console.log("data5:")
  const results = [];
  const sanitizedResults = [];

  fs.createReadStream(req.file.path)
    .pipe(csvParser())
    .on("data", (row) => {
      console.log("data:", row)
      results.push(row);
    })
    .on("end", async () => {
      try {
        console.log("Total records found:", results.length);

        results.forEach((r, i) => {
          // Required fields validation (modify if needed)
          if (!r.ID || !r.Date) {
            console.warn(`Missing mandatory field(s) at row ${i + 1}`);
            return; // Skip invalid rows
          }

          


          // Prepare and sanitize the record
          const sanitizedRecord = {
            ID: r.ID.trim(),
            Date: parseDate(r.Date),
            Mobile: r.Mobile || null,
            Email: r.Email || null,
            Consumer: r.Consumer || null,
            Username: r.Username || null,
            Type: r.Type || null,
            Mode: r.Mode || null,
            Amount: parseFloatOrNull(r.Amount),
            Tip: parseFloatOrNull(r.Tip),
            CashAtPOS: parseFloatOrNull(r["Cash at POS"]),
            TxnType: r["Txn Type"] || null,
            AuthCode: r["Auth Code"] || null,
            Card: r.Card || null,
            CardType: r["Card Type"] || null,
            BrandType: r["Brand Type"] || null,
            CardClassification: r["Card Classification"] || null,
            CardTxnType: r["Card Txn Type"] || null,
            RRN: r.RRN || null,
            Invoice: r["Invoice#"] || null,
            DeviceSerial: r["Device Serial"] || null,
            Status: r.Status || null,
            SettledOn: parseDate(r["Settled On"]),
            Labels: r.Labels || null,
            MID: r.MID || null,
            TID: r.TID || null,
            Batch: r["Batch#"] || null,
            Ref1: r["Ref#"] || null,
            Ref2: r["Ref# 2"] || null,
            Ref3: r["Ref# 3"] || null,
            Ref4: r["Ref# 4"] || null,
            Ref5: r["Ref# 5"] || null,
            Ref6: r["Ref# 6"] || null,
            Ref7: r["Ref# 7"] || null,
            ReceiptNo: r["Receipt No"] || null,
            ErrorCode: r["Error Code"] || null,
            AdditionalInformation: r["Additional Information"] || null,
            PGErrorCode: r["PG Error Code"] || null,
            PGErrorMessage: r["PG Error Message"] || null,
            Latitude: parseFloatOrNull(r.Latitude),
            Longitude: parseFloatOrNull(r.Longitude),
            Payer: r.Payer || null,
            TIDLocation: r["TID Location"] || null,
            DXMode: r["DX Mode"] || null,
            AcquiringBank: r["Acquiring Bank"] || null,
            IssuingBank: r["Issuing Bank"] || null,
            EMITenure: parseIntOrNull(r["EMI Tenure"]),
            EMIInterestRate: parseFloatOrNull(r["EMI Interest Rate"]),
            EMIAmt: parseFloatOrNull(r["EMI Amt"]),
            TotalAmtWithIntr: parseFloatOrNull(r["Total Amt (With Intr)"]),
            CashbackPercent: parseFloatOrNull(r["Cashback%"]),
            CashbackAmt: parseFloatOrNull(r["Cashback Amt"]),
            PaybackPercent: parseFloatOrNull(r["Payback%"]),
            PaybackAmt: parseFloatOrNull(r["Payback Amt"]),
            InstantEMIDiscountPercent: parseFloatOrNull(r["Instant EMI discount%"]),
            InstantEMIDiscount: parseFloatOrNull(r["Instant EMI discount"]),
            NetCost: parseFloatOrNull(r["Net Cost"]),
            EMIStatus: r["EMI Status"] || null,
            Manufacturer: r.Manufacturer || null,
            ProductName: r["Product Name"] || null,
            SkuCode: r["Sku code"] || null,
            ProductSerial: r["Product Serial"] || null,
            SchemeName: r["Scheme Name"] || null,
            ReceiptURL: r["Receipt URL"] || null,
            FileName: req.file.originalname, // Example of adding uploaded file name
          };

          sanitizedResults.push(sanitizedRecord);
        });

        console.log("Sanitized Records Count:", sanitizedResults.length);
        const existingIds = await Transaction.findAll({
          where: {
            ID: sanitizedResults.map(tx => tx.ID)
          },
          attributes: ['ID'],
          raw: true
        });

        const existingIdSet = new Set(existingIds.map(tx => tx.ID));
        const newTransactions = sanitizedResults
          .filter(tx => !existingIdSet.has(tx.ID))
          .map(tx => ({
            ...tx,
            MID: tx.MID ? String(tx.MID).replace(/'/g, '').trim() : null, // Clean MID here,
            Username: tx.Username ? String(tx.Username).replace(/'/g, '').trim() : null,
            TID: tx.TID ? String(tx.TID).replace(/'/g, '').trim() : null,
            DeviceSerial: tx.DeviceSerial ? String(tx.DeviceSerial).replace(/'/g, '').trim() : null,
          }));


        if (newTransactions.length === 0) {
          return res.status(400).json({ message: "No valid records found in CSV." });
        }

        // Bulk insert
        await Transaction.bulkCreate(newTransactions, {
          ignoreDuplicates: true // ✅ This will skip records with duplicate primary keys
        });
        console.log("CSV data uploaded successfully")

        const settledTransactions = newTransactions.filter(t => t.Status === "SETTLED");
        const walletRequests = [];
        for (const tx of settledTransactions) {
          // 🔐 Make sure you have a valid user to attach (modify logic as needed)
          const posMachine = await PosMachine.findOne({where: {mid_number: tx.MID}})

          if (!posMachine) {
            console.warn(`No POS Machine Found in our system: ${tx.MID}, skipping wallet request`);
            // continue;
          }

          walletRequests.push({
            type: "request",
            amount: tx.Amount,
            status: "pending", // Marked as request
            reason: `Razorpay transaction ID: ${tx.ID}`,
            requested_by: posMachine.assigned_to, // assuming self-initiated
            source: "razorpay"
          });
        }

        if (walletRequests.length) {
          await WalletTransaction.bulkCreate(walletRequests);
          console.log(`Wallet requests created: ${walletRequests.length}`);
}

        res.status(200).json({
          message: "CSV data uploaded successfully",
          insertedCount: sanitizedResults.length,
        });
      } catch (err) {
        console.error("Error inserting data:", err);
        res.status(500).json({
            success: false,
            message: err.message || "Failed to upload CSV data",
          });
      } finally {
        // Clean up the uploaded file
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Failed to delete CSV file:", err);
        });
      }
    });
};


// Helpers
function parseDate(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function parseFloatOrNull(value) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function parseIntOrNull(value) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}


const getAllTransaction = asyncHandler(async (req, res) => {
try {
  const transactions = await Transaction.findAll();
    res.json({list: transactions});
  } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  };
});

const getTransactionByID = asyncHandler(async (req, res) => {
   console.log("create params:req.params.id ")
      const id = req.params.id;
      const transaction = await Transaction.findByPk(id)
      if (transaction) {
          res.status(200).json(transaction)
      } else {
          res.status(404);
              throw new Error ("NoT Found !")
      };
});

const getAllFileUpload = asyncHandler(async (req, res) => { 
    const files = await Transaction.findAll({
      attributes: [
        [Transaction.sequelize.fn('DISTINCT', Transaction.sequelize.col('File Name')), 'FileName']
      ],
      raw: true
    });

    if (!files.length) {
      return res.status(404).json({ message: "No files found." });
    }

    res.json({
      message: "Unique files fetched successfully",
      files: files.map(file => file.FileName),
      count: files.length
    });

});

const getFilteredTransactions = asyncHandler(async (req, res) => {
  const { status, startDate, endDate, MID, TID } = req.query;

  console.log("Incoming filters:", { status, startDate, endDate, MID, TID });

  // Build where condition dynamically
  const whereCondition = {};

  // Status filter
  if (status) {
    whereCondition.Status = status;
  }

  // Date range filter
  if (startDate || endDate) {
    whereCondition.Date = {};
    
    if (startDate) {
      whereCondition.Date[Op.gte] = new Date(startDate);
    }

    if (endDate) {
      whereCondition.Date[Op.lte] = new Date(endDate);
    }
  }

  // MID filter
  if (MID) {
    whereCondition.MID = MID;
  }

  // TID filter
  if (TID) {
    whereCondition.TID = TID;
  }

console.log("Final WHERE clause:", whereCondition);

  try {
    const transactions = await Transaction.findAll({
      where: whereCondition,
    });

    if (!transactions.length) {
      return res.status(404).json({
        message: "No transactions found matching the filters",
      });
    }

    res.status(200).json({
      message: "Filtered transactions fetched successfully",
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error("Error fetching filtered transactions:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});


const XLSX = require("xlsx");
const { processRzpNotification } = require("../services/razorpay/webhookService");

function parseUploadedFileToRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
}

function mapPaytmRow(r, normalizedRow, provider, index) {
  const mid = String(normalizedRow['MID'] || normalizedRow['MERCHANT_ID'] || '').replace(/'/g, '').trim();
  const tid = String(normalizedRow['TID'] || normalizedRow['TERMINAL_ID'] || '').replace(/'/g, '').trim();
  const rrn = String(normalizedRow['RRN'] || normalizedRow['REF_NO'] || '').replace(/'/g, '').trim();
  let txnId = String(normalizedRow['TXN_ID'] || normalizedRow['TRANSACTION_ID'] || rrn || '').replace(/'/g, '').trim();

  if (!txnId) {
    txnId = `PAYTM-${tid || mid || 'UNKNOWN'}-${Date.now()}-${index}`;
  }

  const rawAmt = normalizedRow['AMOUNT'] || normalizedRow['TXN_AMOUNT'] || 0;
  const amount = parseFloat(String(rawAmt).replace(/'/g, '').replace(/,/g, '')) || 0;

  const paymentCardBrand = String(normalizedRow['CARD_BRAND'] || normalizedRow['SCHEME'] || normalizedRow['BRAND'] || 'VISA').replace(/'/g, '').trim().toUpperCase();
  const paymentCardType = String(normalizedRow['CARD_TYPE'] || normalizedRow['PAYMENT_CARD_TYPE'] || 'CREDIT').replace(/'/g, '').trim().toUpperCase();
  const cardSubType = String(normalizedRow['TRANSACTION_TYPE'] || normalizedRow['TXN_TYPE'] || 'SALE').replace(/'/g, '').trim().toUpperCase();

  const rawStatus = String(normalizedRow['STATUS'] || normalizedRow['TRANSACTION_STATUS'] || 'SUCCESS').replace(/'/g, '').trim().toUpperCase();

  let status = 'AUTHORIZED';
  if (rawStatus.includes('SUCCESS') || rawStatus.includes('APPROVED') || rawStatus === 'SETTLED') {
    status = (cardSubType === 'SETTLEMENT') ? 'SETTLED' : 'AUTHORIZED';
  } else if (rawStatus.includes('DECLINE') || rawStatus.includes('FAIL') || rawStatus.includes('REJECT')) {
    status = 'FAILED';
  }

  const rawDate = normalizedRow['TRANSACTION_DATE_TIME'] || normalizedRow['TRANSACTION_DATE'] || normalizedRow['DATE'] || new Date();
  const postingDate = new Date(rawDate);

  const event = {
    txnId,
    mid,
    tid,
    amount,
    currencyCode: 'INR',
    paymentMode: 'CARD',
    paymentCardType,
    paymentCardBrand,
    rrNumber: rrn || null,
    deviceSerial: String(normalizedRow['DEVICE_SERIAL'] || normalizedRow['SERIAL_NO'] || '').replace(/'/g, '').trim() || null,
    postingDate: isNaN(postingDate.getTime()) ? new Date().toISOString() : postingDate.toISOString(),
    status,
    source: provider || 'paytm',
    customerName: String(normalizedRow['MERCHANT_DBA_NAME'] || '').replace(/'/g, '').trim() || null,
    raw: r
  };

  return {
    event,
    previewRow: {
      tid,
      mid,
      txn_id: txnId,
      amount,
      card_type: paymentCardType,
      card_brand: paymentCardBrand,
      card_sub_type: cardSubType,
      charge: 0,
      charge_percentage: 0,
      left_amount: amount,
      date: isNaN(postingDate.getTime()) ? String(rawDate) : postingDate.toISOString().replace('T', ' ').substring(0, 19),
      status,
      raw: r
    }
  };
}

function mapPinelabRow(r, normalizedRow, provider, index) {
  const mid = String(normalizedRow['MID'] || normalizedRow['MERCHANT_ID'] || normalizedRow['MID_NUMBER'] || '').replace(/'/g, '').trim();
  const tid = String(normalizedRow['TID'] || normalizedRow['TERMINAL_ID'] || normalizedRow['TID_NUMBER'] || '').replace(/'/g, '').trim();
  const rrn = String(normalizedRow['RRN'] || normalizedRow['RR_NUMBER'] || '').replace(/'/g, '').trim();
  let txnId = String(normalizedRow['TXN_ID'] || normalizedRow['TRANSACTION_ID'] || rrn || '').replace(/'/g, '').trim();

  if (!txnId) {
    txnId = `PINELAB-${tid || mid || 'UNKNOWN'}-${Date.now()}-${index}`;
  }

  const rawAmt = normalizedRow['AMOUNT'] || normalizedRow['TRANSACTION_AMOUNT'] || 0;
  const amount = parseFloat(String(rawAmt).replace(/'/g, '').replace(/,/g, '')) || 0;

  const paymentCardBrand = String(normalizedRow['SCHEME'] || normalizedRow['CARD_BRAND'] || normalizedRow['CARD_SCHEME'] || 'VISA').replace(/'/g, '').trim().toUpperCase();
  const paymentCardType = String(normalizedRow['CARD_TYPE'] || 'CREDIT').replace(/'/g, '').trim().toUpperCase();
  const cardSubType = String(normalizedRow['TRANSACTION_TYPE'] || normalizedRow['TYPE'] || 'SALE').replace(/'/g, '').trim().toUpperCase();

  const rawStatus = String(normalizedRow['STATUS'] || normalizedRow['RESPONSE_MESSAGE'] || normalizedRow['TRANSACTION_STATUS'] || 'SUCCESS').replace(/'/g, '').trim().toUpperCase();

  let status = 'AUTHORIZED';
  if (rawStatus.includes('SUCCESS') || rawStatus.includes('APPROVED') || rawStatus === 'SETTLED') {
    status = (cardSubType === 'SETTLEMENT') ? 'SETTLED' : 'AUTHORIZED';
  } else if (rawStatus.includes('DECLINE') || rawStatus.includes('FAIL') || rawStatus.includes('REJECT')) {
    status = 'FAILED';
  }

  const rawDate = normalizedRow['TRANSACTION_DATE_TIME'] || normalizedRow['TRANSACTION_DATE'] || normalizedRow['DATE'] || new Date();
  const postingDate = new Date(rawDate);

  const event = {
    txnId,
    mid,
    tid,
    amount,
    currencyCode: 'INR',
    paymentMode: 'CARD',
    paymentCardType,
    paymentCardBrand,
    rrNumber: rrn || null,
    deviceSerial: String(normalizedRow['DEVICE_SERIAL'] || normalizedRow['SERIAL_NO'] || '').replace(/'/g, '').trim() || null,
    postingDate: isNaN(postingDate.getTime()) ? new Date().toISOString() : postingDate.toISOString(),
    status,
    source: provider || 'pinelab',
    customerName: String(normalizedRow['MERCHANT_DBA_NAME'] || '').replace(/'/g, '').trim() || null,
    raw: r
  };

  return {
    event,
    previewRow: {
      tid,
      mid,
      txn_id: txnId,
      amount,
      card_type: paymentCardType,
      card_brand: paymentCardBrand,
      card_sub_type: cardSubType,
      charge: 0,
      charge_percentage: 0,
      left_amount: amount,
      date: isNaN(postingDate.getTime()) ? String(rawDate) : postingDate.toISOString().replace('T', ' ').substring(0, 19),
      status,
      raw: r
    }
  };
}

function mapYesBankRow(r, normalizedRow, provider, index) {
  const mid = String(normalizedRow['MID'] || normalizedRow['MERCHANT_ID'] || '').replace(/'/g, '').trim();
  const tid = String(normalizedRow['TID'] || normalizedRow['TERMINAL_ID'] || '').replace(/'/g, '').trim();
  const rrn = String(normalizedRow['RRN'] || normalizedRow['REF_NO'] || normalizedRow['RRN_NUMBER'] || '').replace(/'/g, '').trim();
  let txnId = String(normalizedRow['TXN_ID'] || normalizedRow['TRANSACTION_ID'] || rrn || '').replace(/'/g, '').trim();

  if (!txnId) {
    txnId = `YESBANK-${tid || mid || 'UNKNOWN'}-${Date.now()}-${index}`;
  }

  const rawAmt = normalizedRow['AMOUNT'] || normalizedRow['TXN_AMOUNT'] || 0;
  const amount = parseFloat(String(rawAmt).replace(/'/g, '').replace(/,/g, '')) || 0;

  const paymentCardBrand = String(normalizedRow['CARD_BRAND'] || normalizedRow['SCHEME'] || 'VISA').replace(/'/g, '').trim().toUpperCase();
  const paymentCardType = String(normalizedRow['CARD_TYPE'] || 'CREDIT').replace(/'/g, '').trim().toUpperCase();
  const rawTxnType = String(normalizedRow['TRANSACTION_TYPE'] || '').replace(/'/g, '').trim().toUpperCase();
  const cardSubType = rawTxnType || null;

  const rawStatus = String(normalizedRow['STATUS'] || normalizedRow['TRANSACTION_STATUS'] || 'SUCCESS').replace(/'/g, '').trim().toUpperCase();

  let status = 'FAILED';
  const isStatusSuccess = rawStatus.includes('SUCCESS') || rawStatus.includes('APPROVED') || rawStatus === 'SETTLED';
  const isTypeValid = !cardSubType || cardSubType === 'SALE' || cardSubType === 'UPI';

  if (isStatusSuccess && isTypeValid) {
    status = 'AUTHORIZED';
  } else {
    status = 'FAILED';
  }

  const rawDate = normalizedRow['TRANSACTION_DATE_TIME'] || normalizedRow['TRANSACTION_DATE'] || normalizedRow['DATE'] || new Date();
  const postingDate = new Date(rawDate);

  const event = {
    txnId,
    mid,
    tid,
    amount,
    currencyCode: 'INR',
    paymentMode: 'CARD',
    paymentCardType,
    paymentCardBrand,
    rrNumber: rrn || null,
    deviceSerial: String(normalizedRow['DEVICE_SERIAL'] || normalizedRow['SERIAL_NO'] || '').replace(/'/g, '').trim() || null,
    postingDate: isNaN(postingDate.getTime()) ? new Date().toISOString() : postingDate.toISOString(),
    status,
    source: provider || 'yesbank',
    customerName: String(normalizedRow['MERCHANT_DBA_NAME'] || '').replace(/'/g, '').trim() || null,
    raw: r
  };

  return {
    event,
    previewRow: {
      tid,
      mid,
      txn_id: txnId,
      amount,
      card_type: paymentCardType,
      card_brand: paymentCardBrand,
      card_sub_type: cardSubType,
      charge: 0,
      charge_percentage: 0,
      left_amount: amount,
      date: isNaN(postingDate.getTime()) ? String(rawDate) : postingDate.toISOString().replace('T', ' ').substring(0, 19),
      status,
      raw: r
    }
  };
}

function mapTeleringRow(r, normalizedRow, provider, index) {
  const mid = String(normalizedRow['MID'] || '').replace(/'/g, '').trim();
  const tid = String(normalizedRow['TID'] || '').replace(/'/g, '').trim();
  const rrn = String(normalizedRow['RRN'] || '').replace(/'/g, '').trim();
  let txnId = rrn;

  if (!txnId) {
    txnId = `TEL-${tid || mid || 'UNKNOWN'}-${Date.now()}-${index}`;
  }

  const rawAmt = normalizedRow['TRANSACTION_AMOUNT'] || 0;
  const amount = parseFloat(String(rawAmt).replace(/'/g, '').replace(/,/g, '')) || 0;

  const paymentCardBrand = String(normalizedRow['SCHEME'] || 'VISA').replace(/'/g, '').trim().toUpperCase();
  const paymentCardType = String(normalizedRow['CARD_TYPE'] || 'CREDIT').replace(/'/g, '').trim().toUpperCase();
  const rawTxnType = String(normalizedRow['TRANSACTION_TYPE'] || '').replace(/'/g, '').trim().toUpperCase();
  const cardSubType = rawTxnType || null;

  const rawStatus = String(normalizedRow['TRANSACTION_STATUS'] || normalizedRow['RESPONSE_MESSAGE'] || 'SUCCESS').replace(/'/g, '').trim().toUpperCase();

  let status = 'FAILED';
  const isStatusSuccess = rawStatus.includes('SUCCESS') || rawStatus.includes('APPROVED') || rawStatus === 'SETTLED';
  const isTypeValid = !cardSubType || cardSubType === 'SALE' || cardSubType === 'UPI';

  if (isStatusSuccess && isTypeValid) {
    status = 'AUTHORIZED';
  } else {
    status = 'FAILED';
  }

  const rawDate = normalizedRow['TRANSACTION_DATE_TIME'] || new Date();
  const postingDate = new Date(rawDate);

  const event = {
    txnId,
    mid,
    tid,
    amount,
    currencyCode: 'INR',
    paymentMode: 'CARD',
    paymentCardType,
    paymentCardBrand,
    rrNumber: rrn || null,
    deviceSerial: String(normalizedRow['DEVICE_SERIAL'] || normalizedRow['SERIAL_NO'] || '').replace(/'/g, '').trim() || null,
    postingDate: isNaN(postingDate.getTime()) ? new Date().toISOString() : postingDate.toISOString(),
    status,
    source: provider || 'telering',
    customerName: String(normalizedRow['MERCHANT_DBA_NAME'] || '').replace(/'/g, '').trim() || null,
    raw: r
  };

  return {
    event,
    previewRow: {
      tid,
      mid,
      txn_id: txnId,
      amount,
      card_type: paymentCardType,
      card_brand: paymentCardBrand,
      card_sub_type: cardSubType,
      charge: 0,
      charge_percentage: 0,
      left_amount: amount,
      date: isNaN(postingDate.getTime()) ? String(rawDate) : postingDate.toISOString().replace('T', ' ').substring(0, 19),
      status,
      raw: r
    }
  };
}

function mapRowToNotificationEvent(r, provider = 'telering', index = 0) {
  const normalizedRow = {};
  for (const k of Object.keys(r)) {
    const cleanKey = String(k).trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
    normalizedRow[cleanKey] = r[k];
  }

  const providerLower = String(provider).trim().toLowerCase();

  if (providerLower.includes('paytm')) {
    return mapPaytmRow(r, normalizedRow, providerLower, index);
  } else if (providerLower.includes('pinelab')) {
    return mapPinelabRow(r, normalizedRow, providerLower, index);
  } else if (providerLower.includes('yesbank') || providerLower.includes('yes_bank')) {
    return mapYesBankRow(r, normalizedRow, providerLower, index);
  } else {
    return mapTeleringRow(r, normalizedRow, providerLower, index);
  }
}

const previewCSV = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const provider = String(req.query.provider || req.body.provider || 'telering').trim().toLowerCase();

  try {
    const rawRows = parseUploadedFileToRows(req.file.path);
    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: "The uploaded file is empty or could not be parsed." });
    }

    const previewList = [];
    rawRows.forEach((r, idx) => {
      const { previewRow } = mapRowToNotificationEvent(r, provider, idx);
      if (previewRow.status !== 'FAILED') {
        previewList.push(previewRow);
      }
    });

    res.status(200).json({
      success: true,
      message: `Preview generated successfully (${previewList.length} records)`,
      data: previewList,
      totalRecords: previewList.length
    });
  } catch (error) {
    console.error("Error generating CSV preview:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to generate CSV preview"
    });
  } finally {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Failed to delete temp preview file:", err);
      });
    }
  }
});

const uploadPinelabNotifications = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const provider = String(req.query.provider || req.body.provider || 'telering').trim().toLowerCase();

  try {
    const rawRows = parseUploadedFileToRows(req.file.path);
    if (!rawRows || rawRows.length === 0) {
      return res.status(400).json({ success: false, message: "The uploaded file is empty or could not be parsed." });
    }

    let processedCount = 0;
    for (let i = 0; i < rawRows.length; i++) {
      const { event } = mapRowToNotificationEvent(rawRows[i], provider, i);
      if (event.txnId && event.status !== 'FAILED') {
        await processRzpNotification(event, provider);
        processedCount++;
      }
    }

    res.status(200).json({
      success: true,
      message: `${provider.toUpperCase()} notifications uploaded and queued successfully (${processedCount} records)`,
      count: processedCount
    });
  } catch (error) {
    console.error("Error uploading provider notifications:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process uploaded file"
    });
  } finally {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Failed to delete temp upload file:", err);
      });
    }
  }
});

module.exports = {
  uploadCSV,
  getAllTransaction,
  getTransactionByID,
  getAllFileUpload,
  getFilteredTransactions,
  previewCSV,
  uploadPinelabNotifications,
  mapRowToNotificationEvent
};


