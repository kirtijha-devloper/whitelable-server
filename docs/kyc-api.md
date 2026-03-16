# KYC Verification API

Base URL: `/api/kyc`

All endpoints require a valid JWT access token in the `Authorization` header.

---

## Overview

KYC (Know Your Customer) verification is a three-step flow:

```
Step 0 – GET /api/kyc/info
  └─ Retrieve basic user details (mobile, email, PAN, Aadhaar) and a flag
     indicating if KYC is already done.  Use these values to pre‑fill the
     form on the frontend.

  **Sample response (KYC not completed)**

  ```json
  {
    "success": true,
    "data": {
      "mobile": "9876543210",
      "email": "merchant@example.com",
      "pan": "ABCDE1234F",
      "aadhaar": "123456789012",
      "kycDone": false
    }
  }
  ```

  **Sample response (KYC completed)**

  ```json
  {
    "success": true,
    "data": {
      "mobile": "9876543210",
      "email": "merchant@example.com",
      "pan": "ABCDE1234F",
      "aadhaar": "123456789012",
      "kycDone": true
    }
  }
  ```

Step 1 – POST /api/kyc/initiate
  └─ Submit merchant details (missing fields are filled from the user record) →
     InstantPay sends an OTP to the registered mobile

Step 2 – POST /api/kyc/validate-otp
  └─ Submit the OTP → InstantPay verifies it → outletId is saved on the user record
```

---

## Authentication

Every request must include a Bearer token:

```
Authorization: Bearer <access_token>
```

> 💡 *Note:* the new `GET /api/kyc/info` also requires authentication and can
> be called immediately after login to determine whether the user needs to
> complete KYC and to populate the form fields.

### How a logged-in user can tell if KYC is already complete

A user can determine whether they already have an InstantPay `outletId` (stored
as `ipay_outlet_id`) by calling either:

- `GET /api/kyc/info` (recommended) — the response includes `kycDone: true` when
  `ipay_outlet_id` is present.
- `GET /api/user/current` — the response now includes `ipay_outlet_id` directly.

Both endpoints require a valid JWT in the `Authorization` header.

---

## Step 1 — Initiate KYC

### `POST /api/kyc/initiate`

Encrypts the Aadhaar number server-side and submits merchant details to InstantPay. On success, InstantPay sends an OTP to the provided mobile number and returns reference data needed for the next step.

### Request

**Headers**

| Header          | Value                        |
| --------------- | ---------------------------- |
| `Authorization` | `Bearer <access_token>`      |
| `Content-Type`  | `application/json`           |

**Body**

| Field           | Type      | Required | Description                                        |
| --------------- | --------- | -------- | -------------------------------------------------- |
| `mobile`        | `string`  | ✅        | Merchant's mobile number (10 digits)               |
| `email`         | `string`  | ✅        | Merchant's email address                           |
| `aadhaar`       | `string`  | ✅        | Plain-text 12-digit Aadhaar number (encrypted server-side before forwarding) |
| `pan`           | `string`  | ✅        | PAN card number                                    |
| `bankAccountNo` | `string`  | ✅        | Bank account number                                |
| `bankIfsc`      | `string`  | ✅        | IFSC code of the bank branch                       |
| `consent`       | `string`  | ✅        | User consent acknowledgement (e.g. `"Y"`)          |
| `latitude`      | `string`  | ❌        | GPS latitude of the merchant (optional)            |
| `longitude`     | `string`  | ❌        | GPS longitude of the merchant (optional)           |

**Example Request**

```json
{
  "mobile": "9876543210",
  "email": "merchant@example.com",
  "aadhaar": "123456789012",
  "pan": "ABCDE1234F",
  "bankAccountNo": "1234567890",
  "bankIfsc": "SBIN0001234",
  "latitude": "28.6139",
  "longitude": "77.2090",
  "consent": "Y"
}
```

### Response

**200 OK — OTP dispatched**

```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "otpReferenceID": "REF1234567890",
    "hash": "abc123hashvalue"
  }
}
```

> ⚠️ **Store `otpReferenceID` and `hash`** — both are required for Step 2.

**200 OK — InstantPay returned an error (e.g. duplicate merchant)**

```json
{
  "success": false,
  "message": "Merchant already registered",
  "data": {
    "otpReferenceID": null,
    "hash": null
  }
}
```

