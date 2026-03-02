# BranchX Payment API

This document describes the set of routes mounted at `/api/payment/v2`.
All routes require a valid JWT in the `Authorization` header; the token is
validated by the shared `validateTokenHandler` middleware.  These endpoints
wrap the external BranchX service and perform auxiliary checks, ledger entries
and database work as needed.

> Base path: **`/api/payment/v2`**

---

## Bank account validation

**POST** `/bank/validation`

Performs a penny‑drop validation of a bank account via BranchX.

### Request body

```json
{
  "accountNumber": "1234567890",
  "ifscCode": "ABCD0123456",
  "mobileNumber": "9876543210",        // optional
  "requestId": "unique‑ref",          // optional
  "bankName": "ACME Bank"             // optional
}
```

* `accountNumber` and `ifscCode` are required; the handler returns `400` if
  either is missing.
* Any additional fields are passed through to BranchX.

### Behaviour

1. Sends the payload to BranchX `/service/bank/validation/v2` endpoint.
2. If BranchX responds with `status: "FAILED"` the same status code and
   message are forwarded to the caller.
3. On successful validation (`status` other than `FAILED`):
   * If a `ServiceFee` record exists with `service_name = 'bank_verification'`
     and is active, a ledger debit is created for that fee.  This automatically
     updates the merchant's wallet balance.
   * Returns JSON containing `utr`, `name`, `api_ref`, `status`, `statuscode`,
     etc.

### Sample success response

```json
{
  "success": true,
  "message": "Bank account validated successfully",
  "data": {
    "utr": "<utr>",
    "name": "<account-holder>",
    "api_ref": "<ref>",
    "status": "SUCCESS",
    "statuscode": "200"
  }
}
```

### Notes

* The frontend should not attempt to charge or update the wallet – the fee is
  handled automatically by the route.
* The only external API call performed is to BranchX; no other third‑party
  service is invoked for validation.

---

## Payouts

**POST** `/payout`

Initiates a transfer to a verified beneficiary.  (See `branchxService.payout`)
Refer to the existing integration documentation for full details; this route
includes additional T‑PIN checks, wallet balance verification and ledger
updates.

---

## Remitter KYC

- **POST** `/remitter/kyc/input` – submit customer KYC data.
- **GET** `/remitter/kyc/verify?otp=<otp>` – verify KYC OTP.

These routes simply proxy the corresponding BranchX endpoints and return the
result to the caller.

---

## Beneficiary management

- **GET** `/beneficiaries/:merchant_id` – retrieve active/verified beneficiaries
  belonging to the merchant.
- **POST** `/add-beneficiary` – add a new beneficiary; performs an internal
  bank validation first and marks the record `verified` if successful.
- **DELETE** `/beneficiary/:id?merchantId=<merchant>` – soft‑delete the
  beneficiary (sets `status` to `inactive`).

Input validation and permission checks are handled by the controller.

---

## Transaction queries

- **GET** `/payout-transactions` – list payout history, with optional
  filtering by merchant, beneficiary, status, page/limit parameters.

Additional query routes may be defined lower in the controller; consult the
source for the full list.

---

## Implementation notes for backend developers

* All handlers are defined in `controllers/payments/branchxController.js`.
* BranchX service logic resides in `services/payments/branchxService.js`.
* Ledger updates use `services/ledgerService.js`, with `transactionType`
  values such as `service_fee` and `payout`.
* Fee amounts for account validation are stored in `ServiceFee` (`service_name`
  = `'bank_verification'`).
* The `branchxRoutes` router simply applies token validation, then mounts the
  controller; no additional middleware is required.

---

This documentation can be used both by frontend developers consuming the API
and by backend engineers looking for a high‑level overview of the BranchX
integration.