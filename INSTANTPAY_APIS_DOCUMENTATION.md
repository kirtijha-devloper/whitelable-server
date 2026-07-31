# InstantPay API Integration Guide
> **Credit Card Bill Payment (BBPS)** & **Account Verification (Penny Drop / UPI)** APIs

---

## 1. Credentials & Header Authentication

InstantPay requires HTTP Header-based authentication. Payload encryption (AES/RSA) is **not required**.

### Headers
```http
Accept: application/json
Content-Type: application/json
X-Ipay-Auth-Code: <IPAY_AUTH_CODE>
X-Ipay-Client-Id: <IPAY_CLIENT_ID>
X-Ipay-Client-Secret: <IPAY_CLIENT_SECRET>
X-Ipay-Endpoint-Ip: <IPAY_ENDPOINT_IP>
X-Ipay-Outlet-Id: <IPAY_OUTLET_ID>
```

### Environment Variables
| Variable Key | Description | Example |
| :--- | :--- | :--- |
| `IPAY_AUTH_CODE` | Authentication code provided by InstantPay | `AUTH123456` |
| `IPAY_CLIENT_ID` | Client ID provided by InstantPay | `CLIENT_ID_XYZ` |
| `IPAY_CLIENT_SECRET` | Client secret provided by InstantPay | `SECRET_XYZ` |
| `IPAY_ENDPOINT_IP` | Whitelisted IPv4 address of your server | `103.xxx.xxx.xxx` *(Must be IPv4 string)* |
| `IPAY_OUTLET_ID` | Numeric Outlet / Merchant ID | `12345` *(Must be Integer)* |

> ⚠️ **Important Notes**:
> - `X-Ipay-Endpoint-Ip` **must be a valid IPv4 string**. InstantPay rejects IPv6 formats (`::1` or `::ffff:127.0.0.1`).
> - `X-Ipay-Outlet-Id` must be sent as an integer/numeric string, not empty.

---

## 2. Account Verification API (Penny Drop & UPI ID)

**Base URL**: `https://api.instantpay.in/identity`

### 2.1 Verify Bank Account (Penny Drop) / UPI
- **Endpoint**: `POST /identity/verifyBankAccount`
- **Full URL**: `https://api.instantpay.in/identity/verifyBankAccount`

#### Request Body: Bank Account (Penny Drop)
```json
{
  "payee": {
    "accountNumber": "123456789012",
    "bankIfsc": "HDFC0001234",
    "name": "Customer Name"
  },
  "externalRef": "BAV1721734200000123",
  "consent": "Y",
  "pennyDrop": "YES",
  "latitude": "28.6139",
  "longitude": "77.2090"
}
```

#### Request Body: UPI ID Verification
```json
{
  "payee": {
    "accountNumber": "9876543210@paytm",
    "bankIfsc": " "
  },
  "externalRef": "BAV1721734200000123",
  "consent": "Y",
  "isCached": "0",
  "latitude": "28.6139",
  "longitude": "77.2090"
}
```

#### Field Description:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `payee.accountNumber` | String | Yes | Bank Account Number OR UPI VPA ID |
| `payee.bankIfsc` | String | Yes | Valid 11-character IFSC code for Bank account. For UPI, send single space `" "` |
| `payee.name` | String | Conditional | Name of account holder (Required for Bank Penny Drop) |
| `externalRef` | String | Yes | Unique transaction reference string |
| `consent` | String | Yes | User consent flag, set to `"Y"` |
| `pennyDrop` | String | Conditional | Set to `"YES"` for Bank Penny Drop |
| `isCached` | String | Conditional | Set to `"0"` for fresh UPI verification |
| `latitude` | String | Yes | Location latitude (e.g., `"28.6139"`) |
| `longitude` | String | Yes | Location longitude (e.g., `"77.2090"`) |

#### Successful Response:
```json
{
  "statuscode": "TXN",
  "status": "Transaction Successful",
  "data": {
    "payee": {
      "name": "JOHN DOE"
    },
    "bankReferenceNo": "420319123456"
  }
}
```
*Success Condition*: `statuscode` is `"TXN"`, `"IPI"`, `"200"`, or `status` is `"Transaction Successful"`.

#### Failure Response:
```json
{
  "statuscode": "ERR",
  "status": "Invalid Account Number or IFSC Code",
  "data": null
}
```

---

### 2.2 Fetch Supported Banks List
- **Endpoint**: `GET /identity/verifyBankAccount/banks`
- **Full URL**: `https://api.instantpay.in/identity/verifyBankAccount/banks`
- **Headers**: Standard InstantPay Headers

---

## 3. Direct Credit Card Bill Payment API (BBPS Utility)