### Error Responses

| Status | `message`                                              | Cause                                       |
| ------ | ------------------------------------------------------ | ------------------------------------------- |
| `400`  | `Missing required fields: <field1>, <field2>`          | One or more required body fields are absent |
| `401`  | `Not authorized, token failed`                         | Missing or invalid JWT                      |
| `502`  | `InstantPay API request failed. Please try again.`     | InstantPay upstream is unreachable/errored  |

---

## Step 2 — Validate OTP

### `POST /api/kyc/validate-otp`

Verifies the OTP entered by the merchant with InstantPay. On success, the InstantPay `outletId` is automatically saved to the authenticated user's account (`ipay_outlet_id`).

### Request

**Headers**

| Header          | Value                        |
| --------------- | ---------------------------- |
| `Authorization` | `Bearer <access_token>`      |
| `Content-Type`  | `application/json`           |

**Body**

| Field             | Type     | Required | Description                                              |
| ----------------- | -------- | -------- | -------------------------------------------------------- |
| `otpReferenceID`  | `string` | ✅        | Received from `/initiate` response                       |
| `hash`            | `string` | ✅        | Received from `/initiate` response                       |
| `otp`             | `string` | ✅        | OTP entered by the merchant                              |

**Example Request**

```json
{
  "otpReferenceID": "REF1234567890",
  "hash": "abc123hashvalue",
  "otp": "485921"
}
```

### Response

**200 OK — KYC successful**

```json
{
  "success": true,
  "message": "Outlet registered successfully",
  "data": {
    "outletId": 7890,
    "ipayResponse": {
      "statuscode": "TXN",
      "status": "Outlet registered successfully",
      "data": {
        "outletId": 7890
      }
    }
  }
}
```

> `outletId` is also persisted to the user's record in the database as `ipay_outlet_id`. No separate API call is needed to save it.

**200 OK — OTP invalid / InstantPay error**

```json
{
  "success": false,
  "message": "Invalid OTP entered",
  "data": {
    "outletId": null,
    "ipayResponse": { ... }
  }
}
```

### Error Responses

| Status | `message`                                                            | Cause                                                   |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `400`  | `otpReferenceID, otp and hash are required.`                         | One or more body fields are missing                     |
| `401`  | `Not authorized, token failed`                                       | Missing or invalid JWT                                  |
| `502`  | `InstantPay OTP validation API request failed. Please try again later.` | InstantPay upstream is unreachable/errored (3-min timeout) |

---

## Full Flow Example (JavaScript / fetch)

```js
// ─── Step 1: Initiate KYC ──────────────────────────────────────────────────
const initRes = await fetch('/api/kyc/initiate', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    mobile: '9876543210',
    email: 'merchant@example.com',
    aadhaar: '123456789012',
    pan: 'ABCDE1234F',
    bankAccountNo: '1234567890',
    bankIfsc: 'SBIN0001234',
    consent: 'Y',
  }),
});

const initData = await initRes.json();

if (!initData.success) {
  // Show error message to user
  showError(initData.message);
  return;
}

const { otpReferenceID, hash } = initData.data;
// Show OTP input screen to user

// ─── Step 2: Validate OTP ─────────────────────────────────────────────────
const validateRes = await fetch('/api/kyc/validate-otp', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    otpReferenceID,
    hash,
    otp: userEnteredOtp, // collected from OTP input screen
  }),
});

const validateData = await validateRes.json();

if (validateData.success) {
  // KYC complete — outletId is saved automatically on the server
  showSuccess(`KYC verified. Outlet ID: ${validateData.data.outletId}`);
} else {
  showError(validateData.message); // e.g. "Invalid OTP"
}
```

---

## Notes

- The `aadhaar` field must be sent as plain text — the server encrypts it (AES-256-CBC) before forwarding to InstantPay. Never encrypt it on the frontend.
- The OTP expires after **~5 minutes** (controlled by InstantPay). Display a countdown timer to the user and disable the submit button on expiry.
- `success: false` with HTTP `200` means InstantPay processed the request but returned a business-level error (e.g. wrong OTP, already registered). HTTP `4xx/5xx` means a transport or validation error.
- After successful OTP validation, the authenticated user's `ipay_outlet_id` is updated automatically — no additional endpoint call is needed.
