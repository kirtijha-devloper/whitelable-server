# Wallet Balance — Endpoint & Integration Guide

All routes require a valid JWT:
```
Authorization: Bearer <token>
```

---

## Table of Contents

1. [GET /api/user/current — navbar balance](#1-get-apiusercurrent--navbar-balance)
2. [POST /api/admin/wallet/reconcile/:userId — fix drifted balance](#2-post-apiadminwalletreconcileuserid)
3. [Keeping the navbar in sync (polling)](#3-keeping-the-navbar-in-sync)
4. [Error responses](#4-error-responses)

---

## 1. GET /api/user/current — navbar balance

Returns the authenticated user's profile including live wallet balance. This is the endpoint to use for the navbar balance display.

### Request

```
GET /api/user/current
Authorization: Bearer <token>
```

No query parameters.

### Response `200`

```jsonc
{
  "id": 42,
  "name": "Merchant Name",
  "email": "merchant@example.com",
  "mobile_number": "9999999999",
  "mobile_number_country_code": "+91",
  "role": "merchant",
  "abheepay_id": "ABPAY001",
  "is_approved": true,
  "organization_name": "Merchant Org",
  "status": "active",
  "is_pos_asigned": true,
  "wallet": "1470.00",       // ← current spendable balance (string/decimal)
  "wallet_hold": "0.00",     // ← amount on hold, not spendable
  "tpin_set": true
}
```

### Key fields for the navbar

| Field | Use |
|-------|-----|
| `wallet` | Display as the spendable balance |
| `wallet_hold` | Optionally show as a secondary "on hold" figure |

### Error responses

| Status | When |
|--------|------|
| `401` | Token missing, expired, or invalid |
| `404` | Token valid but user record not found (treat as session expired) |

### Frontend — React example

```jsx
// hooks/useCurrentUser.js
import { useState, useEffect, useCallback } from 'react';

export function useCurrentUser() {
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res  = await fetch('/api/user/current', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) throw new Error('Unauthorized');
      const data = await res.json();
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { user, loading, refresh };
}
```

```jsx
// components/Navbar.jsx
import { useCurrentUser } from '../hooks/useCurrentUser';

export default function Navbar() {
  const { user } = useCurrentUser();

  return (
    <nav>
      {user && (
        <span>
          Wallet: ₹{parseFloat(user.wallet).toLocaleString('en-IN', {
            minimumFractionDigits: 2
          })}
        </span>
      )}
    </nav>
  );
}
```

---

## 2. POST /api/admin/wallet/reconcile/:userId

### When to use

Use this when a user's displayed balance appears incorrect — for example after a support investigation or a manual database correction.  The server recomputes the balance from the ledger and corrects `Users.wallet` if it has drifted.

### Access

Admin role only.  Returns `403` for all other roles.

### Request

```
POST /api/admin/wallet/reconcile/:userId
Authorization: Bearer <admin_jwt_token>
```

| Parameter | In | Type | Required | Description |
|-----------|-----|------|----------|-------------|
| `userId` | path | integer | Yes | ID of the user whose wallet to reconcile |

No request body required.

### Response `200` — balance was drifted, corrected

```jsonc
{
  "success": true,
  "message": "Wallet corrected from ₹970.00 → ₹1000.00",
  "data": {
    "user_id":         42,
    "user_name":       "Merchant Name",
    "user_role":       "merchant",
    "true_balance":    1000.00,   // authoritative SUM from ledger
    "previous_wallet": 970.00,    // what user.wallet held before reconcile
    "drift":           30.00,     // true_balance − previous_wallet
    "drifted":         true,
    "corrected":       true,
    "reconciled_at":   "2026-02-27T12:00:00.000Z"
  }
}
```

### Response `200` — already consistent, no change made

```jsonc
{
  "success": true,
  "message": "Wallet balance is already consistent with the ledger. No change made.",
  "data": {
    "user_id":         42,
    "user_name":       "Merchant Name",
    "user_role":       "merchant",
    "true_balance":    1470.00,
    "previous_wallet": 1470.00,
    "drift":           0.00,
    "drifted":         false,
    "corrected":       false,
    "reconciled_at":   "2026-02-27T12:00:00.000Z"
  }
}
```

### Error responses

| Status | When |
|--------|------|
| `400` | `userId` is missing or not a valid integer |
| `403` | Caller is not an admin |
| `404` | No user found for the given `userId` |
| `500` | Unexpected server error |

### Frontend — admin panel example

```javascript
// adminWalletService.js

/**
 * Reconcile a user's wallet against the ledger after any manual DB edit.
 * @param {number} userId
 * @param {string} token  Admin JWT
 * @returns {Promise<object>} Reconcile result
 */
export async function reconcileWallet(userId, token) {
  const res = await fetch(`/api/admin/wallet/reconcile/${userId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json();

  if (!res.ok) throw new Error(data.message || 'Reconcile failed');
  return data;
}

// Usage in a component
async function handleReconcile(userId) {
  try {
    const result = await reconcileWallet(userId, adminToken);
    if (result.data.drifted) {
      alert(`Balance corrected. Drift was ₹${result.data.drift}`);
    } else {
      alert('Balance is already consistent.');
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}
```

---

## 3. Keeping the navbar in sync

The server has no WebSocket or SSE push implemented.  The recommended approach is **polling** `GET /api/user/current` at a regular interval.

### React hook with auto-refresh

```jsx
// hooks/useWalletBalance.js
import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL_MS = 20_000; // refresh every 20 seconds

export function useWalletBalance() {
  const [wallet, setWallet]   = useState(null);
  const [hold, setHold]       = useState(null);
  const intervalRef           = useRef(null);

  const fetchBalance = useCallback(async () => {
    try {
      const res  = await fetch('/api/user/current', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setWallet(parseFloat(data.wallet));
      setHold(parseFloat(data.wallet_hold));
    } catch { /* network error — keep showing last known value */ }
  }, []);

  useEffect(() => {
    fetchBalance();                                    // immediate on mount
    intervalRef.current = setInterval(fetchBalance, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);  // clean up on unmount
  }, [fetchBalance]);

  // Call this manually after the user initiates a transaction
  // (payout, BBPS payment, etc.) to show the updated balance immediately.
  const refreshNow = fetchBalance;

  return { wallet, hold, refreshNow };
}
```

```jsx
// components/WalletBadge.jsx
import { useWalletBalance } from '../hooks/useWalletBalance';

export default function WalletBadge() {
  const { wallet, hold } = useWalletBalance();

  if (wallet === null) return <span>Loading…</span>;

  return (
    <div>
      <span>₹{wallet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      {hold > 0 && (
        <small> (₹{hold.toLocaleString('en-IN', { minimumFractionDigits: 2 })} on hold)</small>
      )}
    </div>
  );
}
```

### Best practice — also call `refreshNow` after transactions

After any action that changes the balance (payout submit, BBPS payment, etc.) call `refreshNow()` immediately so the user sees the updated figure without waiting for the next poll cycle:

```jsx
async function handlePayout(payload) {
  await submitPayout(payload);
  refreshNow(); // show updated balance right away
}
```

---

## 4. Error responses

| Status | Endpoint | Reason |
|--------|----------|--------|
| `401` | all | Token missing or expired |
| `403` | reconcile | Non-admin caller |
| `404` | current, reconcile | User not found |
| `400` | reconcile | Invalid `userId` path param |
| `500` | all | Unexpected server error |
