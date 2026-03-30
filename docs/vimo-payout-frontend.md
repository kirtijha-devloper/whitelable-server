# Vimo Payout Integration (Frontend)

## Overview

- JWT-protected endpoints (except callback)
- Payout enable check via `/api/user/current`
- Idempotent payout requests via `merchantRefId` (`APPV00000001...`)
- Service charge set by backend (env var)
- Duplicate protection (409 on same `merchantRefId`)
- Callback webhook endpoint public

---

## 1) Get current user

### Endpoint
- `GET /api/user/current`
- Header: `Authorization: Bearer <JWT>`

### Sample response
```json
{
  "email": "merchant@example.com",
  "mobile_number": "9876543210",
  "name": "Merchant User",
  "role": "merchant",
  "id": 42,
  "is_payout_enabled": true,
  "status": "active"
}
```

### UI behavior
- if `is_payout_enabled === false`:
  - show `Payout not enabled`
  - disable payout steps
- if `true`:
  - allow payout flow

---

## 2) Get sequential reference
### Endpoint
- `GET /api/vimo/payout/reference`
- Header: `Authorization: Bearer <JWT>`

### Response
```json
{
  "success": true,
  "merchantRefId": "APPV00000001"
}
```

Use this `merchantRefId` for retries and duplicate prevention.

---

## 3) Create payout transaction
### Endpoint
- `POST /api/vimo/payout`
- Header:
  - `Authorization: Bearer <JWT>`
  - `Content-Type: application/json`

### Body fields
- `amount` (required, number > 0)
- `tpin` (required)
- beneficiary info (one path):
  - `beneficiary_id` (existing) OR
  - `beneficiaryBank`, `beneficiaryAccountNumber`, `beneficiaryIFSC`, `beneficiaryName`
- `user_id` (from current user)
- optional:
  - `merchantRefId` (recommended)
  - `paymentPurpose`, `paymentMode`, `purpose`, `latitude`, `longitude`

> `beneficiaryLocation` is derived from DB `state` via selected beneficiary, frontend should not set this manually.

### Backend logic
1. Check user exists and `is_payout_enabled`.
2. Generate/use `merchantRefId`.
   - if provided and exists => `409 DUPLICATE_REFERENCE`
3. Compute service charge from env `VIMO_DEFAULT_SERVICE_CHARGE` (defaults 0).
4. `total_amount = amount + service_charge`.
5. Persist payout and call provider.

### Success response
```json
{
  "success": true,
  "message": "Success",
  "responseCode": "000",
  "merchantRefId": "APPV00000001",
  "service_charge": 10.0,
  "data": { ... }
}
```

### Errors
- `400 Beneficiary information missing`:
```json
{
  "success": false,
  "message": "Beneficiary information missing",
  "missing": ["beneficiaryBank", "beneficiaryIFSC"]
}
```
Possible values in `missing`: `beneficiaryBank`, `beneficiaryAccountNumber`, `beneficiaryIFSC`, `beneficiaryName`
- `400`: `Invalid payout amount`, `tpin is required`
- `403`: `Payout service is disabled for this user`
- `409`: `Duplicate merchantRefId` (`DUPLICATE_REFERENCE`)
- `500`: provider/internal

---

## 4) Callback (public)
### Endpoint
- `POST /api/vimo/callback`
- no auth

### Response
```json
{
  "successStatus": true,
  "message": "Success",
  "responseCode": "000"
}
```

---

## 5) Beneficiary CRUD

Beneficiaries are stored in a **shared table** used by all payout providers (Vimo, BranchX, and future integrations). Records are scoped by user — each user only sees their own.

### POST `/api/vimo/beneficiaries` — Add beneficiary

#### Request body

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Beneficiary's full name |
| `account_number` | Yes | Bank account number |
| `ifsc_code` | Yes | Bank IFSC |
| `bank_name` | Yes | Bank name |
| `state` | **Yes** | State code required by Vimo (e.g. `"JH"` for Jharkhand) |
| `branch_name` | No | Bank branch name |
| `mobile` | No | Mobile number |
| `email` | No | Email address |

#### Success response `201`

```json
{
  "success": true,
  "data": {
    "id": 7,
    "merchant_id": 42,
    "beneficiary_name": "John Doe",
    "account_number": "1234567890",
    "ifsc_code": "HDFC0001234",
    "bank_name": "HDFC Bank",
    "state": "JH",
    "branch_name": null,
    "mobile_number": "9876543210",
    "email": "john@example.com",
    "status": "active"
  }
}
```

> **Note:** Response field names are `beneficiary_name` and `mobile_number` (not `name` / `mobile`).

#### Error `400` — missing `state`

```json
{ "success": false, "message": "Missing required fields" }
```

---

### GET `/api/vimo/beneficiaries` — List beneficiaries

Returns **all** beneficiaries belonging to the authenticated user regardless of which provider added them. Use `state` field presence to determine if a beneficiary is Vimo-compatible.

---

### PUT `/api/vimo/beneficiaries/:id` — Update beneficiary

Pass any subset of fields to update.

---

### DELETE `/api/vimo/beneficiaries/:id` — Soft-delete beneficiary

Sets `status` to `inactive`. The record is not removed from the database.

#### Response `200`

```json
{ "success": true, "message": "Beneficiary deleted successfully" }
```

---

## 6) Recommended frontend flow
1. `GET /api/user/current` → check `is_payout_enabled`.
2. `GET /api/vimo/payout/reference` → get `merchantRefId`.
3. Build payload, include beneficiary and amount.
4. `POST /api/vimo/payout`.
5. On success → show success.
6. On `409` -> fetch new `merchantRefId`, re-submit.
7. On `403` -> show disabled message.
8. On `400/500` -> show error.

---

## 7) Env setup
```env
VIMO_DEFAULT_SERVICE_CHARGE=10
```

---

## 8) Quick checks
- `GET /api/vimo/payout/reference` returns a valid sequential ID.
- `POST /api/vimo/payout` returns `merchantRefId` + `service_charge`.
- Duplicate `merchantRefId` yields `409`.
