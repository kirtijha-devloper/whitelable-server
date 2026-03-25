# Payout Charge Rules API (Admin)

This document describes the admin-only endpoints for managing **global payout charge rules**. These rules determine the service fee deducted from a merchant's wallet when a Vimo payout is initiated.

> 🔒 All endpoints require a valid JWT (`Authorization: Bearer <token>`) and an **admin** role. Non-admins receive `403 Access denied`.

---

## Base URL

```
/api/payout-charge
```

---

## Data Model

| Field | Type | Description |
|---|---|---|
| `id` | integer | Auto-generated primary key |
| `from_amount` | decimal | Lower bound of the slab (inclusive) |
| `to_amount` | decimal | Upper bound of the slab (inclusive) |
| `rate` | decimal | Charge value — interpreted based on `rate_type` |
| `rate_type` | `"flat"` \| `"percentage"` | How `rate` is applied |
| `is_active` | boolean | Whether this rule is used during charge calculation |
| `description` | string (optional) | Human-readable label shown in admin UI |
| `createdAt` | ISO 8601 | |
| `updatedAt` | ISO 8601 | |

---

## Endpoints

### 1. `GET /api/payout-charge/list` — List all rules

```http
GET /api/payout-charge/list
Authorization: Bearer <token>
```

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "from_amount": "0.00",
      "to_amount": "999.99",
      "rate": "15.0000",
      "rate_type": "flat",
      "is_active": true,
      "description": "Flat ₹15 for payouts up to ₹999",
      "createdAt": "2026-05-03T10:00:00.000Z",
      "updatedAt": "2026-05-03T10:00:00.000Z"
    },
    {
      "id": 2,
      "from_amount": "1000.00",
      "to_amount": "99999.99",
      "rate": "1.5000",
      "rate_type": "percentage",
      "is_active": true,
      "description": "1.5% for payouts ₹1,000–₹99,999",
      "createdAt": "2026-05-03T10:00:00.000Z",
      "updatedAt": "2026-05-03T10:00:00.000Z"
    }
  ]
}
```

Rules are returned ordered by `from_amount` ascending.

---

### 2. `GET /api/payout-charge/:id` — Get a single rule

```http
GET /api/payout-charge/1
Authorization: Bearer <token>
```

**Response `200`:**
```json
{
  "success": true,
  "data": { /* single rule object */ }
}
```

**Error `404`:**
```json
{ "success": false, "message": "Payout charge rule not found" }
```

---

### 3. `POST /api/payout-charge` — Create a rule

```http
POST /api/payout-charge
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body:**
```json
{
  "from_amount": 1000,
  "to_amount": 99999.99,
  "rate": 1.5,
  "rate_type": "percentage",
  "is_active": true,
  "description": "1.5% for mid-range payouts"
}
```

**Required fields:** `from_amount`, `to_amount`, `rate`, `rate_type`  
**Optional:** `is_active` (defaults to `true`), `description`

**Validations (enforced server-side):**
- `rate_type` must be `"flat"` or `"percentage"`
- `from_amount` must be strictly less than `to_amount`
- `rate` must be `>= 0`

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": 3,
    "from_amount": "1000.00",
    "to_amount": "99999.99",
    "rate": "1.5000",
    "rate_type": "percentage",
    "is_active": true,
    "description": "1.5% for mid-range payouts",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Errors:**

| Status | Message |
|---|---|
| `400` | `from_amount, to_amount, rate, and rate_type are required` |
| `400` | `rate_type must be "percentage" or "flat"` |
| `400` | `from_amount must be less than to_amount` |
| `400` | `rate must be >= 0` |

---

### 4. `PUT /api/payout-charge/:id` — Update a rule

