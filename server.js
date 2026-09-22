// load environment variables from project root .env regardless of cwd
require('dotenv').config({ path: __dirname + '/.env' });

const express = require("express");
const { errorHandler } = require("./middleware/errorHandler");
const connectDb = require("./config/dbConnection");
const db = require('./config/database');
// initialize model associations (models export .associate but need to be invoked)
require('./models/initAssociations');
const fileUpload = require('express-fileupload');

// Import workers to start processing queues
require("./workers/walletWorker"); // Existing wallet worker
require("./workers/razorpayWebhookWorker"); // Razorpay webhook worker
require("./workers/worldlineWebhookWorker"); // Worldline webhook worker
// start BranchX pending resolver cron (scheduled status-check polling)
require('./cron/resolvePendingBranchx');

// start SevenPay pending resolver cron (scheduled status-check polling)
require('./cron/resolvePendingSevenpay');

// start MeroRecharge (Payout-M-X) pending resolver cron
require('./cron/resolvePendingMx');

// start NDIA5 pending resolver cron
try {
  require('./cron/resolvePendingNdia5');
} catch (ndia5CronErr) {
  console.error('[NDIA5 Cron Startup Warning] Could not start NDIA5 cron:', ndia5CronErr.message || ndia5CronErr);
}

// start CcBillPayment pending resolver cron (scheduled status-check polling)
require('./cron/resolvePendingCcBillPayment');
require('./cron/resolvePendingBillAvenueCcBill');

// start settlement hold releaser cron (next-day settlement)
require('./cron/releaseSettlementHolds');
// start daily T1 -> T0 auto-settlement cron
require('./cron/autoSettlementCron');
// start POS machine rental charge cron (daily billing after 30-day cycles)
require('./cron/chargeRentals');

const app = express();

const port = process.env.PORT || 5000;
const cors = require('cors');

// ── CORS — must be registered FIRST, before any other middleware ─────────────
// Without this, the browser's OPTIONS preflight (triggered by the Authorization
// header) never gets a valid response, causing the request to hang / time-out
// in the browser even though Postman (which skips preflight) works fine.
const corsOptions = {
  // For Production, replace '*' with your actual frontend origin(s):
  //   origin: [process.env.DOMAIN_NAME, process.env.STAGING_DOMAIN_NAME],
  origin: '*',
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200, // IE11 chokes on 204
};

app.use(cors(corsOptions));

// Explicitly handle every OPTIONS preflight before it reaches any route or
// authentication middleware (validateToken would reject it with 401 otherwise).

// ── Static file serving for uploaded assets (popup images, etc.) ─────────────
// Must be registered before API routes so /uploads/* is served directly
// without passing through auth middleware.
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.options('*', cors(corsOptions));

// Apply express-fileupload conditionally only to routes that need it
// (merchant/franchaise onboard routes) to avoid conflict with multer
const fileUploadMiddleware = fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  limits: {
    fileSize: 1024 * 1024 * 5, // 5MB
  },
  abortOnLimit: true,
});

app.use((req, res, next) => {
  // Apply fileUpload only to routes that handle file uploads
  if (req.path.startsWith('/api/merchant/') && req.path.endsWith('/onboard')) {
    return fileUploadMiddleware(req, res, next);
  }
  if (req.path.startsWith('/api/franchaise/') && req.path.endsWith('/onboard')) {
    return fileUploadMiddleware(req, res, next);
  }
  if (req.path === '/api/user/register') {
    return fileUploadMiddleware(req, res, next);
  }
  // allow file uploads when updating a user profile as well
  if (req.method === 'PUT' && req.path.match(/^\/api\/user\/\d+$/)) {
    return fileUploadMiddleware(req, res, next);
  }
  next();
});

// BranchX payout callbacks may arrive as raw encrypted text, so parse that
// callback route as raw bytes before the global JSON parser runs.
app.use('/api/payment/v2/payout/callback', express.raw({ type: '*/*', limit: '1mb' }));

// strict: false lets body-parser accept any valid JSON top-level value (null,
// number, string) instead of only arrays/objects, so a frontend that sends
// the literal body `null` no longer causes a 400 parse error.
app.use(express.json({ strict: false }));

// Normalize a JSON-null body to an empty object so all route handlers see {}.
app.use((req, res, next) => {
  if (req.body === null) req.body = {};
  next();
});

// Catch body-parser errors for truly malformed JSON (not null) and return 400.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({ success: false, message: 'Invalid request body.' });
  }
  next(err);
});

