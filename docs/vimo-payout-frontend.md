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
  - `paymentPurpose`, `paymentMode`, `beneficiaryLocation`, `purpose`, `latitude`, `longitude`

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

- `POST /api/vimo/beneficiaries`
  - required: `name`, `account_number`, `ifsc_code`, `bank_name`
  - optional: `branch_name`, `mobile`, `email`
- `GET /api/vimo/beneficiaries`
  - returns current user's saved beneficiaries
- `PUT /api/vimo/beneficiaries/:id`
- `DELETE /api/vimo/beneficiaries/:id`

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
