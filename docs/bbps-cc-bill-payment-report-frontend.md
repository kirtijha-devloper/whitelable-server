# Frontend Integration: BBPS CC Bill Payment Report

This document describes how to call and consume the CC bill payment report endpoint in the frontend.

## Endpoint

`GET /api/report/bbps`

- Auth: `Bearer <token>` (all routes require authentication)
- Purpose: fetch BBPS Credit Card bill payments from Ledger (`transaction_type = 'bbps_payment'`).

## Query parameters

- `user_id` (number) - optional, admin can pass to filter specific user.
- `start_date` (string, YYYY-MM-DD) - optional.
- `end_date` (string, YYYY-MM-DD) - optional.

Example (with filters):

```
GET /api/report/bbps?user_id=123&start_date=2026-01-01&end_date=2026-01-31
Authorization: Bearer <token>
```

## Sample response

```json
{
  "success": true,
  "message": "BBPS report fetched successfully",
  "data": [
    {
      "id": 1001,
      "user_id": 123,
      "transaction_type": "bbps_payment",
      "transaction_id": "APBBPS20261234567890",
      "reference_id": 987,
      "reference_table": "BillAvenuePayments",
      "description": "BBPS CC bill payment — biller: HDFC_CC_001, mobile: 9876543210",
      "debit": 1500.00,
      "credit": 0.00,
      "balance_before": 5000.00,
      "balance_after": 3500.00,
      "status": "completed",
      "metadata": { "biller_id": "HDFC_CC_001", "customer_mobile": "9876543210" },
      "created_at": "2026-03-29T08:12:34.000Z",
      "updated_at": "2026-03-29T08:12:35.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

> Note: Some backend responses may not include pagination for `/report/bbps`; adapt for `data` array only if applicable.

## Frontend behavior

1. Show loader while fetching.
2. Request with valid auth header.
3. Handle 200:
   - populate table with `data`
   - display `balance_before`, `debit`, `balance_after`, `status`
4. Handle 401/403:
   - redirect to login/unauthorized
5. Handle 500:
   - show error notification

## Search/filters in UI

- Date range picker -> controls `start_date`, `end_date`
- User selector (admin) -> controls `user_id`
- Optional status filter (client-side after fetch)

## Notes

- `service=CC Bill Payment` is not accepted by this route; use `/api/report/bbps`.
- To include multiple transaction categories, use `/api/report/all-transactions`.
