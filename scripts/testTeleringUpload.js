const { mapRowToNotificationEvent } = require('../controllers/transactionController');

const sampleCsvData = [
  {
    "TRANSACTION DATE TIME": "2026-08-06 16:26:19",
    "MID": "037136000110356",
    "TID": "11965839",
    "RRN": "621810037848",
    "TRANSACTION AMOUNT": "40134.21",
    "SCHEME": "MASTER",
    "TRANSACTION TYPE": "SALE",
    "DCC TXN": "NO",
    "TRANSACTION STATUS": "SUCCESS",
    "RESPONSE CODE": "00",
    "RESPONSE MESSAGE": "Approved",
    "CARD TYPE": "CREDIT",
    "CARD NUMBER": "549947******9008",
    "MERCHANT DBA NAME": "TELERING PVT LTD",
    "MCC": "4215",
    "ISO NAME": ""
  },
  {
    "TRANSACTION DATE TIME": "2026-08-06 15:53:49",
    "MID": "037136000110202",
    "TID": "11965971",
    "RRN": "000714429451",
    "TRANSACTION AMOUNT": "99965.00",
    "SCHEME": "",
    "TRANSACTION TYPE": "SETTLEMENT",
    "DCC TXN": "NO",
    "TRANSACTION STATUS": "SUCCESS",
    "RESPONSE CODE": "00",
    "RESPONSE MESSAGE": "Approved",
    "CARD TYPE": "",
    "CARD NUMBER": "",
    "MERCHANT DBA NAME": "TELERING PVT LTD",
    "MCC": "4215",
    "ISO NAME": ""
  },
  {
    "TRANSACTION DATE TIME": "2026-08-06 15:18:07",
    "MID": "037136000110350",
    "TID": "11965842",
    "RRN": "621809581713",
    "TRANSACTION AMOUNT": "75298.00",
    "SCHEME": "VISA",
    "TRANSACTION TYPE": "SALE",
    "DCC TXN": "NO",
    "TRANSACTION STATUS": "DECLINED",
    "RESPONSE CODE": "51",
    "RESPONSE MESSAGE": "Insufficient Fund",
    "CARD TYPE": "CREDIT",
    "CARD NUMBER": "427124******3241",
    "MERCHANT DBA NAME": "TELERING PVT LTD",
    "MCC": "4215",
    "ISO NAME": ""
  }
];

console.log("--- Testing Telering Data Mapping ---");
sampleCsvData.forEach((row, idx) => {
  const result = mapRowToNotificationEvent(row, 'telering', idx);
  console.log(`\nRow ${idx + 1}:`);
  console.log("Is Settlement:", result.isSettlement);
  console.log("Event:", JSON.stringify(result.event, null, 2));
  console.log("Preview:", JSON.stringify(result.previewRow, null, 2));
});
