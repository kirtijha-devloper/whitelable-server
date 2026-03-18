# BBPS CC Bill Payment Charge Rules (Admin CRUD)

This document describes the **admin-only** endpoints used to manage the BBPS CC bill payment charge rules, which determine the charge applied to successful CC bill payments.

> 🔒 All endpoints require a valid JWT token and an **admin** role.

---

## Base URL

`/api/bbps-cc/charge-rules`

---

## 1) GET `/api/bbps-cc/charge-rules` — List charge rules

### ✅ Request

```http
GET /api/bbps-cc/charge-rules
Authorization: Bearer <token>
```

### ✅ Response (200)

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "from_amount": 0,
      "to_amount": 499,
      "rate": "20",
      "rate_type": "flat",
      "is_active": true,
      "description": "Default charge for orders below ₹500",
      "createdAt": "2026-03-01T12:00:00.000Z",
      "updatedAt": "2026-03-10T12:00:00.000Z"
    },
    {
      "id": 2,
      "from_amount": 500,
      "to_amount": 9999,
      "rate": "1.5",
      "rate_type": "percentage",
      "is_active": true,
      "description": "1.5% charge for higher amounts",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

## 2) POST `/api/bbps-cc/charge-rules` — Create charge rule

### ✅ Request

```http
POST /api/bbps-cc/charge-rules
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "from_amount": 0,
  "to_amount": 499,
  "rate": "20",
  "rate_type": "flat",
  "is_active": true,
  "description": "Default charge for small payments"
}
```

### ✅ Required Fields

- `from_amount` (number) ✅
- `to_amount` (number) ✅
- `rate` (string/number) ✅
- `rate_type` (string) ✅ — must be **`"percentage"`** or **`"flat"`**

### ✅ Optional

- `is_active` (boolean) — defaults to `true` if omitted
- `description` (string)

### ✅ Response (201)

```json
{
  "success": true,
  "data": {
    "id": 3,
    "from_amount": 0,
    "to_amount": 499,
    "rate": "20",
    "rate_type": "flat",
    "is_active": true,
    "description": "Default charge for small payments",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## 3) PUT `/api/bbps-cc/charge-rules/:id` — Update charge rule

### ✅ Request

```http
PUT /api/bbps-cc/charge-rules/3
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "rate": "25",
  "rate_type": "flat",
  "is_active": false,
  "description": "Temporarily disabled"
}
```

### ✅ Notes

- Only the fields provided are updated.
- If `rate_type` is provided, it must be **`"percentage"`** or **`"flat"`**.

### ✅ Response (200)

```json
{
  "success": true,
  "data": {
    "id": 3,
    "from_amount": 0,
    "to_amount": 499,
    "rate": "25",
    "rate_type": "flat",
    "is_active": false,
    "description": "Temporarily disabled",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## 4) DELETE `/api/bbps-cc/charge-rules/:id` — Delete charge rule

### ✅ Request

```http
DELETE /api/bbps-cc/charge-rules/3
Authorization: Bearer <token>
```

### ✅ Response (200)

```json
{
  "success": true,
  "message": "Charge rule deleted"
}
```

---

## ⚙️ How Charge is Applied During Payment

When a CC bill payment succeeds, the backend calculates the charge using the active rule that matches the transaction amount:

1. Finds the rule where:
   - `is_active = true`
   - `from_amount <= txnAmount <= to_amount`
2. If found:
   - `rate_type === "flat"` → charge = `rate`
   - `rate_type === "percentage"` → charge = `(txnAmount * rate) / 100`
3. If no matching rule exists, a **default flat charge of ₹20** is applied.

---

## 🧩 Frontend Tips (Admin UI)

- Show the rules list with columns:
  - `from_amount`, `to_amount`, `rate`, `rate_type`, `is_active`, `description`
- Allow admins to:
  - Toggle `is_active` without deleting the rule
  - Edit rate/range without re-creating
- Validate input client-side:
  - `from_amount` and `to_amount` should be numeric and `from_amount <= to_amount`
  - `rate_type` must be one of `['percentage','flat']`
