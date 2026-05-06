# BranchX Payout — Frontend Implementation Guide

> Base URL: **`/api/payment/v2`**
> All endpoints require a valid JWT in the `Authorization: Bearer <token>` header.
> Eligible roles: `merchant`, `franchaise`.

---

## Overview

The full payout flow involves these steps in order:

1. **Check payout is enabled** for the user.
2. **List beneficiaries** — let the user pick one, or add a new one.
3. **Add a beneficiary** (if needed) — triggers automatic bank account validation (penny drop).
4. **Enter amount + T-PIN** and submit the payout.
5. **Poll status** if the initial response is `PENDING`.

---

## Step 1 — Prerequisites

Before showing the payout UI, verify:

- `user.is_payout_enabled === true` (comes from the user profile / current-user API).
- The user has a valid, non-expired T-PIN. If not, redirect to "Generate T-PIN" screen first.

If payout is disabled the API will return `403`:
```json
{ "message": "Payout service is disabled for this user" }
```

---

## Step 2 — List Beneficiaries

**GET** `/api/payment/v2/beneficiaries/:merchant_id`

### Response

```json
{
  "success": true,
  "message": "Beneficiaries retrieved successfully",
  "count": 2,
  "data": [
    {
      "id": 1,
      "merchant_id": 42,
      "beneficiary_name": "John Doe",
      "mobile_number": "9876543210",
      "bank_name": "HDFC Bank",
      "account_number": "1234567890",
      "ifsc_code": "HDFC0001234",
      "email": "john@example.com",
      "status": "verified",
      "createdAt": "2026-03-01T10:00:00.000Z"
    }
  ]
}
```

Only `active` and `verified` beneficiaries are returned. A `status: "inactive"` record is soft-deleted and will not appear.

---

## Step 3 — Add a Beneficiary

**POST** `/api/payment/v2/add-beneficiary`

The server performs a live bank account (penny-drop) validation before saving. The `beneficiary_name` stored is taken from the validated bank record, not what the user enters.

### Request body

```json
{
  "merchant_id": 42,
  "mobile_number": "9876543210",
  "bank_name": "HDFC Bank",
  "account_number": "1234567890",
  "ifsc_code": "HDFC0001234",
  "beneficiary_name": "John Doe",
  "email": "john@example.com"
}
```

All fields are **required**.

### Success response `200`

```json
{
  "success": true,
  "message": "Beneficiary added successfully",
  "data": {
    "id": 3,
    "merchant_id": 42,
    "beneficiary_name": "JOHN DOE",
    "mobile_number": "9876543210",
    "bank_name": "HDFC Bank",
    "account_number": "1234567890",
    "ifsc_code": "HDFC0001234",
    "email": "john@example.com",
    "status": "verified"
  }
}
```

### Failure response `400` (bank validation failed)

```json
{
  "success": false,
  "message": "Bank account validation failed. Please check account number and IFSC code.",
  "data": { "status": "FAILED", "message": "Account not found", "statuscode": "400" }
}
```

### Error handling

| HTTP | Cause |
|------|-------|
| `400` | Missing fields or bank account validation failed |
| `500` | Internal / BranchX unreachable |

---

## Step 4 — Delete a Beneficiary (optional)

**DELETE** `/api/payment/v2/beneficiary/:id?merchantId=<merchant_id>`

Soft-deletes the record (sets `status` to `inactive`).

### Success response `200`

```json
{
  "success": true,
  "message": "Beneficiary deleted successfully"
}
```

---

## Step 5 — Initiate Payout

**POST** `/api/payment/v2/payout`

### Request body

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `merchant_id` | number | Yes | Logged-in merchant's ID |
| `beneficiary_id` | number | Yes | ID from the beneficiaries list |
| `amount` | number | Yes | Transfer amount in INR (must be > 0) |
| `tpin` | string/number | Yes | Current T-PIN |
| `purpose` | string | No | Narration / purpose of transfer |
| `latitude` | string | No | Device GPS latitude |
| `longitude` | string | No | Device GPS longitude |
| `service_charge` | number | No | If omitted, calculated automatically from admin slabs |

> **Note on service_charge:** You may omit this field entirely. The server will find the applicable `branchx_payout` charge slab for the given amount and compute the fee. If you want to show the fee to the user before submission, you can calculate it client-side using the slab data or expose a dedicated preview endpoint. It is safe to send `0` — the server will override it with slab-computed value.

### Example request

```json
{
  "merchant_id": 42,
  "beneficiary_id": 3,
  "amount": 5000,
  "tpin": "123456",
  "purpose": "Vendor payment",
  "latitude": "18.5204",
  "longitude": "73.8567"
}
```

### Success response `200`

```json
{
  "success": true,
  "message": "Payout request processed successfully",
  "data": {
    "status": "SUCCESS",
    "statuscode": "200",
    "message": "Transfer initiated",
    "utr": "BX2026XXXXXXXX",
    "api_ref": "REF-XXXXXXXX"
  }
}
```

### Pending response `200`

```json
{
  "success": true,
  "message": "Payout request processed successfully",
  "data": {
    "status": "PENDING",
    "statuscode": "200",
    "api_ref": "REF-XXXXXXXX"
  }
}
```

When status is `PENDING`, store `data.api_ref` or the `reference_id` from a subsequent transaction list call, then poll Step 6.

### Failure response `400`

