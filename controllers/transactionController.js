const asyncHandler = require("express-async-handler")
const fs = require("fs");
const csvParser = require("csv-parser");
const Transaction = require("../models/Transaction");
const WalletTransaction = require("../models/WalletTransaction")
const { Op } = require("sequelize");
const PosMachine = require("../models/posMachine");
const User = require("../models/User");
const ChargeService = require("../services/chargeService");

function cleanCsvValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/'/g, '').trim();
  return text === '' ? null : text;
}

function firstCsvValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    const cleaned = cleanCsvValue(value);
    if (cleaned !== null) return cleaned;
  }
  return null;
}

function normalizeCsvId(id) {
  const cleaned = cleanCsvValue(id);
  if (!cleaned) return null;
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return cleaned;
  const stripped = digits.replace(/^0+/, '');
  return stripped || digits;
}

function parseAmount(value) {
  const cleaned = cleanCsvValue(value);
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCsvDate(value) {
  const cleaned = cleanCsvValue(value);
  if (!cleaned) return null;
  return cleaned;
}

function extractCardBrandFromSubType(value) {
  const cleaned = cleanCsvValue(value);
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  const patterns = [
    { brand: 'VISA', regex: /\bVISA\b/ },
    { brand: 'MASTERCARD', regex: /\bMASTER\s*CARD\b|\bMASTERCARD\b|\bMASTER\b/ },
    { brand: 'RUPAY', regex: /\bRUPAY\b/ },
    { brand: 'AMEX', regex: /\bAMERICAN\s*EXPRESS\b|\bAMEX\b/ },
    { brand: 'DINERS', regex: /\bDINERS\s*CLUB\b|\bDINERS\b/ },
    { brand: 'DISCOVER', regex: /\bDISCOVER\b/ },
    { brand: 'JCB', regex: /\bJCB\b/ },
    { brand: 'UNIONPAY', regex: /\bUNION\s*PAY\b|\bUNIONPAY\b/ },
    { brand: 'MAESTRO', regex: /\bMAESTRO\b/ }
  ];

  for (const candidate of patterns) {
    if (candidate.regex.test(upper)) {
      return candidate.brand;
    }
  }

  return null;
}

function extractCardSubTypeFromRaw(value, derivedBrand = null) {
  const cleaned = cleanCsvValue(value);
  if (!cleaned) return null;

  const brandTokens = new Set();
  const brand = cleanCsvValue(derivedBrand);
  if (brand) {
    const normalizedBrand = String(brand).toUpperCase();
    brandTokens.add(normalizedBrand);
    const mappedBrand = ChargeService.normalizeCardBrand(normalizedBrand);
    if (mappedBrand) {
      brandTokens.add(mappedBrand);
    }
    if (normalizedBrand === 'MASTERCARD') {
      brandTokens.add('MASTER CARD');
      brandTokens.add('MASTER');
    }
    if (normalizedBrand === 'AMEX') {
      brandTokens.add('AMERICAN EXPRESS');
    }
    if (normalizedBrand === 'DINERS') {
      brandTokens.add('DINERS CLUB');
    }
    if (normalizedBrand === 'UNIONPAY') {
      brandTokens.add('UNION PAY');
    }
  }

  const tokens = cleaned
    .replace(/[_/|,+-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const filteredTokens = tokens.filter((token) => {
    const upper = token.toUpperCase();
    return upper !== 'CARD' && !brandTokens.has(upper);
  });

  if (!filteredTokens.length) {
    return cleaned;
  }

  return filteredTokens.join(' ');
}

function readCsvRows(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function removeUploadedFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error("Failed to delete uploaded file:", error);
    }
  }
}

function buildPreviewDebugInfo({
  midRaw,
  tidRaw,
  amountRaw,
  txnIdRaw,
  dateRaw,
  paymentModeRaw,
  cardTypeRaw,
  cardBrandRaw,
  cardSubTypeRaw,
  mid,
  tid,
  amount,
  txn_id,
  date,
  paymentMode,
  cardType,
  cardBrand,
  cardSubType,
  posMachine,
  user,
  rule,
  charge,
  leftAmount,
  match_status,
  note
}) {
  const cardBrandCandidates = cardBrand ? ChargeService.getCardBrandCandidates(cardBrand) : [];
  const reasons = [];
  const checks = [];

  const hasRequiredFields = Boolean(mid && tid && amount !== null && txn_id && date);
  checks.push({
    step: 'Required fields',
    ok: hasRequiredFields,
    detail: hasRequiredFields
      ? 'MID, TID, txn_id, amount and date were all present.'
      : 'MID, TID, txn_id, amount or date is missing.'
  });
  if (!hasRequiredFields) {
    reasons.push('Preview skipped rule lookup because one or more required fields are missing.');
  }

  const hasPosMachine = Boolean(posMachine);
  checks.push({
    step: 'POS machine match',
    ok: hasPosMachine,
    detail: hasPosMachine
      ? `Matched active POS machine ${posMachine.id || ''}`.trim()
      : 'No active POS machine matched the MID + TID combination.'
  });
  if (hasRequiredFields && !hasPosMachine) {
    reasons.push('MID + TID did not match any active POS machine.');
  }

  const hasUser = Boolean(user);
  checks.push({
    step: 'User match',
    ok: hasUser,
    detail: hasUser
      ? `Resolved user ${user.name || user.id || 'unknown'}`
      : hasPosMachine
        ? 'POS machine matched, but no assigned user was found.'
        : 'Skipped because POS machine was not found.'
  });
  if (hasPosMachine && !hasUser) {
    reasons.push('POS machine matched, but there is no assigned user to derive a charge rule from.');
  }

  const hasRule = Boolean(rule);
  checks.push({
    step: 'Charge rule',
    ok: hasRule,
    detail: hasRule
      ? `Matched charge rule scope ${rule.scope || 'unknown'}`
      : 'No active charge rule matched the resolved criteria.'
  });

  if (hasUser && !hasRule) {
    const brandInfo = cardBrandCandidates.length
      ? `Card brand lookup candidates were: ${cardBrandCandidates.join(', ')}.`
      : 'No card brand value was available for lookup.';
    reasons.push('No active POS charge rule matched the resolved payment mode, card type, card brand, card classification, settlement type, and amount slab.');
    reasons.push(brandInfo);
  }

  if (hasRule) {
    const rulePercent = Number(rule.charge_percent || 0);
    const ruleFlat = Number(rule.charge_flat || 0);
    checks.push({
      step: 'Rule fee config',
      ok: rulePercent > 0 || ruleFlat > 0,
      detail: `charge_percent=${rulePercent}, charge_flat=${ruleFlat}`
    });

    if (rulePercent === 0 && ruleFlat === 0) {
      reasons.push('A matching rule exists, but the configured fee itself is zero.');
    }

    if (Number(amount || 0) === 0) {
      reasons.push('Transaction amount is 0, so percentage-based charge resolves to 0.');
    }

    if (charge === 0 && Number(amount || 0) > 0 && (rulePercent > 0 || ruleFlat > 0)) {
      reasons.push('Computed charge rounds down to 0.00 for this amount and rule combination.');
    }
  }

  if (!reasons.length) {
    reasons.push(hasRule ? 'Charge calculated successfully.' : 'No matching rule was found.');
  }

  return {
    summary: reasons[0],
    reasons,
    checks,
    inputs: {
      raw: {
        mid: midRaw,
        tid: tidRaw,
        amount: amountRaw,
        txn_id: txnIdRaw,
        date: dateRaw,
        payment_mode: paymentModeRaw,
        card_type: cardTypeRaw,
        card_brand: cardBrandRaw,
        card_sub_type: cardSubTypeRaw
      },
      normalized: {
        mid,
        tid,
        amount,
        txn_id,
        date,
        payment_mode: paymentMode,
        card_type: cardType,
        card_brand: cardBrand,
        card_sub_type: cardSubType,
        card_brand_candidates: cardBrandCandidates
      }
    },
    match: {
      match_status,
      note,
      pos_machine_id: posMachine?.id || null,
      user_id: user?.id || null,
      user_name: user?.name || null
    },
    rule: hasRule
      ? {
          id: rule.id || null,
          scope: rule.scope || null,
          payment_mode: rule.payment_mode || null,
          settlement_type: rule.settlement_type || null,
          card_classification: rule.card_classification || null,
          card_type: rule.card_type || null,
          card_brand: rule.card_brand || null,
          min_amount: rule.min_amount ?? null,
          max_amount: rule.max_amount ?? null,
          charge_percent: rule.charge_percent ?? null,
          charge_flat: rule.charge_flat ?? null,
          gst_required: rule.gst_required ?? null,
          gst_percent: rule.gst_percent ?? null,
          specificity: rule.specificity ?? null
        }
      : null,
    charge: {
      amount,
      charge,
      left_amount: leftAmount,
      charge_percentage: hasRule ? Number(rule.charge_percent || 0) : null
    }
  };
}

async function resolvePreviewContext(row) {
  const midRaw = firstCsvValue(row, ['MID', 'Mid', 'mid', 'Merchant ID', 'merchant_id']);
  const tidRaw = firstCsvValue(row, ['TID', 'Tid', 'tid', 'Terminal ID', 'terminal_id']);
  const amountRaw = firstCsvValue(row, ['Amount', 'amount', 'Txn Amount', 'Transaction Amount']);
  const txnIdRaw = firstCsvValue(row, ['Transaction ID', 'transaction_id', 'txn_id', 'Txn ID', 'ID']);
  const dateRaw = firstCsvValue(row, ['Date', 'date', 'Txn Date', 'Transaction Date']);
  const paymentModeRaw = firstCsvValue(row, ['Payment Mode', 'payment_mode', 'Mode', 'mode']);
  const cardTypeRaw = firstCsvValue(row, ['Card Type', 'card_type', 'CardType']);
  const cardBrandRaw = firstCsvValue(row, ['Card Network', 'card_network', 'Brand Type', 'Brand', 'Card Brand']);
  const cardSubTypeRaw = firstCsvValue(row, ['Card Colour', 'Card colour', 'Card Classification', 'card_classification', 'Card Colour ']);

  const mid = normalizeCsvId(midRaw);
  const tid = normalizeCsvId(tidRaw);
  const amount = parseAmount(amountRaw);
  const txn_id = cleanCsvValue(txnIdRaw);
  const date = parseCsvDate(dateRaw);
  const paymentMode = ChargeService.normalizeLookupValue(paymentModeRaw);
  const cardType = ChargeService.normalizeLookupValue(cardTypeRaw);
  const cardBrandHint = cardBrandRaw ? ChargeService.normalizeCardBrand(cardBrandRaw) : extractCardBrandFromSubType(cardSubTypeRaw);
  const cardSubType = cardSubTypeRaw ? extractCardSubTypeFromRaw(cardSubTypeRaw, cardBrandHint) : null;
  const cardBrand = cardBrandRaw
    ? ChargeService.normalizeCardBrand(cardBrandRaw)
    : cardBrandHint;

  if (!mid || !tid || amount === null || !txn_id || !date) {
    const debug = buildPreviewDebugInfo({
      midRaw,
      tidRaw,
      amountRaw,
      txnIdRaw,
      dateRaw,
      paymentModeRaw,
      cardTypeRaw,
      cardBrandRaw,
      cardSubTypeRaw,
      mid,
      tid,
      amount,
      txn_id,
      date,
      paymentMode,
      cardType,
      cardBrand,
      cardSubType,
      posMachine: null,
      user: null,
      rule: null,
      charge: 0,
      leftAmount: amount === null ? null : parseFloat(amount.toFixed(2)),
      match_status: 'missing_required_fields',
      note: 'MID, TID, txn_id, amount or date is missing'
    });

    return {
      mid: midRaw ? cleanCsvValue(midRaw) : null,
      tid: tidRaw ? cleanCsvValue(tidRaw) : null,
      txn_id,
      amount,
      date,
      charge: 0,
      charge_percentage: null,
      left_amount: amount === null ? null : parseFloat(amount.toFixed(2)),
      card_type: cardType,
      card_brand: cardBrand,
      card_sub_type: cardSubType,
      user_id: null,
      user_name: null,
      pos_machine_id: null,
      match_status: 'missing_required_fields',
      note: 'MID, TID, txn_id, amount or date is missing',
      debug
    };
  }

  const posMachines = await PosMachine.findAll({
    where: {
      status: 'active',
      tid_number: { [Op.in]: [tidRaw, tid].filter(Boolean) }
    }
  });

  let posMachine = null;
  for (const machine of posMachines) {
    const storedMid = normalizeCsvId(machine.mid_number);
    const storedTid = normalizeCsvId(machine.tid_number);
    if (storedMid === mid && storedTid === tid) {
      posMachine = machine;
      break;
    }
  }

  if (!posMachine) {
    const fallback = await PosMachine.findOne({
      where: {
        status: 'active',
        mid_number: { [Op.in]: [midRaw, mid].filter(Boolean) },
        tid_number: { [Op.in]: [tidRaw, tid].filter(Boolean) }
      }
    });
    if (fallback) {
      posMachine = fallback;
    }
  }

  if (!posMachine) {
    const debug = buildPreviewDebugInfo({
      midRaw,
      tidRaw,
      amountRaw,
      txnIdRaw,
      dateRaw,
      paymentModeRaw,
      cardTypeRaw,
      cardBrandRaw,
      cardSubTypeRaw,
      mid,
      tid,
      amount,
      txn_id,
      date,
      paymentMode,
      cardType,
      cardBrand,
      cardSubType,
      posMachine: null,
      user: null,
      rule: null,
      charge: 0,
      leftAmount: parseFloat(amount.toFixed(2)),
      match_status: 'pos_not_found',
      note: 'No active POS machine matched MID + TID'
    });

    return {
      mid,
      tid,
      txn_id,
      amount,
      date,
      charge: 0,
      charge_percentage: null,
      left_amount: parseFloat(amount.toFixed(2)),
      card_type: cardType,
      card_brand: cardBrand,
      card_sub_type: cardSubType,
      user_id: null,
      user_name: null,
      pos_machine_id: null,
      match_status: 'pos_not_found',
      note: 'No active POS machine matched MID + TID',
      debug
    };
  }

  const user = posMachine.assigned_to
    ? await User.findByPk(posMachine.assigned_to, {
        attributes: ['id', 'name', 'role', 'franchaise_id', 'settlement_type']
      })
    : null;

  if (!user) {
    const debug = buildPreviewDebugInfo({
      midRaw,
      tidRaw,
      amountRaw,
      txnIdRaw,
      dateRaw,
      paymentModeRaw,
      cardTypeRaw,
      cardBrandRaw,
      cardSubTypeRaw,
      mid,
      tid,
      amount,
      txn_id,
      date,
      paymentMode,
      cardType,
      cardBrand,
      cardSubType,
      posMachine,
      user: null,
      rule: null,
      charge: 0,
      leftAmount: parseFloat(amount.toFixed(2)),
      match_status: 'user_not_found',
      note: 'POS machine matched but no assigned user was found'
    });

    return {
      mid,
      tid,
      txn_id,
      amount,
      date,
      charge: 0,
      charge_percentage: null,
      left_amount: parseFloat(amount.toFixed(2)),
      card_type: cardType,
      card_brand: cardBrand,
      card_sub_type: cardSubType,
      user_id: null,
      user_name: null,
      pos_machine_id: posMachine.id,
      match_status: 'user_not_found',
      note: 'POS machine matched but no assigned user was found',
      debug
    };
  }

  const franchiseId = user.franchaise_id || (user.role === 'franchaise' ? user.id : null);
  const rule = await ChargeService.getTransactionChargeRule({
    userId: user.id,
    userRole: user.role,
    franchiseId,
    paymentMode,
    cardType,
    cardBrand,
    classification: cardSubType,
    settlement: user.settlement_type || null,
    amount
  });

  const chargeResult = ChargeService.calculateCharge(amount, rule);
  const charge = chargeResult.charge;
  const leftAmount = parseFloat((amount - charge).toFixed(2));
  const debug = buildPreviewDebugInfo({
    midRaw,
    tidRaw,
    amountRaw,
    txnIdRaw,
    dateRaw,
    paymentModeRaw,
    cardTypeRaw,
    cardBrandRaw,
    cardSubTypeRaw,
    mid,
    tid,
    amount,
    txn_id,
    date,
    paymentMode,
    cardType,
    cardBrand,
    cardSubType,
    posMachine,
    user,
    rule,
    charge,
    leftAmount,
    match_status: rule ? 'matched' : 'rule_not_found',
    note: rule ? null : 'POS machine and user matched, but no charge rule was found'
  });

  return {
    mid,
    tid,
    txn_id,
    amount,
    charge,
    charge_percentage: rule ? parseFloat(rule.charge_percent) : null,
    left_amount: leftAmount,
    card_type: cardType,
    card_brand: cardBrand,
    card_sub_type: cardSubType,
    date,
    user_id: user.id,
    user_name: user.name || null,
    pos_machine_id: posMachine.id,
    match_status: rule ? 'matched' : 'rule_not_found',
    note: rule ? null : 'POS machine and user matched, but no charge rule was found',
    debug
  };
}


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

const previewCSV = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  try {
    const rows = await readCsvRows(req.file.path);
    const previewRows = [];
    let totalAmount = 0;
    let totalCharge = 0;
    let totalLeftAmount = 0;

    for (const row of rows) {
      const preview = await resolvePreviewContext(row);
      previewRows.push(preview);

      totalAmount += typeof preview.amount === 'number' ? preview.amount : 0;
      totalCharge += typeof preview.charge === 'number' ? preview.charge : 0;
      totalLeftAmount += typeof preview.left_amount === 'number' ? preview.left_amount : 0;
    }

    res.status(200).json({
      success: true,
      message: "CSV preview generated successfully",
      count: previewRows.length,
      summary: {
        total_amount: parseFloat(totalAmount.toFixed(2)),
        total_charge: parseFloat(totalCharge.toFixed(2)),
        total_left_amount: parseFloat(totalLeftAmount.toFixed(2)),
      },
      data: previewRows
    });
  } catch (error) {
    console.error("Error generating CSV preview:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to preview CSV data",
    });
  } finally {
    await removeUploadedFile(req.file.path);
  }
});

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

// const triggerWalletRequest = asyncHandler(async (req, res) => {
  
// });

module.exports = { uploadCSV, previewCSV, getAllTransaction, getTransactionByID, getAllFileUpload, getFilteredTransactions };
