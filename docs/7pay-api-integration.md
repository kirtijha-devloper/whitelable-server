# 7Pay API Integration Guide

This document outlines the details required to integrate the 7Pay API into any other service or application, based on the current implementation in the POS-SERVER.

## 1. Authentication & Security Flow (Important)

7Pay uses a highly secure, payload-level encryption mechanism. Standard HTTPS/TLS is used, but the request body and response body are additionally encrypted using AES-256-CBC, and the AES keys are securely transmitted using an RSA Public Key.

### 1.1 Encryption Mechanism

For **every single request** (Login, Payout, Status), you must perform the following:
1. Generate a random 32-byte (256-bit) AES key.
2. Generate a random 16-byte IV.
3. Encrypt the JSON payload string using AES-256-CBC with the generated key and IV. The result must be base64 encoded. This forms the **request body**.
4. Encrypt the 32-byte AES key using the provided 7Pay RSA Public Key (with `RSA_PKCS1_PADDING`). Base64 encode the result.
5. Encrypt the 16-byte IV using the 7Pay RSA Public Key (with `RSA_PKCS1_PADDING`). Base64 encode the result.
6. Send the encrypted AES Key and IV in the request headers (`key` and `iv` respectively).
7. The response body will be an AES encrypted string. Use the **same AES key and IV** you generated for the request to decrypt the response.

*Note: For GET requests (like payout status), query parameters might be sent in plaintext or might require similar encryption depending on the exact endpoint specification, but the base logic remains the same for POST.*

## 2. API Endpoints

**Base URL**: `https://txnapi.sevenpay.in` (For production, check the environment variables).

### 2.1 Login (Get Token)
- **Path**: `/api/Account/GetToken/Login`
- **Method**: `POST`
- **Headers**:
  - `Content-Type`: `application/json`
  - `key`: Base64(RSA_Encrypt(AES_Key))
  - `iv`: Base64(RSA_Encrypt(AES_IV))
  - `x-request-channel`: `Web`
- **Unencrypted Payload**:
  ```json
  {
    "userName": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD",
    "channelType": "API"
  }
  ```
- **Response**: The decrypted response will contain the Bearer `token`, `expiresIn`, `userId`, and `orgId`.

### 2.2 Initiate Payout
- **Path**: `/api/Payout/initiatePayout`
- **Method**: `POST`
- **Headers**:
  - `Content-Type`: `application/json`
  - `Authorization`: `Bearer <Token>` (Obtained from Login)
  - `key`: Base64(RSA_Encrypt(AES_Key))
  - `iv`: Base64(RSA_Encrypt(AES_IV))
- **Unencrypted Payload**:
  ```json
  {
    "orgId": "...",
    "userId": "...",
    "paymentMode": "IMPS", // NEFT, RTGS
    "amount": "100.00",
    "refParam1": "",
    "refParam2": "",
    "refParam3": ""
    // Add other beneficiary details like account number, IFSC, name, etc.
  }
  ```

### 2.3 Get Payout Status
- **Path**: `/api/PayOut/getPayoutStatus`
- **Method**: `GET`
- **Headers**: Same as Payout Initiate.
- **Query Parameters**:
  - `crnId` (or `CRN`)
  - `paymentId`
  - `userid`

### 2.4 Get Wallet Balance (Self Balance Check)
- **Path**: `/api/User/GetWalletBalanceAsync`
- **Method**: `GET`
- **Headers**:
  - `Content-Type`: `application/json`
  - `Authorization`: `Bearer <Token>` (Obtained from Login)
  - `key`: Base64(RSA_Encrypt(AES_Key))
  - `iv`: Base64(RSA_Encrypt(AES_IV))
- **Query Parameters / Request**:
  - `orgId` (e.g. `47716`)
- **Sample Success Response (Decrypted)**:
  ```json
  {
    "responseCode": "0",
    "response": "Success",
    "data": {
      "walletBalance": "25000.50"
    },
    "errors": null
  }
  ```

## 3. Response Statuses and Error Handling

### 3.1 Payout Status Normalization
The 7Pay API returns various status strings. The system normalizes them into three primary states: `SUCCESS`, `FAILED`, and `PENDING`.

- **SUCCESS**: 
  - `SUCCESS`, `SUCCESSFUL`, `COMPLETED`, `PROCESSED`, `APPROVED`, `CREDITED`
- **FAILED**: 
  - `FAILED`, `FAILURE`, `REJECTED`, `DECLINED`, `CANCELLED`, `ERROR`
- **PENDING**: 
  - `PENDING`, `PROCESSING`, `INPROCESS`, `IN_PROGRESS`, `INITIATED`, `SUBMITTED`
- *Default*: If the status is unrecognized or empty, it defaults to `PENDING`.

### 3.2 Response Mapping
When decrypting the response, the following fields are typically returned and should be mapped:
- `crn`, `CRN`, `referenceId`, `clientRefNo` -> **Client Reference Number (CRN)**
- `paymentId`, `txnId`, `transactionId`, `utrId` -> **Payment ID**
- `amount`, `txnAmount` -> **Transaction Amount**
- `serviceCharge`, `charge` -> **Service Charges**
- `bankReferenceNo`, `utr`, `rrn` -> **Bank UTR / RRN**

### 3.3 Error Responses
- **Login Errors**: If `responseCode` is not `'0'`, the login has failed. Look for `response`, `responseDesc`, or `errors[0].error` for the failure message.
- **HTTP Errors**: Standard HTTP 4xx or 5xx errors may occur. 
  - The `error.response.data` might be encrypted. You should attempt to decrypt it using the same AES key/IV generated for that specific request to read the error details.
  - Common reasons for HTTP errors include invalid tokens (401), invalid padding in encryption (bad RSA/AES setup), or server timeouts.

## 4. Example Utilities Reference
For actual code implementation of the encryption/decryption routines, refer to the following files in the `POS-SERVER` repository:
- `utils/sevenpayEncryption.js`
- `sevenpay-team-script.js` (for a raw standalone example)
- `services/sevenpayPayout.service.js` (for full service implementation)
