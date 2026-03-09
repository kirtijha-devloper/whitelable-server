# CredXPay Payout API (New Integration)

This document describes the routes added for the CredXPay payout provider. The existing
BranchX integration remains unchanged; these endpoints live under a separate path and
use a parallel schema.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/payout/credxpay` | Submit a payout. Requires JWT token with merchant user and valid `tpin`. |
| POST   | `/payout/credxpay/beneficiaries` | Create beneficiary record. |
| GET    | `/payout/credxpay/beneficiaries/:user_id` | List a user's beneficiaries. |
| PUT    | `/payout/credxpay/beneficiaries/:id` | Update beneficiary. |
| DELETE | `/payout/credxpay/beneficiaries/:id` | Remove beneficiary. |
| POST   | `/payout/credxpay/callback` | Webhook endpoint (IP allowlist protected). No auth required. |

---

### Frontend usage details

The two primary endpoints consumed by the frontend are explained below with headers, request bodies and an example response.

#### `POST /payout/credxpay`

Submit a new payout request. The frontend must send a valid JWT in the `Authorization` header; the token should belong to the merchant user that is initiating the transaction. The user also provides a `tpin` code for authorization.

**Headers**
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request body**
```json
{
  "amount": 1000,                    // payout amount in cents/paise
  "beneficiary_id": 123,            // ID of an existing beneficiary for this user
  "tpin": "1234",                  // merchant PIN
  "remarks": "Optional note"      // free‑form text (max 255 chars)
}
```

**Successful response**
```json
{
  "status": "pending",            // payout recorded but not yet settled
  "request_id": "abcd1234"        // internal identifier for later status checks
}
```

> The route responds immediately after debiting the wallet and creating a `payout_requests` row. Settlement with the external provider occurs asynchronously via webhook or the cron job described below.

#### `POST /payout/credxpay/beneficiaries`

Create a new beneficiary record that can be used in subsequent payouts. Requires the same merchant JWT.

**Headers**
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request body**
```json
{
  "name": "Alice Merchant",
  "account_number": "012345678901",
  "ifsc": "HDFC0001234",
  "mobile": "9876543210",          // optional, used for notifications
  "bank_name": "HDFC Bank"        // optional, for display only
}
```

**Successful response**
```json
{
  "id": 456,                        // beneficiary record ID
  "user_id": 789,
  "name": "Alice Merchant",
  "account_number": "012345678901",
  "ifsc": "HDFC0001234",
  "created_at": "2026-03-09T12:34:56.000Z"
}
```

The frontend may later fetch the list of beneficiaries via `GET /payout/credxpay/beneficiaries/:user_id` or update/delete individual entries.

---


> **Note:** The payout route responds immediately after debiting the wallet and recording
a `payout_requests` row; the external transaction is resolved asynchronously via webhook or
cron job.

## Database tables

See the migration `20260308120000-create-credxpay-payout-schema.js` for full schema.

## Configuration

Add the following environment variables:

```
CREDXPAY_BASE_URL=https://api.credxpay.info
CREDXPAY_API_KEY=yourapikey
CREDXPAY_WEBHOOK_IPS=172.16.0.1,172.16.0.2
```

Parsed configuration is available under `require('../config/config').credxpay`.

## Webhook IP allowlist

Requests to `/payout/credxpay/callback` are filtered by the `ipAllowlist` middleware. The
list is sourced from `CREDXPAY_WEBHOOK_IPS` and will return `403` for unknown clients.

## Cron job

A cron task (`cron/resolvePendingCredxpay.js`) runs every five minutes to query
`payout_requests` with status `PENDING` and check the remote API for updates. It can also
be invoked manually by importing `resolvePending`.

## Testing

There are new unit tests in `test/credxpayRoutes.test.js` covering basic validation and
service charge logic. The module uses sqlite in-memory and stubs external dependencies.
