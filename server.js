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

const app = express();

const port = process.env.PORT || 5000;
const cors = require('cors');
// For Production
// const allowedOrigins = [process.env.DOMAIN_NAME, process.env.STAGING_DOMAIN_NAME];
// app.use(cors({
//   origin: function(origin, callback){
//     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   }
// }));

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
  next();
});

app.use(cors())
app.use(express.json());

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
app.use('/api/pos-charge', require('./routes/posChargeRoutes'));
app.use('/api/commission', require('./routes/commissionRoutes'));
app.use('/api/rental', require('./routes/rentalRoutes'));
app.use('/api/payout-charge', require('./routes/payoutChargeRoutes'));
app.use('/api/pos-transaction-charge', require('./routes/posTransactionChargeRoutes'));
app.use('/api/ledger', require('./routes/ledgerRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/complaint', require('./routes/complaintRoutes'));
app.use('/api/report', require('./routes/reportRoutes'));
app.use('/api/razorpay', require('./routes/razorpay/webhook/notificationRoutes'));

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
