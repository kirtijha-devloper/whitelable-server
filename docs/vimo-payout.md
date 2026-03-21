# VIMO Payout Integration (Frontend)

This document describes how the frontend can use the new Vimo payout flow endpoints in the backend.

## Base path

- `/api/vimo`

## Auth

- All routes require `Authorization: Bearer <token>` from authenticated user.

## Supported routes

### 0) Beneficiary management (shared with CredXPay)

- `POST /api/vimo/beneficiaries` or `/payout/credxpay/beneficiaries` - create beneficiary
- `GET /api/vimo/beneficiaries/:user_id` - list user beneficiaries
- `PUT /api/vimo/beneficiaries/:id` - update beneficiary
- `DELETE /api/vimo/beneficiaries/:id` - delete beneficiary

Each beneficiary has:
- `name`, `account_number`, `ifsc_code`, `bank_name`, optional `branch_name`, `mobile`, `email`, `is_verified`

### 1) Get Vimo auth-token status

- `GET /api/vimo/auth/token` (now supported)
- `POST /api/vimo/auth/token` (original)

#### Query

- `forceRefresh=true` (optional) to force refresh token.

#### Response

```json
{
  "successStatus": true,
  "message": "Token fetched...",
  "responseCode": "000",
  "data": "<token-string>"
}
```


### 2) Fetch bank list

- `GET /api/vimo/banks`

#### Response

- `data`: array of bank info (server format depends on Vimo response)

### 3) Fetch purpose list

- `GET /api/vimo/purposes`

### 4) Fetch states list

- `GET /api/vimo/states`

### 5) Create Vimo payout

- `POST /api/vimo/payout`

#### Request fields (beneficiary details)

- `user_id`: number (performing user)
- `amount`: number (payout amount)
- `merchantRefId`: string
- `paymentMode`: string
- `paymentPurpose`: string
- `beneficiary_id`: number (optional, preferred)
- `beneficiaryBank`: string
- `beneficiaryAccountNumber`: string
- `beneficiaryIFSC`: string
- `beneficiaryMobileNumber`: string
- `beneficiaryName`: string
- `beneficiaryLocation`: string
- `lat`, `long`: string
- `tpin`: string ( required) 
- `purpose`: string (optional)
- `service_charge`: number (optional)

If `beneficiary_id` is supplied, the corresponding record is loaded from the beneficiary table and fills missing beneficiary fields automatically.

#### Example

```http
POST /api/vimo/payout
Authorization: Bearer <token>
Content-Type: application/json

{
  "user_id": 2,
  "amount": 1000,
  "merchantRefId": "MV-12345",
  "paymentMode": "IMPS",
  "paymentPurpose": "MERCHANT_PAYOUT",
  "beneficiaryBank": "State Bank",
  "beneficiaryAccountNumber": "1234567890",
  "beneficiaryIFSC": "SBIN0000001",
  "beneficiaryMobileNumber": "9999999999",
  "beneficiaryName": "Merchant LP",
  "beneficiaryLocation": "Delhi",
  "lat": "28.6139",
  "long": "77.2090",
  "tpin": "9876"
}
```

#### Response (success)

```json
{
  "successStatus": true,
  "message": "Payout processed successfully",
  "responseCode": "000",
  "data": {
    "txnStatus": "PENDING",
    "txnId": "TXN001",
    ...
  }
}
```

#### Response (error)

- `400` insufficient wallet: `{ "message": "Insufficient wallet balance" }`
- `403` payout disabled: `{ "message": "Payout service is disabled for this user" }`
- `400` invalid or missing fields

## Notes for Frontend

1. Always check current user payload (`is_payout_enabled`) from user profile/internal state.
2. Disable the payout button in UI when false.
3. Show clear error state in form if insufficient balance is returned.
4. After successful payout, refresh user wallet and ledger screen.

## Roles

- `merchant` and `franchaise` may perform payouts through this flow.
- Other roles (including admin) receive `403` on payout API.

## Backend side-effects

- `branchxController` and `credxpayController` both enforce `is_payout_enabled` and wallet balance.
- `ledgerService.createPayoutEntry` is called on successful/pending payout to deduct balance.
