# POS Global Rate API

This document describes the two endpoints the frontend can use to manage and read the global POS rate.  
All paths are relative to `/api/pos-charge` and require a valid JWT in the `Authorization: Bearer <token>` header.

---

## Endpoints

### `POST /global-rate`  
**Purpose:** create or update the single global fallback rate (upsert).

- **Role:** admin only (403 returned for others)
- **Body (JSON):**
  ```json
  {
    "percent_fee": 1.25,
    "is_active": true      // optional, defaults to true
  }
  ```
  `percent_fee` is required and must be a non-negative number.
- **Responses:**
  - `201` – created (first time)
  - `200` – updated (existing row)
  - Response body includes `{ message, record }` where `record` is the updated row.

### `GET /global-rate`  
**Purpose:** fetch the current global rate record.

- **Role:** any authenticated user
- **Query:** none
- **Responses:**
  - `200` – returns the record
    ```json
    {
      "id": 1,
      "percent_fee": "1.25",
      "is_active": true,
      "updated_by": 5,
      "createdAt": "2026-02-21T...",
      "updatedAt": "2026-02-21T..."
    }
    ```
  - `404` – no global rate configured yet

---

## Notes for Front‑end

- The backend worker uses this value **only** when no user-specific or combination-based POS charge is found.
- Only one row exists; POST upserts the row with `id=1`.
- Handle `403` for POST (non-admin) and `404` for GET gracefully in the UI.
- Use `percent_fee` directly for display or calculation (string decimal).

---

### Fetch example
```js
const r = await fetch('/api/pos-charge/global-rate', {
  headers: { Authorization: `Bearer ${token}` }
});
if (r.ok) {
  const rate = await r.json();
  console.log('global rate', rate.percent_fee);
}
```

### Update example
```js
await fetch('/api/pos-charge/global-rate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ percent_fee: 1.5 })
});
```
