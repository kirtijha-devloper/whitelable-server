# Rental Rate Management — Frontend Implementation Guide

All endpoints require `Authorization: Bearer <token>`.  
Base path: `/api/rental`

---

## Rate Scopes

| Who creates | `franchaise_id` | `target_user_type` | Who gets charged |
|---|---|---|---|
| Admin | `null` | `"franchise"` | All franchises |
| Admin | `null` | `"merchant"` | All standalone merchants (not under any franchise) |
| Franchise | `<their own user ID>` | `"merchant"` | All merchants under that franchise |

Only **one active rate** is allowed per `(franchaise_id, target_user_type)` pair. If a rate already exists, update it instead of creating a new one.

---

## Endpoints

### 1. Create Rental Rate

**POST** `/api/rental`

#### Admin — create rate for franchises
```json
{
  "amount": 500,
  "target_user_type": "franchise",
  "type": "pos",
  "status": "active"
}
```

#### Admin — create rate for standalone merchants
```json
{
  "amount": 300,
  "target_user_type": "merchant",
  "type": "pos",
  "status": "active"
}
```

#### Franchise — create rate for their merchants
> `target_user_type` is **not required** — always defaults to `"merchant"` server-side.
```json
{
  "amount": 350,
  "type": "pos",
  "status": "active"
}
```

#### Success `201`
```json
{
  "success": true,
  "message": "Rental rate created successfully",
  "data": {
    "id": 1,
    "franchaise_id": null,
    "target_user_type": "franchise",
    "amount": "500.00",
    "status": "active",
    "type": "pos",
    "created_by": 42,
    "createdAt": "2026-03-30T10:00:00.000Z",
    "updatedAt": "2026-03-30T10:00:00.000Z"
  }
}
```

#### Error — rate already exists `400`
```json
{
  "success": false,
  "message": "A admin rate for franchises already exists. Update the existing one."
}
```

#### Error — missing `target_user_type` (admin only) `400`
```json
{
  "success": false,
  "message": "target_user_type is required for admin (\"franchise\" or \"merchant\")"
}
```

---

### 2. List Rental Rates

**GET** `/api/rental/list`

**Admin** — sees all rates (all scopes, all franchises).  
**Franchise** — sees only their own rate.  
**Merchant** — `403 Access denied`.

#### Query Parameters
| Param | Type | Description |
|---|---|---|
| `status` | string | Filter by `active` / `inactive` |
| `type` | string | Filter by type (e.g. `pos`) |
| `page` | number | Page number (default `1`) |
| `limit` | number | Items per page (default `10`) |

#### Example request
```
GET /api/rental/list?status=active&page=1&limit=10
```

