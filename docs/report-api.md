# Report API Documentation

All routes are mounted under `/api/report` and require a valid JWT:
```
Authorization: Bearer <token>
```

Date params (`from_date`, `to_date`) accept **YYYY-MM-DD** format.  
When omitted, both default to **today**.  
All timestamps in responses are ISO-8601 UTC strings.

---

## Table of Contents

1. [GET /report/pos-txn](#1-get-reportpos-txn)
2. [GET /report/wallet](#2-get-reportwallet)
3. [GET /report/razorpay](#3-get-reportrazorpay)
4. [GET /report/razorpay/all](#4-get-reportrazorpayall--admin-only)
5. [GET /report/ledger](#5-get-reportledger)
6. [GET /report/payout](#6-get-reportpayout)
7. [GET /report/bbps](#7-get-reportbbps)
8. [GET /report/all-transactions](#8-get-reportall-transactions)
9. [GET /report/users](#9-get-reportusers)
10. [Common Objects](#common-objects)
11. [Error Responses](#error-responses)

---

## 1. GET /report/pos-txn

POS terminal transaction report from the `Transactions` table.

### Access
All authenticated roles.

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `from_date` | string | No | today | Start date (YYYY-MM-DD) |
| `to_date` | string | No | today | End date (YYYY-MM-DD) |
| `status` | string | No | — | Filter by transaction status |
| `cardHolderName` | string | No | — | Partial match on card holder name |
| `posTxnNo` | string | No | — | Exact match on invoice / POS txn number |
| `deviceNo` | string | No | — | Filter by device serial number |

### Response `200`

```jsonc
{
  "message": "Transaction Report Fetched Successfully",
  "count": 12,
  "date_range": {
    "from": "2026-02-27T00:00:00.000Z",
    "to":   "2026-02-27T23:59:59.999Z"
  },
  "data": [
    {
      // Raw Transaction model fields
      "Date": "2026-02-27T10:30:00.000Z",
      "Status": "CAPTURED",
      "Consumer": "John Doe",
      "Invoice": "INV-001",
      "DeviceSerial": "SN123456"
      // ...all other Transaction columns
    }
  ]
}
```

---

## 2. GET /report/wallet

Wallet passbook for a specific user showing running debit/credit balance.

### Access
All authenticated roles. Non-admin callers are restricted to their own `userId`.

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `userId` | integer | **Yes** | — | Target user ID |
| `from_date` | string | No | today | Start date (YYYY-MM-DD) |
| `to_date` | string | No | today | End date (YYYY-MM-DD) |

### Response `200`

```jsonc
{
  "message": "Wallet transaction report fetched successfully",
  "wallet_balance": "1500.00",
  "count": 5,
  "date_range": {
    "from": "2026-02-27T00:00:00.000Z",
    "to":   "2026-02-27T23:59:59.999Z"
  },
  "data": [
    {
      "id": 101,
      "date_and_time": "2026-02-27T09:00:00.000Z",
      "utr_no": "UTR123456",        // reference_id or "-"
      "description": "Razorpay credit",
      "debit": "-",                 // string amount or "-"
      "credit": "500.00",           // string amount or "-"
      "balance": "1500.00",         // running balance (string)
      "status": "completed"
    }
  ]
}
```

> **Note:** `balance` is a running balance computed backwards from the
> user's current wallet balance. It is not sourced from the Ledger table.

---

## 3. GET /report/razorpay

User-scoped Razorpay notification report with `balance_before` and `balance_after`
joined from the Ledger table.

### Access Rules

| Role | Behaviour |
|------|-----------|
| `admin` | All records; supply `user_id` to filter; `include_unlinked=true` to include rows without a linked user |
| `franchaise` | Own records + their merchants; supply `user_id` to see one merchant |
| `merchant` | Own records only |

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `from_date` | string | No | today | Start date (YYYY-MM-DD) |
| `to_date` | string | No | today | End date (YYYY-MM-DD) |
| `user_id` | integer | No | — | Filter by user (admin / franchise only) |
| `status` | string | No | — | `AUTHORIZED`, `CAPTURED`, `FAILED`, `VOIDED` |
| `payment_mode` | string | No | — | `CARD`, `UPI`, etc. |
| `include_unlinked` | string | No | `false` | `true` = include rows with no linked user (admin only) |
| `page` | integer | No | `1` | Page number |
| `limit` | integer | No | `50` | Records per page (max 200) |

### Response `200`

```jsonc
{
  "success": true,
  "message": "Razorpay notification report fetched successfully",
  "count": 100,
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 50,
    "totalPages": 2
  },
  "date_range": {
    "from": "2026-02-27T00:00:00.000Z",
    "to":   "2026-02-27T23:59:59.999Z"
  },
  "data": [
    {
      "id": 55,
      "txn_id": "TXN_abc123",
      "mid": "MID001",
      "tid": "TID001",
      "amount": "1000.00",
      "currency_code": "INR",
      "payment_mode": "CARD",
      "payment_card_type": "DEBIT",
      "payment_card_brand": "VISA",
      "rr_number": "RR123456",
      "device_serial": "SN123456",
      "posting_date": "2026-02-27T10:00:00.000Z",
      "status": "CAPTURED",
      "user_id": 42,
      "pos_machine_id": 7,
      "user": {
        "id": 42,
        "name": "Merchant Name",
        "email": "merchant@example.com",
        "mobile_number": "9999999999",
        "abheepay_id": "ABPAY001",
        "organization_name": "Merchant Org"
      },
      "pos_machine": {
        "id": 7,
        "mid_number": "MID001",
        "tid_number": "TID001",
        "device_serial_number": "SN123456"
      },
      "created_at": "2026-02-27T10:01:00.000Z",
      "balance_before": 500.00,   // null if no ledger entry found
      "balance_after": 1000.00    // null if no ledger entry found
    }
  ]
}
```

---

## 4. GET /report/razorpay/all — Admin Only

Full unfiltered Razorpay notification list ordered by `id DESC`. No date filter.

### Access
`admin` role only. Returns `403` for all other roles.

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `page` | integer | No | `1` | Page number |
| `limit` | integer | No | `50` | Records per page (max 50) |

### Response `200`

```jsonc
{
  "success": true,
  "message": "All Razorpay notifications fetched",
  "count": 500,
  "pagination": {
    "total": 500,
    "page": 1,
    "limit": 50,
    "totalPages": 10
  },
  "data": [
    {
      // All RazorpayNotification model fields
      // Plus nested user: { id, name, email, mobile_number }
      // Plus nested pos_machine: { id, mid_number, tid_number }
    }
  ]
}
```

---

## 5. GET /report/ledger

Full Ledger passbook — every credited and debited entry with
`balance_before`, `amount`, and `balance_after` on every row.

### Access Rules

| Role | Behaviour |
|------|-----------|
| `admin` | All entries; supply `user_id` to filter to one user |
| `franchaise` | Own entries + their merchants; supply `user_id` to narrow |
| `merchant` | Own entries only |

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `from_date` | string | No | today | Start date (YYYY-MM-DD) |
| `to_date` | string | No | today | End date (YYYY-MM-DD) |
| `user_id` | integer | No | — | Filter by user (admin / franchise only) |

### Response `200`

```jsonc
{
  "success": true,
  "message": "Ledger report fetched successfully",
  "count": 8,
  "data": [
    {
      "id": 301,
      "date": "2026-02-27T11:00:00.000Z",
      "user_id": 42,
      "user": {
        "id": 42,
        "name": "Merchant Name",
        "mobile_number": "9999999999",
        "abheepay_id": "ABPAY001",
        "organization_name": "Merchant Org"
      },
      "transaction_type": "razorpay_charge",
      "description": "Transaction charge deducted: TXN_abc123 - Charge: ₹30.00",
      "debit": 30.00,            // 0 if credit entry
      "credit": 0,               // 0 if debit entry
      "amount": 30.00,           // always positive; = debit or credit
      "balance_before": 1000.00,
      "balance_after": 970.00,
      "transaction_id": "TXN_abc123",
      "reference_id": 55,
      "reference_table": "MerchantTransactionCharges",
      "status": "completed",
      "metadata": {              // parsed JSON object or null
        "transaction_amount": 1000,
        "charge_amount": 30,
        "net_amount": 970
      }
    }
  ]
}
```

### `transaction_type` values

| Value | Direction | Meaning |
|-------|-----------|---------|
| `razorpay_credit` | credit | Full Razorpay payment amount received |
| `razorpay_charge` | debit | Platform charge deducted from Razorpay amount |
| `razorpay_commission` | credit | Commission earned (merchant / franchise) |
| `payout` | debit | BranchX payout (amount + service charge) |
| `direct_transfer` | debit | SDDS IMPS transfer |
| `bbps_payment` | debit | BBPS CC bill payment |
| `wallet_credit` | credit | Admin or system wallet top-up |
| `wallet_debit` | debit | Admin or system wallet deduction |
| `rental_charge` | debit | POS machine rental fee |

---

## 6. GET /report/payout

Payout transaction report from `PayoutTransactions` with `balance_before`
and `balance_after` joined from the Ledger.

### Access Rules
Same as Ledger — scoped by role. The `user_id` filter maps to `merchant_id`
in `PayoutTransactions`.

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `from_date` | string | No | today | Start date (YYYY-MM-DD) |
| `to_date` | string | No | today | End date (YYYY-MM-DD) |
| `user_id` | integer | No | — | Filter by merchant user ID |
| `status` | string | No | — | `SUCCESS`, `PENDING`, `FAILED` |
| `page` | integer | No | `1` | Page number |
| `limit` | integer | No | `50` | Records per page (max 200) |

### Response `200`

```jsonc
{
  "success": true,
  "message": "Payout report fetched successfully",
  "count": 3,
  "pagination": {
    "total": 3,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  },
  "date_range": {
    "from": "2026-02-27T00:00:00.000Z",
    "to":   "2026-02-27T23:59:59.999Z"
  },
  "data": [
    {
      "id": 12,
      "date": "2026-02-27T14:00:00.000Z",
      "merchant_id": 42,
      "beneficiary_id": 9,
      "reference_id": "550e8400-e29b-41d4-a716-446655440000",
      "amount": 5000.00,
      "service_charge": 25.00,
      "total_deducted": 5025.00,   // amount + service_charge
      "purpose": "Vendor payment",
      "status": "SUCCESS",
      "balance_before": 10000.00,  // null if no ledger entry
      "balance_after": 4975.00     // null if no ledger entry
    }
  ]
}
```

---

## 7. GET /report/bbps

BBPS CC bill payment report sourced from the Ledger
(`transaction_type = 'bbps_payment'`).

### Access Rules
Same role-scoping as Ledger.

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `from_date` | string | No | today | Start date (YYYY-MM-DD) |
| `to_date` | string | No | today | End date (YYYY-MM-DD) |
| `user_id` | integer | No | — | Filter by user (admin / franchise only) |
| `page` | integer | No | `1` | Page number |
| `limit` | integer | No | `50` | Records per page (max 200) |

### Response `200`

```jsonc
{
  "success": true,
  "message": "BBPS report fetched successfully",
  "count": 2,
  "pagination": {
    "total": 2,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  },
  "date_range": {
    "from": "2026-02-27T00:00:00.000Z",
    "to":   "2026-02-27T23:59:59.999Z"
  },
  "data": [
    {
      "id": 88,
      "date": "2026-02-27T15:30:00.000Z",
      "user_id": 42,
      "user": {
        "id": 42,
        "name": "Merchant Name",
        "mobile_number": "9999999999",
        "abheepay_id": "ABPAY001",
        "organization_name": "Merchant Org"
      },
      "biller_id": "HDFC_CC_001",
      "customer_mobile": "9876543210",
      "payment_mode": "Cash",
      "statuscode": "TXN",          // TXN or TUP = success on InstantPay
      "external_ref": "APBBPS20261234567890",
      "description": "BBPS CC bill payment — biller: HDFC_CC_001, mobile: 9876543210",
      "amount": 2500.00,
      "balance_before": 7500.00,
      "balance_after": 5000.00,
      "status": "completed"
    }
  ]
}
```

---

## 8. GET /report/all-transactions

**Unified passbook** combining Razorpay, Payout, BBPS, Direct Transfer and
Wallet credit/debit — sourced entirely from the Ledger table, ordered by
`createdAt DESC`. Every row includes `balance_before`, `amount`, `balance_after`.

### Access Rules
Same role-scoping as Ledger.

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `from_date` | string | No | today | Start date (YYYY-MM-DD) |
| `to_date` | string | No | today | End date (YYYY-MM-DD) |
| `user_id` | integer | No | — | Filter by user (admin / franchise only) |
| `transaction_type` | string | No | all types | Narrow to one type (see §5 table) |
| `page` | integer | No | `1` | Page number |
| `limit` | integer | No | `50` | Records per page (max 200) |

### Response `200`

```jsonc
{
  "success": true,
  "message": "All transactions report fetched successfully",
  "count": 25,
  "pagination": {
    "total": 25,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  },
  "date_range": {
    "from": "2026-02-27T00:00:00.000Z",
    "to":   "2026-02-27T23:59:59.999Z"
  },
  "supported_types": [
    "razorpay_credit", "razorpay_charge", "razorpay_commission",
    "payout", "bbps_payment", "direct_transfer",
    "wallet_credit", "wallet_debit"
  ],
  "data": [
    {
      "id": 301,
      "date": "2026-02-27T15:45:00.000Z",
      "user_id": 42,
      "user": {
        "id": 42,
        "name": "Merchant Name",
        "mobile_number": "9999999999",
        "abheepay_id": "ABPAY001",
        "organization_name": "Merchant Org"
      },
      "transaction_type": "payout",
      "description": "Payout to John Vendor (Vendor payment) — ref: 550e8400-...",
      "debit": 5025.00,       // 0 for credit entries
      "credit": 0,            // 0 for debit entries
      "amount": 5025.00,      // always positive; = max(debit, credit)
      "balance_before": 10000.00,
      "balance_after": 4975.00,
      "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
      "reference_id": 12,
      "reference_table": "PayoutTransactions",
      "status": "completed"
    }
  ]
}
```

---

## 9. GET /report/users

User listing for reporting purposes.

### Access Rules

| Role | Behaviour |
|------|-----------|
| `admin` | All users; supports `status` and `role` filters |
| `franchaise` | Only users where `franchaise_id` = their own ID |
| others | Only themselves |

### Query Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `status` | string | No | — | `active`, `deactive`, etc. |
| `role` | string | No | — | `merchant`, `franchaise`, `admin` |
| `page` | integer | No | `1` | Page number |
| `limit` | integer | No | `10` | Records per page |

### Response `200`

```jsonc
{
  "success": true,
  "message": "User report fetched successfully",
  "pagination": {
    "total": 40,
    "page": 1,
    "limit": 10,
    "totalPages": 4
  },
  "data": [
    {
      // Full User model fields
    }
  ]
}
```

---

## Common Objects

### Pagination object
```jsonc
{
  "total": 100,
  "page": 1,
  "limit": 50,
  "totalPages": 2
}
```

### date_range object
```jsonc
{
  "from": "2026-02-27T00:00:00.000Z",
  "to":   "2026-02-27T23:59:59.999Z"
}
```

### Nested user object
```jsonc
{
  "id": 42,
  "name": "Merchant Name",
  "mobile_number": "9999999999",
  "abheepay_id": "ABPAY001",
  "organization_name": "Merchant Org"
}
```
> Razorpay report additionally includes `email`.

---

## Error Responses

| Status | When |
|--------|------|
| `400` | Invalid / missing parameters (`Invalid date format`, `userId is required`) |
| `400` | `from_date` is after `to_date` |
| `403` | Role-based access denied |
| `404` | `userId` not found (wallet report) |
| `500` | Unexpected server error — `{ "success": false, "message": "..." }` |

---

## Quick Reference

| Route | Auth | Date Filter | Pagination | Balance Fields |
|-------|------|------------|-----------|----------------|
| `GET /report/pos-txn` | all roles | ✅ `from_date`/`to_date` | ❌ | ❌ |
| `GET /report/wallet` | all roles | ✅ `from_date`/`to_date` | ❌ | running `balance` per row |
| `GET /report/razorpay` | role-scoped | ✅ `from_date`/`to_date` | ✅ | `balance_before`, `balance_after` |
| `GET /report/razorpay/all` | admin only | ❌ | ✅ | ❌ |
| `GET /report/ledger` | role-scoped | ✅ `from_date`/`to_date` | ❌ | `balance_before`, `amount`, `balance_after` |
| `GET /report/payout` | role-scoped | ✅ `from_date`/`to_date` | ✅ | `balance_before`, `balance_after` |
| `GET /report/bbps` | role-scoped | ✅ `from_date`/`to_date` | ✅ | `balance_before`, `amount`, `balance_after` |
| `GET /report/all-transactions` | role-scoped | ✅ `from_date`/`to_date` | ✅ | `balance_before`, `amount`, `balance_after` |
| `GET /report/users` | role-scoped | ❌ | ✅ | ❌ |