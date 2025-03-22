
const db = require('../config/database');
const { DataTypes } = require("sequelize");

const Transaction = db.define("Transaction", {
  ID: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
  },
  Date: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  Mobile: {
    type: DataTypes.STRING,
  },
  Email: {
    type: DataTypes.STRING,
  },
  Consumer: {
    type: DataTypes.STRING,
  },
  Username: {
    type: DataTypes.STRING,
  },
  Type: {
    type: DataTypes.STRING,
  },
  Mode: {
    type: DataTypes.STRING,
  },
  Amount: {
    type: DataTypes.FLOAT,
  },
  Tip: {
    type: DataTypes.FLOAT,
  },
  CashAtPOS: {
    type: DataTypes.FLOAT,
    field: "Cash at POS", // Use field to map to the CSV column name
  },
  TxnType: {
    type: DataTypes.STRING,
    field: "Txn Type",
  },
  AuthCode: {
    type: DataTypes.STRING,
    field: "Auth Code",
  },
  Card: {
    type: DataTypes.STRING,
  },
  CardType: {
    type: DataTypes.STRING,
    field: "Card Type",
  },
  BrandType: {
    type: DataTypes.STRING,
    field: "Brand Type",
  },
  CardClassification: {
    type: DataTypes.STRING,
    field: "Card Classification",
  },
  CardTxnType: {
    type: DataTypes.STRING,
    field: "Card Txn Type",
  },
  RRN: {
    type: DataTypes.STRING,
  },
  Invoice: {
    type: DataTypes.STRING,
    field: "Invoice#",
  },
  DeviceSerial: {
    type: DataTypes.STRING,
    field: "Device Serial",
  },
  Status: {
    type: DataTypes.STRING,
  },
  SettledOn: {
    type: DataTypes.DATE,
    field: "Settled On",
  },
  Labels: {
    type: DataTypes.STRING,
  },
  MID: {
    type: DataTypes.STRING,
  },
  TID: {
    type: DataTypes.STRING,
  },
  Batch: {
    type: DataTypes.STRING,
    field: "Batch#",
  },
  Ref1: {
    type: DataTypes.STRING,
    field: "Ref#",
  },
  Ref2: {
    type: DataTypes.STRING,
    field: "Ref# 2",
  },
  Ref3: {
    type: DataTypes.STRING,
    field: "Ref# 3",
  },
  Ref4: {
    type: DataTypes.STRING,
    field: "Ref# 4",
  },
  Ref5: {
    type: DataTypes.STRING,
    field: "Ref# 5",
  },
  Ref6: {
    type: DataTypes.STRING,
    field: "Ref# 6",
  },
  Ref7: {
    type: DataTypes.STRING,
    field: "Ref# 7",
  },
  ReceiptNo: {
    type: DataTypes.STRING,
    field: "Receipt No",
  },
  ErrorCode: {
    type: DataTypes.STRING,
    field: "Error Code",
  },
  AdditionalInformation: {
    type: DataTypes.STRING,
    field: "Additional Information",
  },
  PGErrorCode: {
    type: DataTypes.STRING,
    field: "PG Error Code",
  },
  PGErrorMessage: {
    type: DataTypes.STRING,
    field: "PG Error Message",
  },
  Latitude: {
    type: DataTypes.FLOAT,
  },
  Longitude: {
    type: DataTypes.FLOAT,
  },
  Payer: {
    type: DataTypes.STRING,
  },
  TIDLocation: {
    type: DataTypes.STRING,
    field: "TID Location",
  },
  DXMode: {
    type: DataTypes.STRING,
    field: "DX Mode",
  },
  AcquiringBank: {
    type: DataTypes.STRING,
    field: "Acquiring Bank",
  },
  IssuingBank: {
    type: DataTypes.STRING,
    field: "Issuing Bank",
  },
  EMITenure: {
    type: DataTypes.INTEGER,
    field: "EMI Tenure",
  },
  EMIInterestRate: {
    type: DataTypes.FLOAT,
    field: "EMI Interest Rate",
  },
  EMIAmt: {
    type: DataTypes.FLOAT,
    field: "EMI Amt",
  },
  TotalAmtWithIntr: {
    type: DataTypes.FLOAT,
    field: "Total Amt (With Intr)",
  },
  CashbackPercent: {
    type: DataTypes.FLOAT,
    field: "Cashback%",
  },
  CashbackAmt: {
    type: DataTypes.FLOAT,
    field: "Cashback Amt",
  },
  PaybackPercent: {
    type: DataTypes.FLOAT,
    field: "Payback%",
  },
  PaybackAmt: {
    type: DataTypes.FLOAT,
    field: "Payback Amt",
  },
  InstantEMIDiscountPercent: {
    type: DataTypes.FLOAT,
    field: "Instant EMI discount%",
  },
  InstantEMIDiscount: {
    type: DataTypes.FLOAT,
    field: "Instant EMI discount",
  },
  NetCost: {
    type: DataTypes.FLOAT,
    field: "Net Cost",
  },
  EMIStatus: {
    type: DataTypes.STRING,
    field: "EMI Status",
  },
  Manufacturer: {
    type: DataTypes.STRING,
  },
  ProductName: {
    type: DataTypes.STRING,
    field: "Product Name",
  },
  SkuCode: {
    type: DataTypes.STRING,
    field: "Sku code",
  },
  ProductSerial: {
    type: DataTypes.STRING,
    field: "Product Serial",
  },
  SchemeName: {
    type: DataTypes.STRING,
    field: "Scheme Name",
  },
  ReceiptURL: {
    type: DataTypes.STRING,
    field: "Receipt URL",
  },

  FileName: {
    type: DataTypes.STRING,
    field: "Receipt URL"}
});

module.exports = Transaction;