```http
PUT /api/payout-charge/2
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body** — send only the fields to change:
```json
{
  "rate": 2.0,
  "description": "Updated to 2% commission"
}
```

All fields are optional; only provided fields are updated.

**Response `200`:**
```json
{
  "success": true,
  "data": { /* updated rule object */ }
}
```

**Errors:**

| Status | Message |
|---|---|
| `404` | `Payout charge rule not found` |
| `400` | `rate_type must be "percentage" or "flat"` |
| `400` | `from_amount must be less than to_amount` |

---

### 5. `DELETE /api/payout-charge/:id` — Delete a rule

```http
DELETE /api/payout-charge/3
Authorization: Bearer <token>
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Payout charge rule deleted"
}
```

**Error `404`:**
```json
{ "success": false, "message": "Payout charge rule not found" }
```

---

## ⚙️ How Charge is Applied During Payout

When a merchant initiates a payout, the backend resolves the service charge automatically using this priority:

1. **Active slab match** — finds an active rule where:
   ```
   is_active = true  AND  from_amount <= payoutAmount <= to_amount
   ```
2. **Calculation:**
   - `rate_type = "flat"` → `serviceCharge = rate`
   - `rate_type = "percentage"` → `serviceCharge = (payoutAmount × rate) / 100`
3. **No match** → falls back to `VIMO_DEFAULT_SERVICE_CHARGE` environment variable (or `0`)

The resolved charge details are recorded in the `payout_audit_logs` table:
```json
{
  "action": "VIMO_PAYOUT_INIT",
  "details": {
    "amount": 5000,
    "service_charge": 75,
    "charge_slab_id": 2,
    "charge_source": "db",
    "charge_rate": 1.5,
    "charge_rate_type": "percentage",
    "total_amount": 5075,
    "opening_balance": 10000,
    "closing_balance": 4925
  }
}
```

The resolved `service_charge` is also returned in the payout creation response:
```json
{
  "success": true,
  "merchantRefId": "APPV00000012",
  "service_charge": 75,
  ...
}
```

---

## 🧩 Frontend Implementation Tips (Admin UI)

### Rule table display
```
| Range (₹)           | Rate     | Type       | Status  | Description          | Actions      |
|---------------------|----------|------------|---------|----------------------|--------------|
| 0 — 999.99          | ₹15      | Flat       | Active  | Small payouts        | Edit  Delete |
| 1,000 — 99,999.99   | 1.5%     | Percentage | Active  | Standard payouts     | Edit  Delete |
```

### Slab gap / overlap warning
Validate on the frontend that newly created or edited slabs do not leave gaps or create overlaps with existing slabs — this prevents a payout from unintentionally falling back to the env-var default.

### `is_active` toggle
Allow admins to enable/disable a rule without deleting it — send only `{ "is_active": false }` to the `PUT` endpoint. This is useful for temporarily suppressing a slab during promotional periods.

### Rate type display
- `"flat"` → prefix with `₹`  (e.g. `₹20`)
- `"percentage"` → suffix with `%`  (e.g. `1.5%`)

### Client-side validation before submit
```javascript
if (!['flat', 'percentage'].includes(rule.rate_type))  → error
if (parseFloat(rule.from_amount) >= parseFloat(rule.to_amount)) → error
if (parseFloat(rule.rate) < 0) → error
```

### Show charge preview at payout initiation (merchant UI)
After the merchant enters the payout amount, call `GET /api/payout-charge/list` to find the matching active slab client-side and display a live charge preview before submission:

```javascript
function previewCharge(amount, rules) {
  const rule = rules.find(r =>
    r.is_active &&
    parseFloat(r.from_amount) <= amount &&
    amount <= parseFloat(r.to_amount)
  );
  if (!rule) return 0;
  return rule.rate_type === 'flat'
    ? parseFloat(rule.rate)
    : (amount * parseFloat(rule.rate)) / 100;
}
```

---

## 📌 Typical Slab Configuration Example

| Range | Rate | Type | Notes |
|---|---|---|---|
| ₹0 – ₹999 | ₹15 | flat | Low-value payout flat fee |
| ₹1,000 – ₹9,999 | 1% | percentage | Standard mid-range |
| ₹10,000 – ₹99,999 | 0.75% | percentage | Discounted for high-value |
| ₹1,00,000 – ₹9,99,999 | 0.5% | percentage | Bulk payout rate |
