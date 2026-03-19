# Franchise: Get POS Charge Rules (Admin-Provided)

## Endpoint

`GET /api/pos-charge-rules/list/admin`

## Authentication

- Requires **Bearer JWT** in the `Authorization` header.

Example:

```http
Authorization: Bearer <token>
```

## Who can call this?

- Only **franchise users** (role: `franchaise` / `franchise`) can call this endpoint.
- Any other role will receive **403 Forbidden**.

## Purpose

This endpoint returns the **admin-provided POS charge rule set** that applies to the franchise, including:

- Global defaults (`scope: admin_default`)
- Admin rules targeted at the franchise (`scope: admin_franchise`)

These are read-only for the franchise (franchise cannot edit them).

---

## Query Parameters (optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `payment_mode` | string | e.g. `CARD`, `UPI` |
| `card_type` | string | e.g. `CREDIT`, `DEBIT` |
| `card_brand` | string | e.g. `VISA`, `MASTERCARD` |
| `card_classification` | string | (optional) |
| `settlement_type` | string | (optional) |
| `is_active` | `true` / `false` | filter active/inactive rules |
| `page` | number | default `1` |
| `limit` | number | default `20` |

---

## Example Response (200)

```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "user_id": null,
      "franchaise_id": 42,
      "created_by": 1,
      "scope": "admin_franchise",
      "payment_mode": "CARD",
      "card_type": "CREDIT",
      "card_brand": "VISA",
      "card_classification": null,
      "settlement_type": null,
      "min_amount": "0.00",
      "max_amount": null,
      "charge_percent": "2.50",
      "charge_flat": "0.00",
      "gst_required": true,
      "gst_percent": "18.00",
      "is_active": true,
      "createdAt": "2025-07-06T12:34:56.000Z",
      "updatedAt": "2025-07-06T12:34:56.000Z"
    }
  ],
  "pagination": {
    "total": 28,
    "page": 1,
    "limit": 20,
    "totalPages": 2
  }
}
```

---

## Frontend usage example

```js
const token = /* stored JWT */;

async function fetchAdminRules({ page = 1, limit = 20, filters = {} } = {}) {
  const params = new URLSearchParams({ page, limit, ...filters });
  const res = await fetch(`/api/pos-charge-rules/list/admin?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error(body.message || "Failed to load rules");
  return body;
}

// Usage
fetchAdminRules({ page: 1, limit: 50, filters: { payment_mode: "CARD", is_active: "true" } })
  .then((result) => {
    console.log("Rules:", result.data);
    console.log("Pagination:", result.pagination);
  })
  .catch(console.error);
```

---

## Notes

- This endpoint is intended for franchise UI display only.
- If you want franchise-owned rules (editable by franchise), use:
  - `GET /api/pos-charge-rules/list/franchise`
