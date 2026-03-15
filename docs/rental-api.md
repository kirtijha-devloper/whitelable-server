# Rental API (Frontend Reference)

This document describes the endpoints for the Rental feature. Rentals are records that associate a fixed amount with a merchant (and optionally a franchise). These endpoints are all protected and require an authenticated user token.

---

## Base path

```
/api/rental
```

All requests must include:
- `Authorization: Bearer <token>`

---

## 1) Create Rental

**POST** `/api/rental`

### Body (JSON)
```json
{
  "merchant_id": 123,
  "franchaise_id": 45,      // optional
  "amount": 99.99,
  "status": "active",     // optional (defaults to "active")
  "type": "pos",          // optional (defaults to "pos")
  "is_default": false      // optional
}
```

### Success response
```json
{
  "success": true,
  "message": "Rental created successfully",
  "data": { /* rental object */ }
}
```

---

## 2) List Rentals (with filters + pagination)

**GET** `/api/rental/list`

### Query parameters
- `merchant_id` (optional)
- `franchaise_id` (optional)
- `status` (optional)
- `type` (optional)
- `is_default` (optional: `true` or `false`)
- `page` (optional, default `1`)
- `limit` (optional, default `10`)

### Success response
```json
{
  "success": true,
  "message": "Rentals retrieved successfully",
  "data": [ /* rental objects */ ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

---

## 3) Get Rental by ID

**GET** `/api/rental/:id`

### Success response
```json
{
  "success": true,
  "data": { /* rental object */ }
}
```

---

## 4) Update Rental

**PUT** `/api/rental/:id`

### Body (JSON)
- Send only the fields you want to update.

Example:
```json
{
  "amount": 120.00,
  "status": "active",
  "is_default": true
}
```

---

## 5) Delete Rental

**DELETE** `/api/rental/:id`

### Success response
```json
{
  "success": true,
  "message": "Rental deleted successfully"
}
```
