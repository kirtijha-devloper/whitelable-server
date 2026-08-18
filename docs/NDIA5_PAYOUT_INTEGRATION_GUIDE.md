# NDIA5 Payout Gateway Integration Guide

This document provides a comprehensive integration guide for the **NDIA5 Payout Gateway**. It contains detailed specifications for headers, request/response bodies, signature generation, and endpoint behaviors to help you integrate NDIA5 payout services into any application.

---

## 📌 1. Configuration & Environments

### Base URLs
* **UAT / Sandbox Environment**: `https://api.uat.ndia5.com`
* **Production / Live Environment**: `https://api.ndia5.com` *(Verify actual production URL with NDIA5 support)*

### Required Credentials
To interact with the APIs, you will need the following details provided by NDIA5:
* **Username (`username`)**: e.g., `ND0144`
* **Password (`password`)**: Your merchant login password.
* **Salt Key (`salt`)**: Used for generating HMAC-SHA256 signatures for transaction initiation.

---

## 🔐 2. Authentication & Headers

### Authentication Flow
1. Call the **Login API** using your `username` and `password`.
2. The Login API returns a temporary JSON Web Token (JWT) in the response.
3. Cache this JWT token and send it in the `Authorization` header as a Bearer token for all subsequent API requests.
4. The JWT token is typically valid for 24 hours. It is recommended to implement a cache-refresh mechanism (e.g., re-authenticating after 23 hours).

### Global Header Structure
For all API calls after authentication, the following headers are mandatory:

| Header Name | Type | Value / Description | Example |
| :--- | :--- | :--- | :--- |
| `Authorization` | String | `Bearer <JWT_TOKEN>` | `Bearer eyJhbGciOiJIUzI1NiIsIn...` |
| `timestamp` | String | Current Indian Standard Time (IST) in ISO-8601 format (`YYYY-MM-DDTHH:mm:ss+05:30`) | `2026-08-17T12:54:59+05:30` |
| `Content-Type` | String | `application/json` | `application/json` |
| `Accept` | String | `application/json` | `application/json` |
| `signature` | String | **(Only for Payout Initiation)** Base64 HMAC-SHA256 signature. | `g4tD6P+fJ/q...=` |

> [!IMPORTANT]
> The `timestamp` header **MUST** be in Indian Standard Time (IST, UTC+05:30) and match the exact format: `YYYY-MM-DDTHH:mm:ss+05:30`. Incorrect timestamp formats may result in request rejection.

---

## 🛠️ 3. Signature Generation (Only for Initiate Payout)

To secure payout requests, NDIA5 requires a cryptographic signature passed in the `signature` header of the Initiate Payout request.

### Algorithm Summary
* **Algorithm**: HMAC-SHA256
* **Key**: NDIA5 Salt Key (`salt`)
* **Output Format**: Base64 Encoded (not Hex string)
* **Raw Signature String Formula**:
  ```text
  <AMOUNT>|PAYOUT|<MERCHANT_REFERENCE_ID>|<RECIPIENT_BANK_ACCOUNT>
  ```

### Crucial Amount Formatting Rule
The `<AMOUNT>` parameter in the raw signature string must be strictly formatted:
* If the amount is an integer (e.g. `10`), you **MUST** append `.0` to it (e.g. `10.0`).
* If the amount already contains decimals (e.g. `10.5` or `10.55`), use it as is.
* Failing to format the integer amount with `.0` will result in a signature mismatch error.

### Signature Generation Examples

#### 🟢 Node.js / JavaScript
```javascript
const crypto = require('crypto');

function generateSignature(amount, merchantReferenceId, bankAccount, salt) {
  // Format amount
  const numAmount = Number(amount);
  const sigAmount = Number.isInteger(numAmount) ? `${numAmount}.0` : `${numAmount}`;

  // Construct raw string
  const rawString = `${sigAmount}|PAYOUT|${merchantReferenceId}|${bankAccount}`;

  // Generate HMAC-SHA256 Base64
  return crypto
    .createHmac('sha256', salt)
    .update(rawString)
    .digest('base64');
}
```

