/**
 * Mimic a Razorpay POS webhook notification for local testing.
 *
 * Usage:
 *   node scripts/testWebhook.js                      # sends UPI payload (default)
 *   node scripts/testWebhook.js card                 # sends CARD payload
 *   node scripts/testWebhook.js upi  <txnId>         # custom txnId, UPI
 *   node scripts/testWebhook.js card <txnId>         # custom txnId, CARD
 *
 * Credentials are read from the same .env as the server.
 * Override them: WEBHOOK_USERNAME=x WEBHOOK_PASSWORD=y node scripts/testWebhook.js
 */

require('dotenv').config();
const axios = require('axios');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL   = `http://localhost:${process.env.PORT || 5000}`;
const ENDPOINT   = `${BASE_URL}/api/razorpay/webhook`;
const USERNAME   = process.env.WEBHOOK_USERNAME || 'razorpay';
const PASSWORD   = process.env.WEBHOOK_PASSWORD || 'secret';
const AUTH       = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

// ── Sample payloads ───────────────────────────────────────────────────────────
function upiPayload(txnId) {
  return {
    amount: 100,
    amountAdditional: 0,
    amountCashBack: 0,
    amountOriginal: 100,
    authCode: 'NA',
    batchNumber: '',
    currencyCode: 'INR',
    customerName: 'Test Payer',
    customerReceiptUrl: 'http://d.eze.cc/r/o/SdTaYROw/',
    deviceSerial: 'TESTINGSERIALNO',
    externalRefNumber: 'EZ202512081133036345',
    externalRefNumber4: '',
    externalRefNumber5: '',
    externalRefNumber6: '',
    externalRefNumber7: '',
    formattedPan: '',
    invoiceNumber: '',
    mid: 'TESTDUMMY01',
    payerName: 'Test Payer',
    paymentCardBrand: '',
    paymentCardType: 'UNKNOWN',
    paymentMode: 'UPI',
    pgInvoiceNumber: '',
    postingDate: new Date().toISOString(),
    rrNumber: '29594000',
    settlementStatus: 'SETTLED',
    stan: '',
    status: 'AUTHORIZED',
    tid: 'TESTDUMMY01',
    txnId: txnId,
    Id: txnId,
    txnType: 'CHARGE',
    userAgreement: '',
    username: '3336661756',
    orderId: '',
  };
}

function cardPayload(txnId) {
  return {
    amount: 15,
    amountAdditional: 0,
    amountCashBack: 0,
    amountOriginal: 15,
    authCode: '663882',
    batchNumber: '31',
    currencyCode: 'INR',
    customerName: 'CHANDAN KUMAR',
    customerReceiptUrl: 'http://eze.cc/RZPPOS/t/a/mJR8uftf/',
    deviceSerial: '1494933608',
    externalRefNumber: 'EZ202512171850215042',
    externalRefNumber4: '',
    externalRefNumber5: '',
    externalRefNumber6: '',
    externalRefNumber7: '',
    formattedPan: '6528-68XX-XXXX-8002',
    invoiceNumber: '',
    mid: 'TESTDUMMY01',         // must match an active POS machine in your DB
    payerName: 'CHANDAN KUMAR',
    paymentCardBrand: 'RUPAY',
    paymentCardType: 'CREDIT',
    paymentMode: 'CARD',
    pgInvoiceNumber: '54',
    postingDate: new Date().toISOString(),
    rrNumber: '535118755100',
    settlementStatus: 'PENDING',
    stan: '85',
    status: 'AUTHORIZED',
    tid: 'TESTDUMMY01',         // must match an active POS machine in your DB
    txnId: txnId,
    Id: txnId,
    txnType: 'CHARGE',
    userAgreement: 'I agree to pay as per the card issuer agreement.',
    username: '1037978870',
    orderId: '',
  };
}

// ── Generate a unique txnId if not supplied on CLI ────────────────────────────
function generateTxnId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14); // YYYYMMDDHHmmss
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
  return `TEST${ts}${rand}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const [, , typeArg = 'upi', txnIdArg] = process.argv;
  const type  = typeArg.toLowerCase();
  const txnId = txnIdArg || generateTxnId();

  const payload = type === 'card' ? cardPayload(txnId) : upiPayload(txnId);

  console.log('─'.repeat(60));
  console.log(`Endpoint : POST ${ENDPOINT}`);
  console.log(`Auth     : Basic ${USERNAME}:${'*'.repeat(PASSWORD.length)}`);
  console.log(`Type     : ${type.toUpperCase()}`);
  console.log(`txnId    : ${txnId}`);
  console.log(`Payload  :`, JSON.stringify(payload, null, 2));
  console.log('─'.repeat(60));

  try {
    const response = await axios.post(ENDPOINT, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${AUTH}`,
      },
      // Razorpay expects XML back; don't throw on non-2xx
      validateStatus: () => true,
    });

    console.log(`\nHTTP ${response.status}`);
    console.log('Response headers:', response.headers['content-type']);
    console.log('Response body   :', response.data);

    if (response.status === 200) {
      console.log('\n✅ Webhook accepted. Background processing queued.');
      console.log('   Check server logs / Bull dashboard for worker output.');
    } else {
      console.error('\n❌ Webhook rejected. Check credentials / server logs.');
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error(`\n❌ Could not connect to ${BASE_URL}. Is the server running?`);
    } else {
      console.error('\n❌ Request failed:', err.message);
    }
  }
}

main();
