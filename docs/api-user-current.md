# GET /api/user/current — Current User Profile (Wallet Balance)

Returns the authenticated user's profile along with live wallet balance (used for navbar display).

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
  "wallet": "1470.00",
  "wallet_hold": "0.00",
  "tpin_set": true
}
```

### Response Field Descriptions

- `id`: Internal user ID.
- `name`: User's name (defaults to `"NA"` if not set).
- `email`: User's email address.
- `mobile_number`: Primary login mobile number.
- `mobile_number_country_code`: Country code prefix (e.g., `+91`).
- `role`: User role (`merchant`, `franchaise`, or `admin`).
- `abheepay_id`: System-generated ID/username (e.g. `APM00001`).
- `is_approved`: Whether the account is approved.
- `organization_name`: Organization/shop name (may be `"NA"`).
- `status`: User status (`active`, etc.).
- `is_pos_asigned`: Indicates whether a POS machine is assigned.
- `wallet`: Current spendable balance (string decimal).
- `wallet_hold`: Amount currently on hold (string decimal).
- `tpin_set`: `true` if a TPIN is configured for the user.

---

## Error Responses

- `401 Unauthorized`: Missing/invalid token.
- `404 Not Found`: Token is valid but the user record was not found (treat as expired session).