#### 🟢 Python
```python
import hmac
import hashlib
import base64

def generate_signature(amount, merchant_ref_id, bank_account, salt):
    # Format amount
    num_amount = float(amount)
    sig_amount = f"{num_amount:.1f}" if num_amount.is_integer() else str(num_amount)
    
    # Construct raw string
    raw_string = f"{sig_amount}|PAYOUT|${merchant_ref_id}|${bank_account}"
    
    # Generate HMAC-SHA256 Base64
    signature = hmac.new(
        salt.encode('utf-8'),
        raw_string.encode('utf-8'),
        hashlib.sha256
    ).digest()
    
    return base64.b64encode(signature).decode('utf-8')
```

#### 🟢 PHP
```php
function generateSignature($amount, $merchantRefId, $bankAccount, $salt) {
    // Format amount
    $numAmount = (float)$amount;
    $sigAmount = (floor($numAmount) == $numAmount) ? number_format($numAmount, 1, '.', '') : (string)$numAmount;

    // Construct raw string
    $rawString = "{$sigAmount}|PAYOUT|{$merchantRefId}|{$bankAccount}";

    // Generate HMAC-SHA256 Base64
    return base64_encode(hash_hmac('sha256', $rawString, $salt, true));
}
```

---

## 🚀 4. API Reference

### 1️⃣ Authentication (Login)
Retrieves the JWT bearer token required for other APIs.

* **HTTP Method**: `POST`
* **Endpoint**: `/auth/merchant/login`
* **Headers**:
  ```http
  Content-Type: application/json
  ```
* **Request Body**:
  ```json
  {
    "username": "YOUR_NDIA5_USERNAME",
    "password": "YOUR_NDIA5_PASSWORD"
  }
  ```
* **Response (Success - 200 OK)**:
  ```json
  {
    "meta": {
      "response_code": "ND_000",
      "message": "SUCCESS"
    },
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    },
    "errors": null
  }
  ```

---

### 2️⃣ Get Wallet Balance
Check your current merchant wallet balance.

* **HTTP Method**: `POST`
* **Endpoint**: `/transaction/getBalance`
* **Headers**:
  ```http
  Authorization: Bearer <JWT_TOKEN>
  timestamp: YYYY-MM-DDTHH:mm:ss+05:30
  Content-Type: application/json
  ```
* **Request Body**:
  ```json
  {
    "accountNumber": "YOUR_SETTLEMENT_ACCOUNT_NUMBER",
    "ifsc": "YOUR_SETTLEMENT_IFSC"
  }
  ```
* **Response (Success - 200 OK)**:
  Depending on UAT/Production configurations, the endpoint returns the balance as a direct decimal number, or inside a structured JSON.
  * *Option A (Direct value response)*:
    ```json
    254500.50
    ```
  * *Option B (Structured response)*:
    ```json
    {
      "meta": {
        "responseCode": "ND_000",
        "message": "SUCCESS"
      },
      "data": {
        "balance": 254500.50
      },
      "errors": null
    }
    ```

---

### 3️⃣ Initiate Payout
Initiates a fund transfer to the beneficiary's bank account via IMPS, NEFT, or RTGS.

* **HTTP Method**: `POST`
* **Endpoint**: `/transaction/initiate`
* **Headers**:
  ```http
  Authorization: Bearer <JWT_TOKEN>
  timestamp: YYYY-MM-DDTHH:mm:ss+05:30
  signature: <GENERATED_BASE64_HMAC_SHA256_SIGNATURE>
  Content-Type: application/json
  ```
* **Request Body**:
  ```json
  {
    "merchant_reference_id": "UNIQUE_TRANSACTION_ID_FROM_YOUR_SYSTEM",
    "amount": 1500,
    "currency": "INR",
    "service": "PAYOUT",
    "service_details": {
      "payout": {
        "channel": "IMPS",
        "payee_details": {
          "payee_name": "Recipient Name",
          "payee_bank_account_no": "9876543210123",
          "payee_bank_ifsc": "HDFC0001234"
        }
      }
    },
    "customer_details": {
      "customer_name": "Customer Name",
      "customer_mobile": "9999999999"
    },
    "geo_location": {
      "latitude": "12.9716",
      "longitude": "77.5946"
    },
    "webhook_url": "https://yourdomain.com/ndia5/webhook-callback"
  }
  ```

