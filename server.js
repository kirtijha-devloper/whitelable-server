const express = require("express");
const { errorHandler } = require("./middleware/errorHandler");
const dotenv = require("dotenv").config();
const connectDb = require("./config/dbConnection");


connectDb();


const app = express();

const port = process.env.PORT || 5000;

app.use(express.json());


app.use("/api/pos_machine", require("./routes/posMachineRoutes"));
app.use("/api/user", require("./routes/userRoutes"));
app.use("/api/transaction", require("./routes/transactionRoutes"));


app.use(errorHandler)

app.listen(port, () => {
console.log(`Server running on port ${port}`);
});