app.use('/uploads', express.static('uploads'));

app.use('/', require('./routes/pinelabsTestPageRoutes'));
app.use("/api/pos-machine", require("./routes/posMachineRoutes"));
app.use("/api/user", require("./routes/userRoutes"));
app.use("/api/transaction", require("./routes/transactionRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/admin/employee-access-roles", require("./routes/employeeAccessRoleRoutes"));
app.use("/api/franchaise", require("./routes/franchaiseRoutes"));
app.use("/api/merchant", require("./routes/merchantRoutes"));
app.use('/api/payment/v1', require('./routes/payments/sddsRoutes'));
app.use('/api/payment/v2', require('./routes/payments/branchxRoutes'));
app.use('/api/pinelabs', require('./routes/pinelabsCallbackRoutes'));
app.use('/api/credit-bill', require('./routes/cc/billAvenue/creditBillRoutes'));
app.use('/api/bill-avenue', require('./routes/cc/billAvenue/billAvenueRoutes'));
app.use('/api/bbps-cc', require('./routes/cc/bbps/bbpsCCBillRoutes'));
app.use('/api/wallet', require('./routes/walletTransactionRoutes'));
app.use('/api/charge', require('./routes/chargeRoutes'));
app.use('/api/company-name', require('./routes/companyNameRoutes'));
app.use('/api/pos-charge', require('./routes/posChargeRoutes'));
app.use('/api/commission', require('./routes/commissionRoutes'));
app.use('/api/rental', require('./routes/rentalRoutes'));
app.use('/api/service-fee', require('./routes/serviceFeeRoutes'));
app.use('/api/payout-charge', require('./routes/payoutChargeRoutes'));
app.use('/api/user-payout-charge', require('./routes/userPayoutChargeRoutes'));
app.use('/api/payout', require('./routes/payoutRoutes'));
app.use('/api/sevenpay', require('./routes/sevenpayPayout.routes'));
app.use('/api/payout-sevenpay', require('./routes/sevenpayPayout.routes'));
app.use('/api/ndia5', require('./routes/ndia5Payout.routes'));
app.use('/api/india5', require('./routes/ndia5Payout.routes'));
// Note: /api/shared proxy is hosted on central API Portal (Reseller API), POS-SERVER consumes it as client only.
app.use('/api/pos-transaction-charge', require('./routes/posTransactionChargeRoutes'));
// new charge rule engine (see posChargeRuleRoutes)
app.use('/api/pos-charge-rules', require('./routes/posChargeRuleRoutes'));

// POS reconciliation
app.use('/api/reconciliation', require('./routes/reconciliationRoutes'));

app.use('/api/ledger', require('./routes/ledgerRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));


// CredXPay payout integration (separate from existing BranchX routes)
app.use('/payout/credxpay', require('./routes/credxpay/payout'));
// app.use('/payout/credxpay/beneficiaries', require('./routes/credxpay/beneficiary'));
// app.use('/api/vimo/beneficiaries', require('./routes/credxpay/beneficiary')); // deprecated in favor of Vimo native beneficiaries
app.use('/payout/credxpay/callback', require('./routes/credxpay/webhook'));
app.use('/api/complaint', require('./routes/complaintRoutes'));
app.use('/api/report', require('./routes/reportRoutes'));
app.use('/api/kyc', require('./routes/kycRoutes'));
app.use('/api/razorpay', require('./routes/razorpay/webhook/notificationRoutes'));
app.use('/api/worldline', require('./routes/worldline/webhook/notificationRoutes'));
app.use('/api/worldline-notifications', require('./routes/worldline/webhook/notificationRoutes'));
app.use('/api/vimo', require('./routes/vimoRoutes'));
// Direct-login feature: DL token management (admin-protected) + exchange endpoint (uses dl_token as credential)
app.use('/api/admin',   require('./routes/directLoginRoutes'));

app.get('/api/ping', async (req, res) => {
  try {
    const User = require('./models/User');
    const PosChargeRule = require('./models/PosChargeRule');
    const ChargeService = require('./services/chargeService');

    const user = await User.findByPk(41);
    const rules = await PosChargeRule.findAll({
      where: {
        card_brand: {
          [require('sequelize').Op.or]: [
            { [require('sequelize').Op.like]: '%MASTER%' },
            { [require('sequelize').Op.like]: '%master%' },
            { [require('sequelize').Op.eq]: 'MASTERCARD' },
            { [require('sequelize').Op.eq]: 'MASTER_CARD' },
            { [require('sequelize').Op.eq]: 'MASTER' }
          ]
        }
      }
    });

    let resolvedRule = null;
    if (user) {
      resolvedRule = await ChargeService.getTransactionChargeRule({
        userId: user.id,
        userRole: user.role,
        franchiseId: user.franchaise_id || null,
        paymentMode: 'CARD',
        cardType: 'CREDIT',
        cardBrand: 'MASTERCARD',
        classification: '-',
        settlement: user.settlement_type || null,
        amount: 102626
      });
    }

    res.json({
      success: true,
      user: user ? {
        id: user.id,
        name: user.name,
        role: user.role,
        settlement_type: user.settlement_type,
        franchaise_id: user.franchaise_id
      } : null,
      resolvedRule,
      rulesCount: rules.length,
      rules: rules.map(r => r.toJSON ? r.toJSON() : r)
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// debug helper – exposes current IPAY env vars (remove in production)
app.get('/api/debug/ipay', (req, res) => {
  const id = process.env.IPAY_OUTLET_ID || null;
  console.log('[debug/ipay] IPAY_CLIENT_ID=', id);
  if (id) {
    // JSON response is easier to inspect
    return res.json({ IPAY_OUTLET_ID: id });
  }
  // send simple text when not configured
  res.type('text').send('IPAY_CLIENT_ID not set');
});
// testing helpers
app.use('/api/test', require('./routes/testRoutes'));

app.use('/api/test', require('./routes/pinelabsTestApiRoutes'));
app.use(errorHandler)

const runStartupPayoutCheck = async () => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { Op } = require('sequelize');
    const PayoutTransaction = require('./models/PayoutTransaction');
    const User = require('./models/User');
    const Ledger = require('./models/Ledger');
    const ledgerService = require('./services/ledgerService');

    const logFile = path.join(__dirname, 'logs/mx-payout.log');
    
    // Ensure log directory exists
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logMessage = (msg) => {
      const ts = new Date().toISOString();
      fs.appendFileSync(logFile, `[${ts}] [DIAGNOSE_LEDGER] ${msg}\n`);
      console.log(`[DIAGNOSE_LEDGER] ${msg}`);
    };

    const runDiagnosticForRef = async (refIdentifier, isId = false) => {
      logMessage(`\n--- DIAGNOSTIC FOR: ${refIdentifier} ---`);
      
      const query = isId ? { id: refIdentifier } : { reference_id: refIdentifier };
      const row = await PayoutTransaction.findOne({ where: query });
      
      if (!row) {
        logMessage(`ERROR: PayoutTransaction not found for ${refIdentifier}`);
        return;
      }

      logMessage(`PayoutTransaction Found | ID: ${row.id} | Ref ID: ${row.reference_id} | Merchant ID: ${row.merchant_id} | Amount: ${row.amount} | Service Charge: ${row.service_charge} | Status: ${row.status} | CreatedAt: ${row.createdAt}`);

      const user = await User.findByPk(row.merchant_id);
      if (user) {
        logMessage(`Merchant Name: ${user.name} | Role: ${user.role}`);
      }

      // Check ledger entries by reference_id / reference_table
      const ledgerByRef = await Ledger.findAll({
        where: {
          reference_table: 'PayoutTransactions',
          reference_id: row.id
        }
      });
      logMessage(`Found ${ledgerByRef.length} ledger entries by reference matching:`);
      ledgerByRef.forEach(entry => {
        logMessage(`Ledger ID: ${entry.id} | Type: ${entry.transaction_type} | Debit: ₹${entry.debit} | Credit: ₹${entry.credit} | Description: "${entry.description}" | Balance After: ₹${entry.balance} | Created At: ${entry.createdAt}`);
      });

      // Check ledger entries by description wildcard
      let localRef = 'N/A';
      try {
        const txData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        localRef = txData?.localRequestId || 'N/A';
      } catch (_) {}

      const ledgerByDesc = await Ledger.findAll({
        where: {
          user_id: row.merchant_id,
          [Op.or]: [
            { description: { [Op.like]: `%${row.reference_id}%` } },
            { description: { [Op.like]: `%${localRef}%` } }
          ]
        }
      });
      logMessage(`Found ${ledgerByDesc.length} ledger entries by description wildcard:`);
      ledgerByDesc.forEach(entry => {
        logMessage(`Ledger ID: ${entry.id} | Type: ${entry.transaction_type} | Debit: ₹${entry.debit} | Credit: ₹${entry.credit} | Description: "${entry.description}" | Balance After: ₹${entry.balance} | Created At: ${entry.createdAt}`);
      });
    };

    // Run for both
    await runDiagnosticForRef(14391, true); // 1 Lakh txn
    await runDiagnosticForRef('APM0000096912', false); // 43,089 INR failed txn

    logMessage(`--- ALL DIAGNOSTICS COMPLETED ---`);

    // Reconcile/auto-refund loop for FAILED Payout MX transactions
    logMessage(`\n--- STARTING STARTUP LEDGER RECONCILIATION FOR FAILED PAYOUT MX TRANSACTIONS ---`);
    const PayoutAuditLog = require('./models/PayoutAuditLog');
    const db = require('./config/database');

    const failedMxTxns = await PayoutTransaction.findAll({
      where: {
        status: 'FAILED',
        payout_provider: 'Payout-M-X'
      }
    });

    logMessage(`Found ${failedMxTxns.length} FAILED Payout MX transaction(s). Checking for missing refunds...`);

    for (const tx of failedMxTxns) {
      // Check if it has a debit entry
      const debitEntry = await Ledger.findOne({
        where: {
          transaction_type: 'payout',
          reference_table: 'PayoutTransactions',
          reference_id: tx.id
        }
      });

      if (debitEntry) {
        // Check if it has a refund entry
        const refundEntry = await Ledger.findOne({
          where: {
            transaction_type: 'payout_refund',
            reference_table: 'PayoutTransactions',
            reference_id: tx.id
          }
        });

        if (!refundEntry) {
          logMessage(`[RECONCILE] Transaction ID ${tx.id} (${tx.reference_id}) is FAILED but missing refund. Processing automatic refund...`);
          
          const amount = parseFloat(tx.amount || 0);
          const serviceCharge = parseFloat(tx.service_charge || 0);
          const refundAmount = amount + serviceCharge;

          if (refundAmount > 0) {
            const tr = await db.transaction();
            try {
              const entry = await ledgerService.createLedgerEntry({
                userId: tx.merchant_id,
                transactionType: 'payout_refund',
                referenceId: tx.id,
                referenceTable: 'PayoutTransactions',
                description: `Reconciled refund for failed Payout MX payout ${tx.reference_id}`,
                credit: refundAmount,
                metadata: {
                  payout_provider: 'Payout-M-X',
                  payout_reference: tx.reference_id,
                  original_payout_amount: String(amount),
                  original_service_charge: String(serviceCharge),
                  refund_source: 'startup_reconcile'
                }
              }, { transaction: tr });

              await PayoutAuditLog.create({
                payout_id: tx.id,
                action: 'MX_STARTUP_RECONCILE_REFUND',
                details: {
                  reference_id: tx.reference_id,
                  refundAmount,
                  ledgerId: entry?.id
                }
              }, { transaction: tr });

              await tr.commit();
              logMessage(`[RECONCILE] Successfully refunded ₹${refundAmount} to merchant ID ${tx.merchant_id} for payout ${tx.reference_id} (Ledger ID: ${entry?.id})`);
            } catch (err) {
              await tr.rollback();
              logMessage(`[RECONCILE] ERROR processing refund for payout ${tx.reference_id}: ${err.message}`);
            }
          }
        } else {
          logMessage(`Transaction ID ${tx.id} (${tx.reference_id}) is FAILED and already refunded.`);
        }
      } else {
        logMessage(`Transaction ID ${tx.id} (${tx.reference_id}) is FAILED but has no debit ledger entry.`);
      }
    }

    logMessage(`--- RECONCILIATION COMPLETED ---`);
  } catch (err) {
    console.error('Failed to run startup ledger diagnostic:', err);
  }
};

const { autoSeedBillAvenueBillers } = require('./services/cc/billAvenue/billAvenueSeeder');

const startServer = async () => {
  try {
    await connectDb(); // Connect to DB
    // Auto-seed BillAvenue 36 Credit Card Billers into PostgreSQL DB if not present
    await autoSeedBillAvenueBillers();

    // Only sync when explicitly enabled via SYNC_DB=true — never in production.
    if (process.env.SYNC_DB === 'true' && process.env.NODE_ENV !== 'production') {
      await db.sync({ alter: true }); // Sync models in dev only — use migrations in production
    }

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
      // Run payout check and write to log file
      runStartupPayoutCheck();
    });
  } catch (err) {
    console.error("❌ Server start failed:", err.message);
    process.exit(1);
  }
};

startServer();