#### Request Fields Description:
* `merchant_reference_id`: Unique transaction identifier generated by your system (alphanumeric/numeric).
* `amount`: Payout value as a number.
* `currency`: Must be `"INR"`.
* `service`: Must be `"PAYOUT"`.
* `service_details.payout.channel`: Payout mode (`"IMPS"`, `"NEFT"`, `"RTGS"`).
* `webhook_url`: Fully-qualified callback URL where NDIA5 will send transaction updates (optional).

* **Response (Success/Pending - 200 OK)**:
  ```json
  {
    "meta": {
      "response_code": "ND_000",
      "message": "SUCCESS"
    },
    "data": {
      "transaction_id": "APU219344",
      "merchant_reference_id": "YOUR_REF_ID",
      "status": "PENDING",
      "service_charge": 2.00,
      "created_at": "2026-08-17T12:54:59+05:30",
      "channel_type": "IMPS"
    },
    "errors": null
  }
  ```
* **Response (Failed - 400/500/200)**:
  If the payout immediately fails or is rejected, the status returned in the body will be `FAILED` or `REJECTED`, or an error block will be populated.
  ```json
  {
    "meta": {
      "response_code": "ND_999",
      "message": "Transaction Failed"
    },
    "data": null,
    "errors": [
      {
        "code": "ERR_LIMIT_EXCEEDED",
        "message": "Daily merchant payout limit exceeded."
      }
    ]
  }
  ```

---

### 4️⃣ Check Payout Status
Query the status of an initiated payout using your unique `merchant_reference_id`.

* **HTTP Method**: `GET`
* **Endpoint**: `/transaction/check/payoutStatus/{merchant_reference_id}`
* **Headers**:
  ```http
  Authorization: Bearer <JWT_TOKEN>
  timestamp: YYYY-MM-DDTHH:mm:ss+05:30
  Accept: application/json
  Content-Type: application/json
  ```
* **Request Path Parameter**:
  Replace `{merchant_reference_id}` directly in the URL path.
* **Response (Success - 200 OK)**:
  ```json
  {
    "meta": {
      "responseCode": "ND_000",
      "message": "SUCCESS"
    },
    "data": {
      "transactionId": 219344,
      "merchantReferenceId": "YOUR_REF_ID",
      "status": "SUCCESS",
      "serviceCharge": 2.00
    },
    "errors": null
  }
  ```

> [!NOTE]
> Possible status values returned by the gateway include:
> * **`SUCCESS` / `SUCCESSFUL` / `COMPLETED`**: Funds successfully credited.
> * **`FAILED` / `FAILURE` / `REJECTED` / `DECLINED`**: Transaction failed. Funds should be reversed or refunded to your merchant account.
> * **`PENDING` / `PROCESSING`**: Transaction is currently under process. Check status again using cron/polling.

---

## 🛜 5. Webhook Integration / Callback

If a `webhook_url` was specified during the payout initiation request, NDIA5 will send a `POST` request to that endpoint once the transaction status transitions to a final state (`SUCCESS` or `FAILED`).

### Expected Webhook Payload:
```json
{
  "merchant_reference_id": "YOUR_REF_ID",
  "transaction_id": "APU219344",
  "amount": 1500,
  "status": "SUCCESS",
  "service_charge": 2.00,
  "updated_at": "2026-08-17T12:56:12+05:30",
  "bank_reference_no": "RRN123456789"
}
```

### Best Practices for Webhook Handlers:
1. **Idempotency**: Always verify if the transaction has already been processed in your system to avoid duplicate credits/actions.
2. **Respond Quickly**: Return `HTTP 200 OK` immediately upon receiving the callback, then process any database or ledger updates asynchronously.
3. **Fallback Polling**: Do not rely 100% on webhooks. Implement a background cron job (e.g. running every 3-5 minutes) that calls the **Check Payout Status** API for any transactions that have remained in a `PENDING` state for too long.
