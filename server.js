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
// start CredXPay pending resolver cron
require('./cron/resolvePendingCredxpay');

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

app.use("/api/pos-machine", require("./routes/posMachineRoutes"));
app.use("/api/user", require("./routes/userRoutes"));
app.use("/api/transaction", require("./routes/transactionRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/franchaise", require("./routes/franchaiseRoutes"));
app.use("/api/merchant", require("./routes/merchantRoutes"));
app.use('/api/payment/v1', require('./routes/payments/sddsRoutes'));
app.use('/api/payment/v2', require('./routes/payments/branchxRoutes'));
app.use('/api/credit-bill', require('./routes/cc/billAvenue/creditBillRoutes'));
app.use('/api/bbps-cc', require('./routes/cc/bbps/bbpsCCBillRoutes'));
app.use('/api/wallet', require('./routes/walletTransactionRoutes'));
app.use('/api/charge', require('./routes/chargeRoutes'));
app.use('/api/company-name', require('./routes/companyNameRoutes'));
app.use('/api/pos-charge', require('./routes/posChargeRoutes'));
app.use('/api/commission', require('./routes/commissionRoutes'));
app.use('/api/rental', require('./routes/rentalRoutes'));
app.use('/api/service-fee', require('./routes/serviceFeeRoutes'));
app.use('/api/payout-charge', require('./routes/payoutChargeRoutes'));
app.use('/api/pos-transaction-charge', require('./routes/posTransactionChargeRoutes'));
// new charge rule engine (see posChargeRuleRoutes)
app.use('/api/pos-charge-rules', require('./routes/posChargeRuleRoutes'));
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
app.use('/api/vimo', require('./routes/vimoRoutes'));
// Direct-login feature: DL token management (admin-protected) + exchange endpoint (uses dl_token as credential)
app.use('/api/admin',   require('./routes/directLoginRoutes'));

app.get('/api/ping', (req, res) => res.send('Server is running!'));

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

app.use(errorHandler)

const startServer = async () => {
  try {
    await connectDb(); // Connect to DB
    // Only sync when explicitly enabled via SYNC_DB=true — never in production.
    // Relying solely on NODE_ENV was fragile: if PM2 starts the app without the
    // ecosystem config (e.g. `pm2 start server.js`) NODE_ENV is undefined and
    // db.sync({ alter: true }) would run against the live database, causing FK
    // constraint violations when it tries to add constraints over orphaned rows.
    if (process.env.SYNC_DB === 'true' && process.env.NODE_ENV !== 'production') {
      await db.sync({ alter: true }); // Sync models in dev only — use migrations in production
    }

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("❌ Server start failed:", err.message);
    process.exit(1);
  }
};

startServer();