#### Success `200`
```json
{
  "success": true,
  "message": "Rentals retrieved successfully",
  "data": [
    {
      "id": 1,
      "franchaise_id": null,
      "target_user_type": "franchise",
      "amount": "500.00",
      "status": "active",
      "type": "pos",
      "created_by": 42,
      "createdAt": "2026-03-30T10:00:00.000Z",
      "updatedAt": "2026-03-30T10:00:00.000Z"
    },
    {
      "id": 2,
      "franchaise_id": null,
      "target_user_type": "merchant",
      "amount": "300.00",
      "status": "active",
      "type": "pos",
      "created_by": 42,
      "createdAt": "2026-03-30T10:00:00.000Z",
      "updatedAt": "2026-03-30T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 2,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

### 3. Get Rental Rate by ID

**GET** `/api/rental/:id`

**Franchise** — can only retrieve their own rate (returns `403` for others).  
**Merchant** — `403 Access denied`.

#### Success `200`
```json
{
  "success": true,
  "data": {
    "id": 1,
    "franchaise_id": null,
    "target_user_type": "franchise",
    "amount": "500.00",
    "status": "active",
    "type": "pos",
    "created_by": 42,
    "createdAt": "2026-03-30T10:00:00.000Z",
    "updatedAt": "2026-03-30T10:00:00.000Z"
  }
}
```

#### Not found `404`
```json
{ "success": false, "message": "Rental not found" }
```

---

### 4. Update Rental Rate

**PUT** `/api/rental/:id`

Only `amount`, `status`, and `type` can be updated. `target_user_type` and `franchaise_id` are immutable after creation.

**Franchise** — can only update their own rate record.

#### Request body (send only fields to change)
```json
{
  "amount": 450,
  "status": "active"
}
```

#### Success `200`
```json
{
  "success": true,
  "message": "Rental rate updated successfully",
  "data": { /* updated rate object */ }
}
```

---

### 5. Delete Rental Rate

**DELETE** `/api/rental/:id`

**Franchise** — can only delete their own rate.

#### Success `200`
```json
{
  "success": true,
  "message": "Rental rate deleted successfully"
}
```

---

## Frontend UX Flows

### Admin — Rental Rate Settings Page

The admin panel should show **two independent cards/rows**, one per `target_user_type`:

```
┌──────────────────────────────────────────────────────────┐
│  Rate for Franchises                                      │
│  Charged to all franchise accounts every 30 days         │
│  ₹ [_____]   Status [active ▾]   [Save]  [Delete]       │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Rate for Standalone Merchants                            │
│  Charged to merchants not under any franchise             │
│  ₹ [_____]   Status [active ▾]   [Save]  [Delete]       │
└──────────────────────────────────────────────────────────┘
```

#### Page load logic
1. `GET /api/rental/list?status=active` — look for records with `franchaise_id: null`.
2. Find the record where `target_user_type === "franchise"` → populate the **Franchise Rate** card.
3. Find the record where `target_user_type === "merchant"` → populate the **Merchant Rate** card.
4. If a card has no DB record → show the form empty with a **Create** button.
5. If a card has an existing record → show the current amount with an **Update** / **Delete** button.

#### Save button logic
```js
// pseudocode
if (existingRate) {
  PUT /api/rental/:existingRate.id  { amount, status }
} else {
  POST /api/rental  { amount, status, type: 'pos', target_user_type: 'franchise' | 'merchant' }
}
```

---

### Franchise — Rental Rate Settings Page

The franchise panel shows **one card** (always targets their merchants):

```
┌──────────────────────────────────────────────────────────┐
│  Monthly Rental Rate for Your Merchants                   │
│  All merchants under you are charged this amount          │
│  ₹ [_____]   Status [active ▾]   [Save]  [Delete]       │
└──────────────────────────────────────────────────────────┘
```

#### Page load logic
1. `GET /api/rental/list` (franchise token scopes it automatically).
2. If `data.length > 0` → the first record is the franchise's rate → populate the card.
3. If `data.length === 0` → show empty form with **Create** button.

#### Save button logic
```js
if (existingRate) {
  PUT /api/rental/:existingRate.id  { amount, status }
} else {
  POST /api/rental  { amount, status, type: 'pos' }
  // target_user_type is NOT sent — backend sets it to 'merchant' automatically
}
```

---

## Error Handling

| HTTP status | When | Suggested UI action |
|---|---|---|
| `400` | Rate already exists | Show "Rate already exists — use Update instead" |
| `400` | `amount` ≤ 0 or missing | Inline field validation error |
| `400` | Admin missing `target_user_type` | Inline validation (shouldn't happen if UI is correct) |
| `403` | Franchise accessing another's rate | Show generic "Access denied" toast |
| `404` | Rate not found (race condition / stale ID) | Reload the list |
| `500` | Server error | Show generic error toast, log to console |

---

## Field Reference

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Primary key |
| `franchaise_id` | integer \| null | `null` for admin-defined rates |
| `target_user_type` | `"franchise"` \| `"merchant"` | Who this rate is charged to |
| `amount` | decimal string | e.g. `"500.00"` — parse with `parseFloat()` |
| `status` | `"active"` \| `"inactive"` | Only `active` rates are charged by the cron |
| `type` | string | Always `"pos"` in current use |
| `created_by` | integer | User ID of creator |
| `createdAt` / `updatedAt` | ISO 8601 | Standard timestamps |
