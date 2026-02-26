# Admin Wallet Adjustment API

Admin-only endpoints to directly **credit** (add) or **debit** (remove) money from any merchant or franchisee wallet. Every operation is recorded in the Ledger table with a full audit trail.

---

## Base URL

```
/api/admin/wallet
```

---

## Authentication

All requests must include a valid admin Bearer token.

```
Authorization: Bearer <admin_jwt_token>
```

Requests from non-admin users return `403 Forbidden`.

---

## Idempotency — Required Reading

Every request **must** include an `idempotency_key` — a UUID generated on the client **once per intended operation**.

### Why it is required

| Scenario | Without key | With key |
|---|---|---|
| Admin double-clicks submit | Money moves twice ❌ | Moves once, duplicate ignored ✅ |
| Page reload after submit | Money moves again ❌ | Moves once, duplicate ignored ✅ |
| Network timeout + retry | Money moves again ❌ | Moves once, duplicate ignored ✅ |

### Rules

- Generate the UUID **when the form/modal opens**, not on button click.
- Use the **same key** for all retries of the same operation.
- Generate a **new UUID** for every new/separate operation.
- A key is scoped to `(user_id + action type)`. The same UUID used for a credit on user 10 will not conflict with a debit on user 10.

### JavaScript — generating the key

```javascript
// Modern browsers and Node.js 19+
const idempotencyKey = crypto.randomUUID();
// → "550e8400-e29b-41d4-a716-446655440000"

// Older environments — use the 'uuid' npm package
import { v4 as uuidv4 } from 'uuid';
const idempotencyKey = uuidv4();
```

---

## Endpoints

### 1. Credit Wallet

Add money to a user's wallet.

```
POST /api/admin/wallet/credit
```

#### Request Headers

| Header | Value |
|---|---|
| `Authorization` | `Bearer <token>` |
| `Content-Type` | `application/json` |

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | ✅ | ID of the target merchant or franchisee |
| `amount` | number | ✅ | Positive decimal amount to add (e.g. `500.00`) |
| `reason` | string | ❌ | Human-readable remark saved in the Ledger |
| `idempotency_key` | string (UUID) | ✅ | Unique key to prevent duplicate submissions |

#### Example Request

```json
{
  "user_id": 42,
  "amount": 1500.00,
  "reason": "Bonus for Q1 target achievement",
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Wallet credit applied successfully.",
  "data": {
    "ledger_id": 301,
    "user_id": 42,
    "user_name": "Ravi Kumar",
    "user_role": "merchant",
    "idempotency_key": "550e8400-e29b-41d4-a716-446655440000",
    "action": "credit",
    "amount": 1500.00,
    "balance_before": 3200.50,
    "balance_after": 4700.50,
    "description": "Admin credit: Bonus for Q1 target achievement",
    "created_at": "2026-02-26T10:30:00.000Z"
  }
}
```

#### Duplicate Request Response — `200 OK`

When the same `idempotency_key` is sent again, the original result is returned without moving any money.

```json
{
  "success": true,
  "message": "Duplicate request detected. Returning the original result.",
  "data": { ... }
}
```

---

### 2. Debit Wallet

Remove money from a user's wallet.

```
POST /api/admin/wallet/debit
```

#### Request Headers

| Header | Value |
|---|---|
| `Authorization` | `Bearer <token>` |
| `Content-Type` | `application/json` |

#### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | ✅ | ID of the target merchant or franchisee |
| `amount` | number | ✅ | Positive decimal amount to remove (e.g. `200.00`) |
| `reason` | string | ❌ | Human-readable remark saved in the Ledger |
| `idempotency_key` | string (UUID) | ✅ | Unique key to prevent duplicate submissions |

#### Example Request

```json
{
  "user_id": 42,
  "amount": 200.00,
  "reason": "Recovery of incorrectly credited amount",
  "idempotency_key": "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
}
```

#### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Wallet debit applied successfully.",
  "data": {
    "ledger_id": 302,
    "user_id": 42,
    "user_name": "Ravi Kumar",
    "user_role": "merchant",
    "idempotency_key": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "action": "debit",
    "amount": 200.00,
    "balance_before": 4700.50,
    "balance_after": 4500.50,
    "description": "Admin debit: Recovery of incorrectly credited amount",
    "created_at": "2026-02-26T10:35:00.000Z"
  }
}
```

---

## Error Responses

| HTTP Status | `message` | Cause |
|---|---|---|
| `400 Bad Request` | `user_id is required...` | Missing or invalid field |
| `400 Bad Request` | `amount is required and must be a positive number.` | Amount is 0, negative, or missing |
| `400 Bad Request` | `idempotency_key is required...` | Missing or blank idempotency key |
| `403 Forbidden` | `Admin access only.` | Token belongs to non-admin user |
| `404 Not Found` | `User not found or not a merchant / franchisee.` | `user_id` does not exist or is an admin |
| `422 Unprocessable Entity` | `User account is currently inactive...` | Target user is not `active` |
| `422 Unprocessable Entity` | `Insufficient wallet balance...` | Debit amount exceeds current balance |
| `500 Internal Server Error` | `Something went wrong.` | Unexpected server/DB error |

#### Example Error — `422 Insufficient Balance`

```json
{
  "success": false,
  "message": "Insufficient wallet balance. Current balance: ₹150.00, requested debit: ₹200.00.",
  "data": {
    "current_balance": 150.00
  }
}
```

---

## Frontend Integration Pattern

Below is a complete example showing the recommended pattern for a React/Vue admin panel button.

```javascript
// adminWalletService.js

const BASE_URL = '/api/admin/wallet';

/**
 * @param {'credit'|'debit'} action
 * @param {object} payload  { user_id, amount, reason }
 * @param {string} idempotencyKey  Generated once per form open
 */
export async function adjustWallet(action, payload, idempotencyKey, token) {
  const res = await fetch(`${BASE_URL}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...payload,
      idempotency_key: idempotencyKey,
    }),
  });

  const data = await res.json();

  if (!res.ok && res.status !== 200) {
    throw new Error(data.message || 'Request failed');
  }

  return data; // { success, message, data: { ledger_id, balance_before, balance_after, ... } }
}
```

```javascript
// AdminWalletModal.jsx  (React example)

import { useState, useRef } from 'react';
import { adjustWallet } from './adminWalletService';

export function AdminWalletModal({ userId, action, token, onSuccess }) {
  const [amount, setAmount]   = useState('');
  const [reason, setReason]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  // ✅ Generate idempotency key ONCE when the modal renders
  const idempotencyKey = useRef(crypto.randomUUID());

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // prevent double-submit

    setLoading(true);
    setError(null);

    try {
      const result = await adjustWallet(
        action,                         // 'credit' or 'debit'
        { user_id: userId, amount: parseFloat(amount), reason },
        idempotencyKey.current,         // same key on every retry
        token
      );
      onSuccess(result.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="number"
        placeholder="Amount"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        min="0.01"
        step="0.01"
        required
      />
      <input
        type="text"
        placeholder="Reason (optional)"
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Processing...' : `Confirm ${action}`}
      </button>
    </form>
  );
}
```

> **Key point:** `idempotencyKey` is stored in a `useRef` so it is created once when the modal mounts and does not change across re-renders or retries. If you close and reopen the modal for a new operation, a new UUID is automatically generated.

---

## Ledger Record

Each successful adjustment creates one row in the `Ledgers` table:

| Column | Credit value | Debit value |
|---|---|---|
| `transaction_type` | `admin_credit` | `admin_debit` |
| `transaction_id` | the `idempotency_key` | the `idempotency_key` |
| `credit` | transferred amount | `0` |
| `debit` | `0` | transferred amount |
| `balance_before` | balance before | balance before |
| `balance` | balance after | balance after |
| `description` | `Admin credit: <reason>` | `Admin debit: <reason>` |
| `metadata` | `{ admin_id, admin_name, idempotency_key }` | same |
| `status` | `completed` | `completed` |

The entry is visible in the user's passbook via `GET /api/ledger/entries?user_id=<id>`.
