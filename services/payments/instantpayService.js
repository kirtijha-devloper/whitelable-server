const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const ledgerService = require('../ledgerService');

const IPAY_AUTH_CODE = process.env.IPAY_AUTH_CODE;
const IPAY_CLIENT_ID = process.env.IPAY_CLIENT_ID;
const IPAY_CLIENT_SECRET = process.env.IPAY_CLIENT_SECRET;
const IPAY_ENDPOINT_IP = process.env.IPAY_ENDPOINT_IP;

async function verifyBankAccount({
  merchantId,
  name,
  accountNumber,
  bankIfsc,
  latitude = "28.6139",
  longitude = "77.2090",
  externalRef
}) {
  try {
    if (!merchantId) {
      throw new Error('merchantId is required for account verification to deduct charges.');
    }

    const availableBalance = await ledgerService.getAvailableBalance(merchantId);
    if (availableBalance < 3) {
      return {
        status: 'FAILED',
        message: 'Insufficient wallet balance for account verification. Minimum ₹3 required.'
      };
    }
    const url = 'https://api.instantpay.in/identity/verifyBankAccount';
    
    // Provide a random externalRef if not provided
    const ref = externalRef || `APABAV${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Ipay-Auth-Code': IPAY_AUTH_CODE,
      'X-Ipay-Client-Id': IPAY_CLIENT_ID,
      'X-Ipay-Client-Secret': IPAY_CLIENT_SECRET,
      'X-Ipay-Endpoint-Ip': IPAY_ENDPOINT_IP
    };

    const payload = {
      payee: {
        name: name || "Customer Name",
        accountNumber,
        bankIfsc
      },
      externalRef: ref,
      consent: "Y",
      pennyDrop: "YES",
      latitude,
      longitude
    };

    const response = await axios.post(url, payload, { headers });
    
    // Deduct Rs 1 charge
    try {
      await ledgerService.createLedgerEntry({
        userId: merchantId,
        transactionType: 'verification_charge',
        transactionId: ref,
        referenceId: null,
        referenceTable: null,
        description: `Account Verification Charge for A/C ${accountNumber}`,
        debit: 3.00,
        metadata: {
          accountNumber,
          bankIfsc,
          service: 'InstantPay'
        }
      });
    } catch (err) {
      console.error('Failed to deduct Rs 3 verification charge (success flow):', err);
    }

    const result = response.data;
    
    // Convert to standard format
    // InstantPay usually returns statuscode "TXN" for success, or similar.
    // We will return the raw result but ensure status and statuscode are there
    if (result && result.statuscode === 'TXN') {
      return {
        status: 'SUCCESS',
        statuscode: result.statuscode,
        name: result.data?.payee?.name || name,
        message: result.status || 'Verification successful',
        utr: result.data?.utr,
        api_ref: result.data?.externalRef || ref,
        raw: result
      };
    } else {
      return {
        status: 'FAILED',
        statuscode: result?.statuscode || '400',
        message: result?.status || result?.message || 'Verification failed',
        raw: result
      };
    }
  } catch (error) {
    console.error('InstantPay verifyBankAccount error:', error?.response?.data || error.message);
    
    // If the API call failed (e.g. 400 Bad Request) but we reached InstantPay, we still charge.
    // However, if the error happens before axios.post or during ledger check, we don't.
    if (error?.response) {
      try {
        await ledgerService.createLedgerEntry({
          userId: merchantId,
          transactionType: 'verification_charge',
          transactionId: externalRef || `APABAV${Date.now()}`,
          referenceId: null,
          referenceTable: null,
          description: `Account Verification Charge for A/C ${accountNumber} (Failed)`,
          debit: 3.00,
          metadata: { accountNumber, bankIfsc, service: 'InstantPay' }
        });
      } catch (ledgerErr) {
        console.error('Failed to deduct Rs 3 for failed verification:', ledgerErr);
      }
    }

    throw {
      status: 'FAILED',
      message: error?.response?.data?.message || error?.response?.data?.status || error.message || 'InstantPay Verification failed',
      raw: error?.response?.data
    };
  }
}

module.exports = {
  verifyBankAccount
};
