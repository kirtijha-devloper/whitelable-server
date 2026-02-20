# POS Charge API — Frontend Integration Guide

Base URL: `/api/pos-charge`

All endpoints require a **Bearer token** in the `Authorization` header.

```
Authorization: Bearer <token>
```

---

## Roles & Permissions Overview

| Action | admin | franchaise | merchant |
|--------|:-----:|:----------:|:--------:|
| Create / edit / delete default rates | ✅ | ❌ | ❌ |
| Read default rates | ✅ | ✅ | ✅ |
| Assign rate to any user | ✅ | ❌ | ❌ |
| Assign rate to own merchant | ❌ | ✅ | ❌ |
| View user-specific rates | ✅ all | ✅ own merchants | ✅ self only |
| Edit / delete any user rate | ✅ | ❌ | ❌ |
| Edit / delete own merchant's rate | ❌ | ✅ | ❌ |
| Calculate effective charge | ✅ | ✅ | ✅ |

---

## Data Model

### PosChargeDefault (global default rates)

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | integer | — | Primary key |
| `payment_mode` | string | ✅ null = any | e.g. `"CARD"`, `"UPI"` |
| `payment_card_type` | string | ✅ null = any | e.g. `"CREDIT"`, `"DEBIT"` |
| `payment_card_brand` | string | ✅ null = any | e.g. `"VISA"`, `"MASTERCARD"`, `"RUPAY"` |
| `percent_fee` | decimal | — | Rate in percent (e.g. `1.5` = 1.5%) |
| `is_active` | boolean | — | Whether this rate is active |
| `created_by` | integer | — | User ID of creator |
| `createdAt` | datetime | — | |
| `updatedAt` | datetime | — | |

### UserPosCharge (merchant-specific overrides)

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | integer | — | Primary key |
| `user_id` | integer | — | Merchant's user ID |
| `pos_charge_default_id` | integer | — | References `PosChargeDefault.id` |
| `percent_fee` | decimal | ✅ null = use default | Override rate; `null` means use the default's rate |
| `is_active` | boolean | — | |
| `created_by` | integer | — | |
| `createdAt` | datetime | — | |
| `updatedAt` | datetime | — | |

---

## Specificity Resolution

When calculating a charge the system picks the **most specific** matching record using a scoring algorithm:

| Matched field | Score |
|---|---|
| `payment_card_brand` exact match | +4 |
| `payment_card_type` exact match | +2 |
| `payment_mode` exact match | +1 |
| Field is set but does **not** match | −1 |
| Field is `null` (wildcard) | 0 |

The record with the highest score wins. All comparisons are **case-insensitive**.

**Resolution order:** user-specific record → global default.

---

## Endpoints

---

### 1. List Default Rates

```
GET /api/pos-charge/default
```

All authenticated roles. Returns every configured default rate, newest first.

**Response `200`**

```json
[
  {
    "id": 1,
    "payment_mode": "CARD",
    "payment_card_type": "CREDIT",
    "payment_card_brand": "VISA",
    "percent_fee": "1.50",
    "is_active": true,
    "created_by": 1,
    "createdAt": "2026-02-20T10:00:00.000Z",
    "updatedAt": "2026-02-20T10:00:00.000Z"
  },
  {
    "id": 2,
    "payment_mode": "CARD",
    "payment_card_type": null,
    "payment_card_brand": null,
    "percent_fee": "0.80",
    "is_active": true,
    "created_by": 1,
    "createdAt": "2026-02-20T09:00:00.000Z",
    "updatedAt": "2026-02-20T09:00:00.000Z"
  }
]
```

---

### 2. Create Default Rate

```
POST /api/pos-charge/default
```

