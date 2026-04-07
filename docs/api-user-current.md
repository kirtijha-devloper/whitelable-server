# GET /api/user/current — Current User Profile (Wallet Balance)

Returns the authenticated user's profile along with live wallet and available balance.

## Request

```
GET /api/user/current
Authorization: Bearer <token>
```

No query parameters.

---

## Success Response (200)

```json
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
  "wallet": "5000.00",
  "available_balance": 3000.00,
  "tpin_set": true,
  "ipay_outlet_id": null,
  "is_payout_enabled": true
}
```

### Response Field Descriptions

| Field | Type | Description |
|---|---|---|
| `id` | number | Internal user ID |
| `name` | string | User's name (`"NA"` if not set) |
| `email` | string | User's email address |
| `mobile_number` | string | Primary login mobile number |
| `mobile_number_country_code` | string | Country code prefix (e.g. `"+91"`) |
| `role` | string | `merchant`, `franchaise`, or `admin` |
| `abheepay_id` | string | System-generated user ID (e.g. `APM00001`) |
| `is_approved` | boolean | Whether the account is approved |
| `organization_name` | string | Shop/org name (may be `"NA"`) |
| `status` | string | `active`, etc. |
| `is_pos_asigned` | boolean | Whether a POS machine is assigned |
| `wallet` | string decimal | Gross ledger balance (includes any held amounts) |
| `available_balance` | number | Spendable balance = `wallet − unreleased settlement holds` |
| `tpin_set` | boolean | `true` if TPIN is configured |
| `ipay_outlet_id` | string\|null | iPay outlet ID if linked |
| `is_payout_enabled` | boolean | Whether payout is enabled for this user |

> **`wallet_hold` and `settlement_hold` have been removed.**  
> Use `available_balance` as the single source of truth for what the user can spend.  
> If you need the frozen amount: `settlement_hold = wallet − available_balance`.

---

## Balance Logic

```
available_balance = wallet − SUM(SettlementHold WHERE released = false)
```

- For `today_settlement` users: `available_balance === wallet` (no holds ever created)
- For `next_day_settlement` users: POS earnings are held until **10:30 AM IST the next day**, then released automatically

---

## Error Responses

- `401 Unauthorized`: Missing/invalid token.
- `404 Not Found`: Token is valid but the user record was not found (treat as expired session).