**Base URL**: `https://api.instantpay.in/marketplace/utilityPayments`

---

### 3.1 Fetch Credit Card Billers List
- **Endpoint**: `POST /marketplace/utilityPayments/billers`
- **Full URL**: `https://api.instantpay.in/marketplace/utilityPayments/billers`

#### Request Body:
```json
{
  "pagination": {
    "pageNumber": 1,
    "recordsPerPage": 100
  },
  "filters": {
    "categoryKey": "C15",
    "updatedAfterDate": ""
  }
}
```
> *Note*: Category key `C15` is specifically used for Credit Card Billers in InstantPay.

#### Response Example:
```json
{
  "statuscode": "TXN",
  "status": "Transaction Successful",
  "data": {
    "records": [
      {
        "billerId": "HDFC00000NAT01",
        "billerName": "HDFC Credit Card"
      },
      {
        "billerId": "ICIC00000NAT01",
        "billerName": "ICICI Credit Card"
      }
    ]
  }
}
```

---

### 3.2 Fetch Biller Details & Input Requirements
- **Endpoint**: `POST /marketplace/utilityPayments/billerDetails`
- **Full URL**: `https://api.instantpay.in/marketplace/utilityPayments/billerDetails`

#### Request Body:
```json
{
  "billerId": "HDFC00000NAT01"
}
```

---

### 3.3 Pre-Payment Enquiry (Bill Fetch / Validation)
Used when a biller requires bill validation (`supportValidation: "MANDATORY"` or `fetchRequirement: "MANDATORY"`).

- **Endpoint**: `POST /marketplace/utilityPayments/prePaymentEnquiry`
- **Full URL**: `https://api.instantpay.in/marketplace/utilityPayments/prePaymentEnquiry`

#### Request Body:
```json
{
  "billerId": "HDFC00000NAT01",
  "initChannel": "AGT",
  "externalRef": "APBBPS20261721734200000",
  "inputParameters": {
    "param1": "4532XXXXXXXX1234",
    "param2": "9876543210"
  },
  "deviceInfo": {
    "mac": "00:00:00:00:00:00",
    "ip": "103.xxx.xxx.xxx"
  },
  "remarks": {
    "param1": "9876543210"
  },
  "transactionAmount": 1500.00
}
```

#### Field Description:
- `billerId`: Selected Biller Code
- `initChannel`: `"AGT"` (Agent Channel)
- `externalRef`: Unique Reference ID (Format: `APBBPS{YYYY}{TimestampMs}`)
- `inputParameters.param1`: Card / Account Number
- `inputParameters.param2`: Secondary Parameter (e.g. Registered Mobile Number, if required)
- `deviceInfo.ip`: Valid IPv4 address of customer/server
- `transactionAmount`: Amount to pay in ₹

#### Successful Response Example:
```json
{
  "statuscode": "TXN",
  "status": "Transaction Successful",
  "data": {
    "enquiryReferenceId": "ENQ1234567890123",
    "billDetails": {
      "customerName": "JOHN DOE",
      "billAmount": 1500.00,
      "dueDate": "2026-08-15"
    }
  }
}
```
> 💡 Save `enquiryReferenceId` to pass into the final `/payment` API call.

---

### 3.4 Execute Credit Card Bill Payment
- **Endpoint**: `POST /marketplace/utilityPayments/payment`
- **Full URL**: `https://api.instantpay.in/marketplace/utilityPayments/payment`

#### Request Body:
```json
{
  "billerId": "HDFC00000NAT01",
  "externalRef": "APBBPS20261721734200000",
  "telecomCircle": "",
  "enquiryReferenceId": "ENQ1234567890123",
  "inputParameters": {
    "param1": "4532XXXXXXXX1234",
    "param2": "9876543210"
  },
  "initChannel": "AGT",
  "deviceInfo": {
    "terminalId": "9876543210",
    "mobile": "9876543210",
    "postalCode": "110044",
    "geoCode": "28.6139,77.2090"
  },
  "paymentMode": "Cash",
  "paymentInfo": {
    "Remarks": "CC Bill Payment"
  },
  "remarks": {
    "param1": "9876543210"
  },
  "transactionAmount": 1500.00,
  "customerPan": "ABCDE1234F"
}
```

#### Field Description:
- `billerId`: Selected biller code
- `externalRef`: Unique reference ID
- `enquiryReferenceId`: `enquiryReferenceId` returned from `prePaymentEnquiry` (if applicable; otherwise `""`)
- `initChannel`: `"AGT"`
- `deviceInfo.terminalId` & `mobile`: Customer 10-digit mobile number
- `deviceInfo.geoCode`: `"latitude,longitude"` formatted to 4 decimal places (e.g. `"28.6139,77.2090"`)
- `paymentMode`: `"Cash"`, `"UPI"`, etc. (Default `"Cash"`)
- `transactionAmount`: Amount to pay in ₹
- `customerPan`: Customer PAN card number (optional/biller-dependent)

