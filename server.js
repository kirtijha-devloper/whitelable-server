const express = require("express");
const { errorHandler } = require("./middleware/errorHandler");
const dotenv = require("dotenv").config();
const connectDb = require("./config/dbConnection");


connectDb();


const app = express();
const cors = require('cors');
const allowedOrigins = [process.env.DOMAIN_NAME, process.env.STAGING_DOMAIN_NAME];

const port = process.env.PORT || 5000;
// For Production
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



app.use("/api/pos_machine", require("./routes/posMachineRoutes"));
app.use("/api/user", require("./routes/userRoutes"));
app.use("/api/transaction", require("./routes/transactionRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/franchaise", require("./routes/franchaiseRoutes"));
app.use("/api/merchant", require("./routes/merchantRoutes"));
app.use('/api/payment', require('./routes/payments/sddsRoutes'));
app.use('/api/credit-bill',require('./routes/cc/billAvenue/creditBillRoutes') )
app.get('/ping', (req, res) => res.send('Server is running!'));



app.use(errorHandler)

app.listen(port, () => {
console.log(`Server running on port ${port}`);
});