**Role required:** `admin`

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paymentMode` | string | optional | e.g. `"CARD"` — omit or `null` for wildcard |
| `paymentCardType` | string | optional | e.g. `"CREDIT"` |
| `paymentCardBrand` | string | optional | e.g. `"VISA"` |
| `percent_fee` | number | **required** | Must be > 0 |
| `is_active` | boolean | optional | Defaults to `true` |

> The combination of `paymentMode + paymentCardType + paymentCardBrand` must be unique.  
> Any of the three can be `null` / omitted to act as a wildcard for that field.

**Example**

```json
{
  "paymentMode": "CARD",
  "paymentCardType": "CREDIT",
  "paymentCardBrand": "VISA",
  "percent_fee": 1.5
}
```

**Response `201`**

```json
{
  "message": "Default POS charge created",
  "record": {
    "id": 3,
    "payment_mode": "CARD",
    "payment_card_type": "CREDIT",
    "payment_card_brand": "VISA",
    "percent_fee": 1.5,
    "is_active": true,
    "created_by": 1,
    "createdAt": "2026-02-20T10:05:00.000Z",
    "updatedAt": "2026-02-20T10:05:00.000Z"
  }
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | `percent_fee` missing or zero |
| `400` | Duplicate combination already exists |
| `403` | Caller is not admin |

---

### 3. Update Default Rate

```
PUT /api/pos-charge/default/:id
```

**Role required:** `admin`

**Request body** — all fields optional, only send what you want to change.

| Field | Type | Description |
|-------|------|-------------|
| `paymentMode` | string \| null | Updated mode |
| `paymentCardType` | string \| null | Updated card type |
| `paymentCardBrand` | string \| null | Updated brand |
| `percent_fee` | number | Updated rate |
| `is_active` | boolean | Toggle active state |

**Example — change the rate only**

```json
{ "percent_fee": 2.0 }
```

**Example — deactivate**

```json
{ "is_active": false }
```

**Response `200`**

```json
{
  "message": "Updated",
  "record": { "id": 3, "percent_fee": 2.0, "is_active": true, "..." : "..." }
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | Updated combination would duplicate an existing record |
| `403` | Caller is not admin |
| `404` | Record not found |

---

### 4. Delete Default Rate

```
DELETE /api/pos-charge/default/:id
```

**Role required:** `admin`

**Response `200`**

```json
{ "message": "Deleted" }
```

**Error responses**

| Status | Reason |
|--------|--------|
| `403` | Caller is not admin |
| `404` | Record not found |

---

### 5. Assign Rate to a User (Merchant)

```
POST /api/pos-charge/user
```

**Roles:** `admin` (any merchant), `franchaise` (own merchants only)

**Request body**

| Field | Type | Required for admin | Required for franchaise | Description |
|-------|------|--------------------|------------------------|-------------|
| `user_id` | integer | ✅ | ✅ | Target merchant's ID |
| `pos_charge_default_id` | integer | optional | ✅ | ID from `PosChargeDefault`; franchise **must** supply this |
| `percent_fee` | number | optional | optional | Per-user rate override; omit to inherit the default's rate |
| `paymentMode` | string | optional* | — | Only used when admin creates default inline |
| `paymentCardType` | string | optional* | — | Only used when admin creates default inline |
| `paymentCardBrand` | string | optional* | — | Only used when admin creates default inline |
| `is_active` | boolean | optional | optional | Defaults to `true` |

> **Admin inline creation:** if `pos_charge_default_id` is not provided, admin must supply `percent_fee` (and optionally the three combination fields). The system will auto-create or re-use a matching `PosChargeDefault` row.  
> **Franchise:** must always pass `pos_charge_default_id`. The merchant's `franchaise_id` must match the calling franchise's ID.

**Example — franchise assigns existing default to merchant**

```json
{
  "user_id": 42,
  "pos_charge_default_id": 1
}
```

**Example — franchise assigns default with a custom override rate**

```json
{
  "user_id": 42,
  "pos_charge_default_id": 1,
  "percent_fee": 1.2
}
```

**Example — admin creates inline (no pre-existing default needed)**

```json
{
  "user_id": 42,
  "paymentMode": "CARD",
  "paymentCardType": "DEBIT",
  "paymentCardBrand": "RUPAY",
  "percent_fee": 0.9
}
```

**Response `201`**

```json
{
  "message": "User POS charge linked",
  "link": {
    "id": 10,
    "user_id": 42,
    "pos_charge_default_id": 1,
    "percent_fee": 1.2,
    "is_active": true,
    "created_by": 5,
    "createdAt": "2026-02-20T11:00:00.000Z",
    "updatedAt": "2026-02-20T11:00:00.000Z"
  },
  "defaultPosCharge": {
    "id": 1,
    "payment_mode": "CARD",
    "payment_card_type": "CREDIT",
    "payment_card_brand": "VISA",
    "percent_fee": 1.5,
    "is_active": true
  }
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | `user_id` missing |
| `400` | No `pos_charge_default_id` and no `percent_fee` (admin inline path) |
| `400` | Merchant already linked to this default |
| `400` | Franchise did not supply `pos_charge_default_id` |
| `403` | Caller is merchant |
| `403` | Franchise: merchant belongs to a different franchise |
| `404` | User not found |
| `404` | `pos_charge_default_id` not found |

---

### 6. List User-Specific Rates

```
GET /api/pos-charge/user
GET /api/pos-charge/user?user_id=42
```

**Role behaviour:**

| Role | Result |
|------|--------|
| `merchant` | Always returns only their own records (query param ignored) |
| `franchaise` | `?user_id=` filters to that merchant (must belong to franchise); without param, returns all merchants in the franchise |
| `admin` | `?user_id=` filters; without param, returns all records |

**Response `200`**

```json
[
  {
    "id": 10,
    "user_id": 42,
    "pos_charge_default_id": 1,
    "percent_fee": "1.20",
    "is_active": true,
    "created_by": 5,
    "createdAt": "2026-02-20T11:00:00.000Z",
    "updatedAt": "2026-02-20T11:00:00.000Z",
    "defaultPosCharge": {
      "id": 1,
      "payment_mode": "CARD",
      "payment_card_type": "CREDIT",
      "payment_card_brand": "VISA",
      "percent_fee": "1.50",
      "is_active": true
    }
  }
]
```

> `percent_fee` on the top-level object is the **user-specific override** (may be `null`, meaning the default rate applies).  
> `defaultPosCharge.percent_fee` is the base default rate.

---

### 7. Update User-Specific Rate

```
PUT /api/pos-charge/user/:id
```

**Roles:** `admin` (any), `franchaise` (own merchants only)

**Request body** — all optional, only send what changes.

| Field | Type | Description |
|-------|------|-------------|
| `pos_charge_default_id` | integer | Switch to a different default |
| `percent_fee` | number \| null | New override; send `null` to remove override and inherit default |
| `is_active` | boolean | Toggle |

**Example — update override rate**

```json
{ "percent_fee": 0.75 }
```

**Example — remove override (revert to default rate)**

```json
{ "percent_fee": null }
```

**Example — deactivate**

```json
{ "is_active": false }
```

**Response `200`**

```json
{
  "message": "Updated",
  "record": {
    "id": 10,
    "user_id": 42,
    "pos_charge_default_id": 1,
    "percent_fee": "0.75",
    "is_active": true,
    "defaultPosCharge": { "..." : "..." }
  }
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `403` | Caller is merchant, or franchise updating another franchise's merchant |
| `404` | Record or referenced default not found |

---

### 8. Delete User-Specific Rate

```
DELETE /api/pos-charge/user/:id
```

**Roles:** `admin` (any), `franchaise` (own merchants only)

**Response `200`**

```json
{ "message": "Deleted" }
```

**Error responses**

| Status | Reason |
|--------|--------|
| `403` | Caller is merchant, or franchise's cross-ownership violation |
| `404` | Record not found |

---

### 9. Calculate Effective POS Charge

```
POST /api/pos-charge/calculate
```

All authenticated roles. Returns the **effective charge** that would apply for the given payment combination.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paymentMode` | string | optional | e.g. `"CARD"` |
| `paymentCardType` | string | optional | e.g. `"CREDIT"` |
| `paymentCardBrand` | string | optional | e.g. `"VISA"` |
| `amount` | number | optional | If provided, the `fee` object is calculated |
| `user_id` | integer | optional | Admin/franchise can pass a merchant ID; merchants always resolve against themselves |

> **Merchant role:** `user_id` in the body is ignored — the system always resolves for the calling merchant.  
> **Franchise role:** must supply a `user_id` that belongs to their franchise.  
> **Admin role:** can pass any `user_id`.

**Example — calculate for a specific card**

```json
{
  "paymentMode": "CARD",
  "paymentCardType": "CREDIT",
  "paymentCardBrand": "VISA",
  "amount": 5000
}
```

**Response `200` — user-specific rate found**

```json
{
  "source": "user",
  "charge": {
    "id": 1,
    "payment_mode": "CARD",
    "payment_card_type": "CREDIT",
    "payment_card_brand": "VISA",
    "percent_fee": 1.2,
    "is_active": true
  },
  "fee": {
    "percent_fee": 1.2,
    "fee": 60.00
  }
}
```

**Response `200` — fell back to global default**

```json
{
  "source": "default",
  "charge": {
    "id": 2,
    "payment_mode": "CARD",
    "payment_card_type": null,
    "payment_card_brand": null,
    "percent_fee": 0.8,
    "is_active": true
  },
  "fee": {
    "percent_fee": 0.8,
    "fee": 40.00
  }
}
```

**Response `200` — without `amount` (charge info only, no fee)**

```json
{
  "source": "default",
  "charge": { "..." : "..." },
  "fee": null
}
```

**Response `404` — no matching configuration**

```json
{ "message": "No POS charge configuration found for the given combination" }
```

**Error responses**

| Status | Reason |
|--------|--------|
| `403` | Franchise: `user_id` belongs to a different franchise |
| `404` | No rate configured for the combination |

---

## Common Error Shape

All error responses follow this structure:

```json
{
  "message": "Human-readable description of the error"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request — validation failed |
| `401` | Missing or invalid Bearer token |
| `403` | Authenticated but not authorized for this action |
| `404` | Resource not found |
| `500` | Unexpected server error |

---

## Frontend Usage Recipes

### Show applicable charge to a merchant at checkout

```js
// Called when user selects card type before confirming payment
async function getCheckoutCharge(paymentMode, cardType, cardBrand, amount) {
  const res = await fetch('/api/pos-charge/calculate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      paymentMode,
      paymentCardType: cardType,
      paymentCardBrand: cardBrand,
      amount,
    }),
  });

  if (res.status === 404) return null; // no charge config — treat as 0

  const data = await res.json();
  // data.fee.fee  → numeric charge amount
  // data.fee.percent_fee → rate applied
  return data;
}
```

---

### Admin — create a new default rate (React example)

```js
async function createDefaultRate(payload) {
  const res = await fetch('/api/pos-charge/default', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message); // e.g. "A default POS charge for this combination already exists"
  }

  return res.json(); // { message, record }
}

