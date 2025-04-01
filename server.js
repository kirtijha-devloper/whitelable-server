const express = require("express");
const { errorHandler } = require("./middleware/errorHandler");
const dotenv = require("dotenv").config();
const connectDb = require("./config/dbConnection");
const db = require('./config/database');

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

app.use(cors())
app.use(express.json());

app.use('/uploads', express.static('uploads'));

app.use("/api/pos-machine", require("./routes/posMachineRoutes"));
app.use("/api/user", require("./routes/userRoutes"));
app.use("/api/transaction", require("./routes/transactionRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/franchaise", require("./routes/franchaiseRoutes"));
app.use("/api/merchant", require("./routes/merchantRoutes"));
app.use('/api/payment', require('./routes/payments/sddsRoutes'));
app.use('/api/credit-bill',require('./routes/cc/billAvenue/creditBillRoutes') )
app.use('/api/wallet', require('./routes/walletTransactionRoutes'));
app.use('/api/charge', require('./routes/chargeRoutes'));
app.get('/api/ping', (req, res) => res.send('Server is running!'));


app.use(errorHandler)

const startServer = async () => {
  try {
    await connectDb(); // Connect to DB
    await db.sync({ alter: true }); // Sync models in dev

    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (err) {
    console.error("❌ Server start failed:", err.message);
    process.exit(1);
  }
};

startServer();
