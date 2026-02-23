# Razorpay Notification Report Endpoint

This document describes the `GET /report/razorpay` route used to fetch user-wise Razorpay notification reports.

## Base URL
```
/report/razorpay
```
> The router is mounted at `/report` in `server.js`.

## Authentication
All routes are protected by `validateToken` middleware.

**Header**:
```
Authorization: Bearer <jwt-token>
```

## Query Parameters
| Name           | Type    | Required?     | Description |
|----------------|---------|---------------|-------------|
| `user_id`      | string  | conditional   | Target user. Admins must supply to filter by user; ignored for merchants. Franchises can supply to scope or omit to include self+merchants. Admins may omit to see all linked rows. Use `include_unlinked=true` to also show rows with no user. |
| `start_date`   | string  | optional      | Start of date range, ISO format (`YYYY-MM-DD`). Defaults to today. |
| `end_date`     | string  | optional      | End of date range, ISO format. Defaults to today (23:59:59). |
| `status`       | string  | optional      | Filter by transaction status (e.g. `CAPTURED`, `FAILED`). |
| `payment_mode` | string  | optional      | Filter by mode (`CARD`, `UPI`, etc). |
| `include_unlinked` | string (`'true'`) | admin only  | Include records where `user_id` is null. |
| `page`         | number  | optional      | Page number (default 1). |
| `limit`        | number  | optional      | Page size (default 50, max 200). |

## Response (200 OK)
```json
{
  "success": true,
  "message": "Razorpay notification report fetched successfully",
  "count": 123,
  "pagination": { "total": 123, "page": 1, "limit": 50, "totalPages": 3 },
  "date_range": { "from": "2026-02-23T00:00:00.000Z", "to": "2026-02-23T23:59:59.999Z" },
  "data": [
    {
      "id": 1,
      "txn_id": "...",
      "mid": "...",
      "tid": "...",
      "amount": 5000,
      "currency_code": "INR",
      "payment_mode": "CARD",
      "payment_card_type": "VISA",
      "payment_card_brand": "VISA",
      "rr_number": "...",
      "device_serial": "...",
      "posting_date": "2026-02-22T14:33:20.000Z",
      "status": "CAPTURED",
      "user_id": 123,
      "pos_machine_id": 456,
      "user": {"id":123,"name":"..."},
      "pos_machine": {"id":456,"mid_number":"..."},
      "created_at": "2026-02-22T14:34:00.000Z"
    }
    // ... more items
  ]
}
```

## Errors
- `400 Bad Request` – invalid dates or `start_date` > `end_date`.
- `401 Unauthorized` – missing/invalid token.
- `403 Forbidden` – franchise tries to access user outside their scope.
- `500 Internal Server Error` – server failure.

---

Use this document in Postman, Swagger, or share with front-end developers for integration.