#### Success Response:
```json
{
  "statuscode": "TXN",
  "status": "Transaction Successful",
  "data": {
    "operatorRef": "987654321098",
    "externalRef": "APBBPS20261721734200000",
    "transactionValue": 1500.00
  }
}
```

> ⚠️ **CRITICAL SUCCESS RULE**:
> InstantPay considers a payment **SUCCESSFUL ONLY** when `statuscode` is `"TXN"` or `"TUP"`.

---

### 3.5 Transaction Status Check Query
Used to check status of pending CC bill payment transactions.

- **Endpoint**: `POST /reports/txnStatus`
- **Full URL**: `https://api.instantpay.in/reports/txnStatus`

#### Request Body:
```json
{
  "transactionDate": "2026-07-23",
  "externalRef": "APBBPS20261721734200000"
}
```

#### Response Example:
```json
{
  "statuscode": "TXN",
  "status": "Transaction Successful",
  "data": {
    "transactionStatusCode": "TXN",
    "operatorRef": "987654321098"
  }
}
```

---

## 4. Code Implementation Examples (Node.js / Axios)

### 4.1 Header Builder & Helper Functions
```javascript
const axios = require('axios');

function buildInstantPayHeaders(outletId) {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Ipay-Auth-Code': process.env.IPAY_AUTH_CODE,
    'X-Ipay-Client-Id': process.env.IPAY_CLIENT_ID,
    'X-Ipay-Client-Secret': process.env.IPAY_CLIENT_SECRET,
    'X-Ipay-Endpoint-Ip': process.env.IPAY_ENDPOINT_IP, // e.g. "103.xxx.xxx.xxx"
    'X-Ipay-Outlet-Id': parseInt(outletId || process.env.IPAY_OUTLET_ID, 10)
  };
}

function generateExternalRef() {
  return `APBBPS${new Date().getFullYear()}${Date.now()}`;
}
```

### 4.2 Account Verification Snippet
```javascript
async function verifyAccount({ accountNumber, bankIfsc, name, merchantId }) {
  const isUpi = !bankIfsc || bankIfsc.trim() === '';
  
  const payload = {
    payee: {
      accountNumber: accountNumber,
      bankIfsc: isUpi ? " " : bankIfsc
    },
    externalRef: `BAV${Date.now()}${merchantId || ''}`,
    consent: "Y",
    latitude: "28.6139",
    longitude: "77.2090"
  };

  if (isUpi) {
    payload.isCached = "0";
  } else {
    payload.payee.name = name || 'Customer';
    payload.pennyDrop = "YES";
  }

  const response = await axios.post('https://api.instantpay.in/identity/verifyBankAccount', payload, {
    headers: buildInstantPayHeaders(),
    timeout: 30000
  });

  const statuscode = response.data?.statuscode;
  const isSuccess = statuscode === 'TXN' || statuscode === 'IPI' || statuscode === '200' || response.data?.status === 'Transaction Successful';

  return {
    isSuccess,
    name: response.data?.data?.payee?.name || name,
    utr: response.data?.data?.bankReferenceNo,
    rawResponse: response.data
  };
}
```

### 4.3 CC Bill Payment Snippet
```javascript
async function executeCCBillPayment({ billerId, cardOrAccNumber, mobile, amount, enquiryReferenceId, outletId }) {
  const externalRef = generateExternalRef();

  const payload = {
    billerId,
    externalRef,
    telecomCircle: '',
    enquiryReferenceId: enquiryReferenceId || '',
    inputParameters: { param1: cardOrAccNumber, param2: mobile },
    initChannel: 'AGT',
    deviceInfo: {
      terminalId: mobile,
      mobile: mobile,
      postalCode: '110044',
      geoCode: '28.6139,77.2090'
    },
    paymentMode: 'Cash',
    paymentInfo: { Remarks: 'CC Bill Payment' },
    remarks: { param1: mobile },
    transactionAmount: parseFloat(amount)
  };

  const response = await axios.post('https://api.instantpay.in/marketplace/utilityPayments/payment', payload, {
    headers: buildInstantPayHeaders(outletId),
    timeout: 60000
  });

  const isSuccess = ['TXN', 'TUP'].includes(response.data?.statuscode);

  return {
    isSuccess,
    externalRef,
    operatorRef: response.data?.data?.operatorRef,
    rawResponse: response.data
  };
}
```
