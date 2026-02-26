# Report API Documentation

Endpoints under `/api/report` provide a variety of data exports and lists used by
administrators and franchisees for auditing, reconciliation and monitoring.
All routes require a valid JWT (`Authorization: Bearer <token>`).

---
### GET `/api/report/ledger`
Returns ledger entries stored in the `Ledgers` table. Results are scoped by
role and may be limited to a particular user. Supports optional query param
`user_id` (admin may specify any user; franchisees may only request their own
or merchants under them; merchants may omit or set to their own id).
`start_date` and `end_date` default to today when omitted and are inclusive.

### Query Parameters

| Name | Description |
|------|-------------|
| `user_id` | Optional numeric user id to filter entries (see access rules) |
| `start_date` | ISO date string (YYYY-MM-DD), defaults to today |
| `end_date` | ISO date string (YYYY-MM-DD), defaults to today |

### Access Rules

- **Admin**: may query any user's ledger entries; omit `user_id` for all.
- **Franchise**: may see their own ledger plus merchants belonging to them;
  supplying `user_id` restricts to that merchant (must belong to the
  franchise).
- **Merchant**: only their own ledger entries.
## GET `/api/report/users`

Returns a list of users that can be filtered and paginated. This endpoint is
primarily intended for reporting interfaces but replicates much of the logic
from `/api/user`.

### Query Parameters

| Name   | Description |
|--------|-------------|
| `status` | Filter by user status (`active`, `deactive`, etc.) |
| `role`   | Filter by role (`merchant`, `franchaise`, `admin`) |
| `page`   | Page number (default 1) |
| `limit`  | Page size (default 10) |

### Access Rules

- **Admin**: may query all users and apply any filters.
- **Franchise**: results limited to users whose `franchaise_id` matches the
authenticated user (i.e. the merchant accounts under that franchise).
- **Other roles**: restricted to their own record (safe default).

### Response

```json
{
  "success": true,
  "message": "User report fetched successfully",
  "data": [ /* array of user objects */ ],
  "pagination": { "total", "page", "limit", "totalPages" }
}
```

---

## Other report routes

### GET `/api/report/pos-txn`
Retrieves a POS transaction report. Supports filtering by date range, status,
card holder name, POS transaction number and device number.

### GET `/api/report/wallet`
Returns wallet transaction history for a given user. Query param `userId` is
required; non-admins can only request their own history. Optional `startDate`
and `endDate` may narrow the range.

### GET `/api/report/razorpay`
Provides a Razorpay notification report. Users may filter by date range,
status, payment mode and user ID. Access rules determine which records are
visible:

- `merchant`: only own notifications.
- `franchaise`: own plus merchants belonging to the franchise.
- `admin`: any user; optional `include_unlinked=true` returns notifications that
  lack a linked user.

Pagination parameters `page` and `limit` are supported on all three endpoints.

---

Refer to the comments in `controllers/reportController.js` for detailed column
definitions and behaviour.