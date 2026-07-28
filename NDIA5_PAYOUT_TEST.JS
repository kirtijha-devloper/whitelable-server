import crypto from 'crypto';

// =========================================================================
// 1. CONFIGURATION: UPDATE THESE WITH YOUR ACTUAL DETAILS
// =========================================================================
const BASE_URL = 'https://api.uat.ndia5.com'; // Change to actual NDIA5 Base URL
const USERNAME = 'ND0144';         // Change to your merchant username
const PASSWORD = 'C5gBq@IcEO';         // Change to your merchant password
const SALT = 'BE6EEBC412838688D9B8394D53D29043'; // Your secret key

// Test Transaction details
const AMOUNT = '10';
const SERVICE = 'IMPS'; // Can be IMPS, NEFT, or RTGS
const BANK_ACCOUNT = '123456789012';
const IFSC = 'SBIN0001234';
const PAYEE_NAME = 'John Doe';
const CUSTOMER_MOBILE = '9876543210';
const WEBHOOK_URL = 'https://yourdomain.com/webhook';

// Global token variable to share between APIs during execution
let BEARER_TOKEN = '';
let LAST_MERCHANT_REF = '';

// =========================================================================
// API 1: AUTHENTICATION (LOGIN)
// =========================================================================
async function runLogin() {
    console.log('\n--- 1. RUNNING LOGIN API ---');
    console.log(`Endpoint: POST ${BASE_URL}/auth/merchant/login`);

    const payload = {
        username: USERNAME,
        password: PASSWORD
    };

    try {
        const response = await fetch(`${BASE_URL}/auth/merchant/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Response Status:', response.status);
        console.log('Response Body:', JSON.stringify(data, null, 2));

        if (data.data && data.data.token) {
            BEARER_TOKEN = data.data.token;
            console.log('✓ Token successfully retrieved!');
            return true;
        } else {
            console.log('✗ Failed to retrieve token. Check username/password.');
            return false;
        }
    } catch (error) {
        console.error('✗ Login Request Error:', error.message);
        return false;
    }
}

// =========================================================================
// API 2: INITIATE PAYOUT
// =========================================================================
async function runInitiatePayout() {
    console.log('\n--- 2. RUNNING INITIATE PAYOUT API ---');
    console.log(`Endpoint: POST ${BASE_URL}/transaction/initiate`);

    if (!BEARER_TOKEN) {
        console.log('✗ Missing Bearer Token. Run login first!');
        return false;
    }

    // Generate the current timestamp in the required format (IST +05:30)
    const now = new Date();
    // For testing, since server is likely in India, we use local time or explicit offset. 
    // To be precise about +05:30:
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const year = istTime.getUTCFullYear();
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istTime.getUTCDate()).padStart(2, '0');
    const hours = String(istTime.getUTCHours()).padStart(2, '0');
    const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');
    const timestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;

    // Generate unique merchant reference ID (only numbers as per their script)
    const uniqueId = Date.now().toString() + Math.random().toString().substring(2, 8);
    const merchantReferenceId = uniqueId;
    LAST_MERCHANT_REF = merchantReferenceId;

    // Format amount for signature: they strictly add '.0'
    const sigAmount = `${AMOUNT}.0`;

    const rawString = `${sigAmount}|PAYOUT|${merchantReferenceId}|${BANK_ACCOUNT}`;

    console.log(`-> Timestamp: "${timestamp}"`);
    console.log(`-> Raw Signature Data String: "${rawString}"`);

    // Calculate HMAC-SHA256 and convert to BASE64 (NOT HEX!)
    const signature = crypto
        .createHmac('sha256', SALT)
        .update(rawString)
        .digest('base64');

    const payload = {
        merchant_reference_id: merchantReferenceId,
        amount: Number(AMOUNT),
        currency: "INR",
        service: "PAYOUT",
        service_details: {
            payout: {
                channel: SERVICE,
                payee_details: {
                    payee_name: PAYEE_NAME,
                    payee_bank_account_no: BANK_ACCOUNT,
                    payee_bank_ifsc: IFSC
                }
            }
        },
        customer_details: {
            customer_name: "Customer Name",
            customer_mobile: CUSTOMER_MOBILE
        },
        geo_location: {
            latitude: "12.9716",
            longitude: "77.5946"
        },
        webhook_url: WEBHOOK_URL
    };

    try {
        const response = await fetch(`${BASE_URL}/transaction/initiate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BEARER_TOKEN}`,
                'timestamp': timestamp,
                'signature': signature,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Response Status:', response.status);
        console.log('Response Body:', JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('✗ Payout Request Error:', error.message);
        return false;
    }
}

// =========================================================================
// API 3: STATUS CHECK
// =========================================================================
async function runStatusCheck(refId) {
    const targetRef = refId || LAST_MERCHANT_REF;
    console.log('\n--- 3. RUNNING STATUS CHECK API ---');
    console.log(`Endpoint: GET ${BASE_URL}/transaction/check/payoutStatus/${targetRef}`);

    if (!BEARER_TOKEN) {
        console.log('✗ Missing Bearer Token. Run login first!');
        return false;
    }

    if (!targetRef) {
        console.log('✗ No merchant reference ID specified or found from previous step.');
        return false;
    }

    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const year = istTime.getUTCFullYear();
    const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istTime.getUTCDate()).padStart(2, '0');
    const hours = String(istTime.getUTCHours()).padStart(2, '0');
    const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');
    const timestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`;

    try {
        const response = await fetch(`${BASE_URL}/transaction/check/payoutStatus/${targetRef}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${BEARER_TOKEN}`,
                'timestamp': timestamp,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        const data = await response.json();
        console.log('Response Status:', response.status);
        console.log('Response Body:', JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('✗ Status Check Request Error:', error.message);
        return false;
    }
}

// =========================================================================
// API 4: BALANCE CHECK
// =========================================================================
async function runBalanceCheck() {
    console.log('\n--- 4. RUNNING BALANCE CHECK API ---');
    console.log(`Endpoint: POST ${BASE_URL}/transaction/getBalance`);

    if (!BEARER_TOKEN) {
        console.log('✗ Missing Bearer Token. Run login first!');
        return false;
    }

    const timestamp = new Date().toISOString();
    const payload = {
        accountNumber: BANK_ACCOUNT,
        ifsc: IFSC
    };

    try {
        const response = await fetch(`${BASE_URL}/transaction/getBalance`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BEARER_TOKEN}`,
                'timestamp': timestamp,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('Response Status:', response.status);
        console.log('Response Body:', JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('✗ Balance Check Request Error:', error.message);
        return false;
    }
}

// =========================================================================
// MAIN RUNNER
// =========================================================================
async function main() {
    console.log('==================================================');
    console.log('          NDIA5 API INTEGRATION TESTER            ');
    console.log('==================================================');

    // Step 1: Login
    const loginSuccess = await runLogin();
    if (!loginSuccess) {
        console.log('\nStopping flow: Login failed.');
        return;
    }

    // Step 2: Check Balance
    await runBalanceCheck();

    // Step 3: Initiate Payout
    const payoutSuccess = await runInitiatePayout();

    // Step 4: Status Check
    if (payoutSuccess && LAST_MERCHANT_REF) {
        // Wait a few seconds to let the system register the transaction before status check
        console.log('\nWaiting 3 seconds before checking status...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        await runStatusCheck(LAST_MERCHANT_REF);
    }

    console.log('\n==================================================');
    console.log('                  TEST RUN COMPLETE               ');
    console.log('==================================================');
}

// Execute the main script flow
main();