// Usage:
await createDefaultRate({
  paymentMode: 'CARD',
  paymentCardType: 'CREDIT',
  paymentCardBrand: 'RUPAY',
  percent_fee: 1.8,
});
```

---

### Franchise — assign a rate to one of their merchants

```js
async function assignRateToMerchant(merchantId, defaultId, overridePercent = null) {
  const body = { user_id: merchantId, pos_charge_default_id: defaultId };
  if (overridePercent !== null) body.percent_fee = overridePercent;

  const res = await fetch('/api/pos-charge/user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${franchaiseToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message);
  }

  return res.json();
}
```

---

### Admin — list all merchant-specific rates for a merchant

```js
async function getMerchantRates(merchantId) {
  const res = await fetch(`/api/pos-charge/user?user_id=${merchantId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  return res.json(); // array of UserPosCharge with nested defaultPosCharge
}
```

---

## Notes

- Comparisons for `paymentMode`, `paymentCardType`, `paymentCardBrand` are **case-insensitive** — send `"VISA"` or `"visa"`, both work.
- A `null` field in a `PosChargeDefault` row acts as a **wildcard** — it matches any value for that field.
- The most specific matching record always wins — a VISA+CREDIT+CARD config will beat a CARD-only wildcard config.
- If `percent_fee` on a `UserPosCharge` is `null`, the `defaultPosCharge.percent_fee` is used for fee calculation.