```json
{
  "success": false,
  "message": "Payout request failed",
  "data": {
    "status": "FAILED",
    "statuscode": "400",
    "message": "Insufficient funds at partner"
  }
}
```

### Error responses

| HTTP | Message | Action |
|------|---------|--------|
| `400` | `"T-PIN is required"` | Show T-PIN input |
| `400` | `"T-PIN has expired. Please generate a new one."` | Redirect to T-PIN generation |
| `401` | `"Invalid T-PIN"` | Show error, allow retry |
| `400` | `"Invalid transfer amount"` | Validate amount field |
| `400` | `"Insufficient wallet balance"` | Show current balance |
| `403` | `"Payout service is disabled for this user"` | Hide payout UI |
| `403` | `"Only merchant or franchise can initiate payouts"` | Role guard |
| `404` | `"Beneficiary not found"` | Refresh beneficiary list |
| `400` | `"Beneficiary is disabled"` | Remove from list, refresh |

---

## Step 6 — Check Payout Status

Use this after receiving a `PENDING` status, or to let users manually refresh.

**POST** `/api/payment/v2/payout/status-check`

### Request body

```json
{ "reference_id": "REF-XXXXXXXX" }
```

### Response `200`

```json
{
  "success": true,
  "message": "Status check completed successfully",
  "data": {
    "status": "SUCCESS",
    "data": {
      "status": "SUCCESS",
      "utr": "BX2026XXXXXXXX",
      "message": "Transfer completed"
    }
  }
}
```

The outer `data.status` is the BranchX API-level status; the inner `data.data.status` is the actual transaction status. Use `data.data.status` (or fall back to `data.status`) to determine the final state.

**Possible transaction statuses:** `SUCCESS` | `PENDING` | `FAILED`

If the status moves to `FAILED`, the server automatically refunds the wallet via the ledger.

---

## Step 7 — List Payout Transactions

**GET** `/api/payment/v2/payout-transactions`

### Query parameters

| Param | Type | Notes |
|-------|------|-------|
| `merchant_id` | number | Filter by merchant |
| `beneficiary_id` | number | Filter by beneficiary |
| `status` | string | `SUCCESS` / `PENDING` / `FAILED` |
| `page` | number | Default `1` |
| `limit` | number | Default `10` |

### Response `200`

```json
{
  "success": true,
  "message": "Payout transactions retrieved successfully",
  "totalItems": 25,
  "currentPage": 1,
  "totalPages": 3,
  "data": [
    {
      "id": 17,
      "merchant_id": 42,
      "merchant": { "id": 42, "name": "Acme Store", "email": "acme@example.com" },
      "beneficiary_id": 3,
      "beneficiary": {
        "id": 3,
        "beneficiary_name": "JOHN DOE",
        "mobile_number": "9876543210",
        "bank_name": "HDFC Bank",
        "account_number": "1234567890",
        "ifsc_code": "HDFC0001234"
      },
      "reference_id": "a1b2c3d4-...",
      "amount": 5000,
      "service_charge": 10,
      "status": "SUCCESS",
      "purpose": "Vendor payment",
      "createdAt": "2026-03-30T08:00:00.000Z"
    }
  ]
}
```

---

## Supplementary — Bank Validation (Standalone)

If you want to validate a bank account independently (not as part of adding a beneficiary):

**POST** `/api/payment/v2/bank/validation`

> A service fee may be deducted from the wallet on successful validation if configured by admin.

### Request body

```json
{
  "accountNumber": "1234567890",
  "ifscCode": "HDFC0001234",
  "mobileNumber": "9876543210",
  "bankName": "HDFC Bank",
  "requestId": "unique-ref-001"
}
```

`accountNumber` and `ifscCode` are required; all others are optional.

### Success response `200`

```json
{
  "success": true,
  "message": "Bank account validated successfully",
  "data": {
    "utr": "BX2026XXXX",
    "name": "JOHN DOE",
    "api_ref": "REF-XXXX",
    "status": "SUCCESS",
    "statuscode": "200"
  }
}
```

---

## Recommended UI Flow

```
[Payout screen loads]
        │
        ▼
Check user.is_payout_enabled
        │ false → show "Payout disabled" message
        │ true
        ▼
GET /beneficiaries/:merchant_id
        │ empty → show "Add Beneficiary" prompt
        │ has entries
        ▼
[User selects beneficiary]
        │
        ▼
[User enters amount]
 → show computed service charge (optional preview)
 → show total = amount + service_charge
        │
        ▼
[User enters T-PIN]
        │
        ▼
POST /payout
        │
        ├─ status: SUCCESS → show success screen, update wallet balance display
        │
        ├─ status: PENDING → show "Processing..." screen
        │         │
        │         └─ Poll POST /payout/status-check every 10–15 s
        │                   ├─ SUCCESS → show success screen
        │                   └─ FAILED  → show failure screen (wallet auto-refunded)
        │
        └─ success: false → show error message from response
```

---

## Notes

- The wallet balance shown to the user should reflect **`amount + service_charge`** being held/deducted, not just the transfer amount.
- Never cache the beneficiary list across sessions; always fetch fresh on page load.
- T-PIN is a one-time credential per session. If it expires mid-flow, guide the user to regenerate it before retrying.
- The `beneficiary_name` shown in the UI will be the **bank-verified name** returned by penny-drop, which may differ from what the user typed.
