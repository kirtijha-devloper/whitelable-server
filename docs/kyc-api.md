# KYC / InstantPay Merchant Onboarding

Base URL: `/api/kyc`

This document is written for the frontend team. It describes the exact KYC flow used for InstantPay merchant onboarding, the fields the UI must send, the responses to handle, and the user experience expectations.

---

## Purpose

The frontend should use this flow to:

- detect whether the logged-in user already has an InstantPay outlet ID
- pre-fill merchant details in the KYC form from the authenticated user record
- initiate InstantPay merchant onboarding by sending customer data and Aadhaar
- collect OTP from the user and validate it with InstantPay
- handle re-initiation when the user wants to reset their InstantPay onboarding

---

## Authentication

All KYC endpoints require a valid JWT in the `Authorization` header.

```
Authorization: Bearer <access_token>
```

> Call `GET /api/kyc/info` immediately after login to determine whether the user has already completed KYC.

---

## Step 0 — Check KYC status and pre-fill data

### `GET /api/kyc/info`

Use this endpoint to:

- pre-fill the KYC form with any existing user details
- detect whether the user already has an InstantPay outlet ID
- decide whether to show the KYC flow or the "KYC already completed" state

### Response

```json
{
  "success": true,
  "data": {
    "mobile": "9876543210",
    "email": "merchant@example.com",
    "pan": "ABCDE1234F",
    "aadhaar": "123456789012",
    "bankAccountNo": "1234567890",
    "bankIfsc": "SBIN0001234",
    "kycDone": false
  }
}
```

### What the frontend should do

- If `data.kycDone === true`, show the user as already onboarded.
- If `data.kycDone === false`, show the KYC form and pre-fill values from `data`, including `bankAccountNo` and `bankIfsc`.
- Always keep Aadhaar confidential and never store it in logs or client-side analytics.

---

## Step 1 — Initiate KYC

### Endpoint

`POST /api/kyc/initiate`

### What it does

- accepts merchant details from the frontend
- encrypts Aadhaar server-side before sending to InstantPay
- triggers InstantPay to send an OTP to the user's mobile
- returns `otpReferenceID` and `hash` required for Step 2

### Headers

| Header          | Value                        |
| --------------- | ---------------------------- |
| `Authorization` | `Bearer <access_token>`      |
| `Content-Type`  | `application/json`           |

### Body

| Field           | Type      | Required | Notes |
| --------------- | --------- | -------- | ----- |
| `mobile`        | `string`  | ✅        | Merchant's mobile number (10 digits) |
| `email`         | `string`  | ✅        | Merchant's email address |
| `aadhaar`       | `string`  | ✅        | Plain-text Aadhaar number (12 digits). Encrypt only on the server. |
| `pan`           | `string`  | ✅        | PAN card number |
| `bankAccountNo` | `string`  | ✅        | Bank account number |
| `bankIfsc`      | `string`  | ✅        | IFSC code for the account |
| `consent`       | `string`  | ✅        | Example: `"Y"` |
| `latitude`      | `string`  | ❌        | Optional; send if available |
| `longitude`     | `string`  | ❌        | Optional; send if available |
| `forceReset`    | `boolean` | ❌        | Use `true` to re-initiate when the user already has an outlet ID |

### Example request

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

### Successful response

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

### What the frontend must do next

- save `otpReferenceID` and `hash` locally for the OTP screen
- show the OTP input UI
- if the user already had `kycDone === true`, include `forceReset: true` in the request to allow the flow to start again

### Error handling

| Status | Meaning |
| ------ | ------- |
| `400`  | required fields missing or invalid |
| `401`  | token missing/invalid |
| `502`  | InstantPay request failed or upstream timeout |

If the API returns `success: false`, show the `message` to the user and keep the form open.

---

## Step 2 — Validate OTP

### Endpoint

`POST /api/kyc/validate-otp`

### What it does

- sends the OTP, `otpReferenceID`, and `hash` to InstantPay
- InstantPay validates the OTP
- the server stores the returned `outletId` as `ipay_outlet_id` for the authenticated user

### Headers

| Header          | Value                        |
| --------------- | ---------------------------- |
| `Authorization` | `Bearer <access_token>`      |
| `Content-Type`  | `application/json`           |

### Body

| Field             | Type     | Required | Notes |
| ----------------- | -------- | -------- | ----- |
| `otpReferenceID`  | `string` | ✅        | from `/api/kyc/initiate` |
| `hash`            | `string` | ✅        | from `/api/kyc/initiate` |
| `otp`             | `string` | ✅        | OTP entered by the merchant |

### Example request

```json
{
  "otpReferenceID": "REF1234567890",
  "hash": "abc123hashvalue",
  "otp": "485921"
}
```

### Successful response

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

### What the frontend should do after success

- mark KYC as complete
- show the returned `outletId` if needed
- refresh user state from `GET /api/kyc/info` or `GET /api/user/current` as required

### Error handling

| Status | Meaning |
| ------ | ------- |
| `400`  | missing `otpReferenceID`, `hash`, or `otp` |
| `401`  | token missing/invalid |
| `502`  | InstantPay validation failed or upstream timeout |

If the response is `success: false`, show the returned `message` on the OTP screen.

---

## Common frontend rules

- Never encrypt Aadhaar in the browser. Send it as plain text to the API and let the server encrypt it.
- Display a countdown timer for the OTP. InstantPay OTPs expire in about 5 minutes.
- Keep the OTP and `otpReferenceID` / `hash` tied to the same flow.
- Do not store Aadhaar or OTP values in logs or analytics.
- If the user already has `kycDone: true` and wants to reset onboarding, call `/api/kyc/initiate` with `forceReset: true`.
- On successful OTP validation, the server updates the user’s `ipay_outlet_id`; the frontend does not need a separate save call.

---

## Sample frontend flow

```js
async function startKycFlow(accessToken, payload) {
  const initRes = await fetch('/api/kyc/initiate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const initData = await initRes.json();
  if (!initData.success) {
    throw new Error(initData.message);
  }

  return {
    otpReferenceID: initData.data.otpReferenceID,
    hash: initData.data.hash,
  };
}

async function validateKycOtp(accessToken, otpReferenceID, hash, otp) {
  const res = await fetch('/api/kyc/validate-otp', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ otpReferenceID, hash, otp }),
  });
  return res.json();
}
```

---

## Notes

- The backend uses the same InstantPay environment as the Laravel implementation in this project.
- The only data sent to InstantPay is encrypted Aadhaar; the frontend should not perform encryption.
- `success: false` with HTTP `200` means InstantPay returned a business-level failure. Show the `message` to the user and let them correct or retry.
- HTTP `4xx/5xx` indicates validation or transport failure and should be handled as a network/server error.
