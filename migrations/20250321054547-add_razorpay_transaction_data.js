"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("Transactions", {
      ID: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
      Date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      Mobile: {
        type: Sequelize.STRING,
      },
      Email: {
        type: Sequelize.STRING,
      },
      Consumer: {
        type: Sequelize.STRING,
      },
      Username: {
        type: Sequelize.STRING,
      },
      Type: {
        type: Sequelize.STRING,
      },
      Mode: {
        type: Sequelize.STRING,
      },
      Amount: {
        type: Sequelize.FLOAT,
      },
      Tip: {
        type: Sequelize.FLOAT,
      },
      CashAtPOS: {
        type: Sequelize.FLOAT,
        field: "Cash at POS",
      },
      TxnType: {
        type: Sequelize.STRING,
        field: "Txn Type",
      },
      AuthCode: {
        type: Sequelize.STRING,
        field: "Auth Code",
      },
      Card: {
        type: Sequelize.STRING,
      },
      CardType: {
        type: Sequelize.STRING,
        field: "Card Type",
      },
      BrandType: {
        type: Sequelize.STRING,
        field: "Brand Type",
      },
      CardClassification: {
        type: Sequelize.STRING,
        field: "Card Classification",
      },
      CardTxnType: {
        type: Sequelize.STRING,
        field: "Card Txn Type",
      },
      RRN: {
        type: Sequelize.STRING,
      },
      Invoice: {
        type: Sequelize.STRING,
        field: "Invoice#",
      },
      DeviceSerial: {
        type: Sequelize.STRING,
        field: "Device Serial",
      },
      Status: {
        type: Sequelize.STRING,
      },
      SettledOn: {
        type: Sequelize.DATE,
        field: "Settled On",
      },
      Labels: {
        type: Sequelize.STRING,
      },
      MID: {
        type: Sequelize.STRING,
      },
      TID: {
        type: Sequelize.STRING,
      },
      Batch: {
        type: Sequelize.STRING,
        field: "Batch#",
      },
      Ref1: {
        type: Sequelize.STRING,
        field: "Ref#",
      },
      Ref2: {
        type: Sequelize.STRING,
        field: "Ref# 2",
      },
      Ref3: {
        type: Sequelize.STRING,
        field: "Ref# 3",
      },
      Ref4: {
        type: Sequelize.STRING,
        field: "Ref# 4",
      },
      Ref5: {
        type: Sequelize.STRING,
        field: "Ref# 5",
      },
      Ref6: {
        type: Sequelize.STRING,
        field: "Ref# 6",
      },
      Ref7: {
        type: Sequelize.STRING,
        field: "Ref# 7",
      },
      ReceiptNo: {
        type: Sequelize.STRING,
        field: "Receipt No",
      },
      ErrorCode: {
        type: Sequelize.STRING,
        field: "Error Code",
      },
      AdditionalInformation: {
        type: Sequelize.STRING,
        field: "Additional Information",
      },
      PGErrorCode: {
        type: Sequelize.STRING,
        field: "PG Error Code",
      },
      PGErrorMessage: {
        type: Sequelize.STRING,
        field: "PG Error Message",
      },
      Latitude: {
        type: Sequelize.FLOAT,
      },
      Longitude: {
        type: Sequelize.FLOAT,
      },
      Payer: {
        type: Sequelize.STRING,
      },
      TIDLocation: {
        type: Sequelize.STRING,
        field: "TID Location",
      },
      DXMode: {
        type: Sequelize.STRING,
        field: "DX Mode",
      },
      AcquiringBank: {
        type: Sequelize.STRING,
        field: "Acquiring Bank",
      },
      IssuingBank: {
        type: Sequelize.STRING,
        field: "Issuing Bank",
      },
      EMITenure: {
        type: Sequelize.INTEGER,
        field: "EMI Tenure",
      },
      EMIInterestRate: {
        type: Sequelize.FLOAT,
        field: "EMI Interest Rate",
      },
      EMIAmt: {
        type: Sequelize.FLOAT,
        field: "EMI Amt",
      },
      TotalAmtWithIntr: {
        type: Sequelize.FLOAT,
        field: "Total Amt (With Intr)",
      },
      CashbackPercent: {
        type: Sequelize.FLOAT,
        field: "Cashback%",
      },
      CashbackAmt: {
        type: Sequelize.FLOAT,
        field: "Cashback Amt",
      },
      PaybackPercent: {
        type: Sequelize.FLOAT,
        field: "Payback%",
      },
      PaybackAmt: {
        type: Sequelize.FLOAT,
        field: "Payback Amt",
      },
      InstantEMIDiscountPercent: {
        type: Sequelize.FLOAT,
        field: "Instant EMI discount%",
      },
      InstantEMIDiscount: {
        type: Sequelize.FLOAT,
        field: "Instant EMI discount",
      },
      NetCost: {
        type: Sequelize.FLOAT,
        field: "Net Cost",
      },
      EMIStatus: {
        type: Sequelize.STRING,
        field: "EMI Status",
      },
      Manufacturer: {
        type: Sequelize.STRING,
      },
      ProductName: {
        type: Sequelize.STRING,
        field: "Product Name",
      },
      SkuCode: {
        type: Sequelize.STRING,
        field: "Sku code",
      },
      ProductSerial: {
        type: Sequelize.STRING,
        field: "Product Serial",
      },
      SchemeName: {
        type: Sequelize.STRING,
        field: "Scheme Name",
      },
      ReceiptURL: {
        type: Sequelize.STRING,
        field: "Receipt URL",
      },
      FileName: {
        type: Sequelize.STRING,
        field: "File Name",
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("Transactions");
  },
};