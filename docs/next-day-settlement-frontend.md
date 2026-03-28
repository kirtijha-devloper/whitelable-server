# Next-Day Settlement Hold — Frontend Implementation Guide

## Overview

Users with `settlement_type = "next_day_settlement"` have their POS earnings **held** until **10:30 AM IST the next day**. They cannot spend held funds via payout, CC bill payment, or any other disbursement until the hold is released.

This document explains every API response change and how the frontend should react to them.

---

## Key Concepts

| Term | Meaning |
|---|---|
| `wallet` | Total ledger balance (gross, including held funds) |
| `settlement_hold` | Amount frozen due to next-day settlement — **cannot be spent** |
| `available_balance` | Spendable amount = `wallet - settlement_hold` |
| `wallet_hold` | Separate admin-imposed hold (pre-existing, unrelated to this feature) |

---

## 1. User Profile / Dashboard (`GET /api/users/current`)

The response now includes three balance-related fields:

```json
{
  "wallet": 5000.00,
  "wallet_hold": 0.00,
  "settlement_hold": 2000.00,
  "available_balance": 3000.00
}
```

### UI Recommendation

Show a balance breakdown in the dashboard/header:

```
Total Balance      ₹5,000.00
On Settlement Hold ₹2,000.00  (releases tomorrow 10:30 AM)
Available Balance  ₹3,000.00
```

> Only show the "On Settlement Hold" row if `settlement_hold > 0`. For `today_settlement` users this will always be `0`.

**Tooltip text suggestion:**  
_"Your POS earnings from today will be available for withdrawal starting tomorrow at 10:30 AM."_

---

## 2. Passbook / Ledger (`GET /api/ledger/entries`)

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `user_id` | number | Required (admin) or from JWT (merchant) |
| `page` | number | Default `1` |
| `limit` | number | Default `50` |
| `start_date` | string | `YYYY-MM-DD` filter |
| `end_date` | string | `YYYY-MM-DD` filter |

**Response:**

```json
{
  "success": true,
  "current_balance": 5000.00,
  "available_balance": 3000.00,
  "settlement_hold": 2000.00,
  "data": [ ... ],
  "pagination": { ... }
}
```

### UI Recommendation

Display the three balance fields at the top of the passbook screen, same as the dashboard.

---

## 3. Payout / Disbursement Flow

### Before Initiating a Payout

Always use `available_balance` (not `wallet`) to determine if the user can pay.

```js
const canPayout = available_balance >= (amount + serviceCharge);
if (!canPayout) {
  // Show error
}
```

### Error Response When Balance Is Insufficient

If the user tries to initiate a payout and the `available_balance` is insufficient, the server returns:

```json
{
  "success": false,
  "message": "Insufficient wallet balance"
}
```

Show a user-friendly message that explains **why** if the user has a settlement hold:

```js
if (!response.success && settlementHold > 0) {
  showError(
    `Insufficient available balance. ₹${settlementHold.toFixed(2)} is on hold and will be` +
    ` available tomorrow at 10:30 AM. Available now: ₹${availableBalance.toFixed(2)}.`
  );
} else {
  showError("Insufficient wallet balance.");
}
```

---

## 4. CC Bill Payment Flow

Same logic as payout. The `ensureSufficientBalance` check on the server uses `available_balance`.

Pre-check on the frontend before showing the "Pay" button or calling the API:

```js
const minRequired = txnAmount + estimatedCharge + 30; // ₹30 buffer
const canPay = available_balance >= minRequired;
```

Display a warning if the user has a hold but total wallet would otherwise cover it:

```
⚠️ ₹2,000.00 of your balance is on settlement hold until tomorrow 10:30 AM.
   Available for payment: ₹3,000.00
```

---

## 5. Displaying Settlement Type

The `settlement_type` field on the user profile tells you the user's category. Use it to proactively explain holds in the UI instead of waiting for an error.

```js
if (user.settlement_type === "next_day_settlement") {
  // Show settlement hold info on dashboard
  // Disable payout CTA and show explanation if available_balance is 0
}
```

---

## 6. Checking Holds Detail (Admin)

Admins can query the `SettlementHolds` table via the ledger endpoint. The `settlement_hold` field in the ledger response shows the total unreleased hold for that user at the time of the API call.

There is no separate admin endpoint for settlement holds at this time — the `settlement_hold` field in both the user profile and ledger is sufficient for display purposes.

---

## 7. Complete Balance Display Component (Sample)

```jsx
function BalanceSummary({ user }) {
  const { wallet, settlement_hold, available_balance, settlement_type } = user;

  return (
    <div className="balance-card">
      <div className="balance-row">
        <span>Total Balance</span>
        <strong>₹{parseFloat(wallet).toFixed(2)}</strong>
      </div>

      {settlement_hold > 0 && (
        <div className="balance-row hold">
          <span>
            On Settlement Hold
            <Tooltip text="POS earnings from today. Available tomorrow at 10:30 AM." />
          </span>
          <strong className="text-warning">– ₹{parseFloat(settlement_hold).toFixed(2)}</strong>
        </div>
      )}

      <div className="balance-row available">
        <span>Available Balance</span>
        <strong className="text-success">₹{parseFloat(available_balance).toFixed(2)}</strong>
      </div>
    </div>
  );
}
```

---

## 8. Settlement Type in User Edit (Admin)

When an admin edits a user, they can set `settlement_type` to either:

- `"today_settlement"` — earnings available immediately
- `"next_day_settlement"` — earnings held until next day 10:30 AM IST

This is set via the user edit API (PUT `/api/merchant/:id` or equivalent). Changing it only affects **future** POS transactions — existing holds are not affected.

---

## 9. Summary of Fields to Use

| Use Case | Field |
|---|---|
| Show total wallet balance | `wallet` |
| Show how much is frozen | `settlement_hold` |
| Show spendable balance | `available_balance` |
| Enable/disable payout button | `available_balance >= requiredAmount` |
| Decide if feature is active for user | `settlement_type === "next_day_settlement"` |
