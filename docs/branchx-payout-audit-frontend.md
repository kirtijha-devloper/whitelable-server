# BranchX Payout Audit Logs — Frontend Implementation Guide

> Base URL: **`/api/payment/v2`**
> All endpoints require a valid JWT in the `Authorization: Bearer <token>` header.
> This route is admin-only.

---

## Overview

This endpoint allows admin users to retrieve BranchX payout audit activity grouped by `payout_id`.
The default date range is today, and the frontend may optionally send `fromDate` and `toDate` to widen the window.

The response is grouped by payout transaction and sorted by `created_at` within each group.
The frontend should display the audit stream and include the associated `request_id` when available.

---

## Route

**GET** `/api/payment/v2/payout/audit-logs`

### Query parameters

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `fromDate` | string | No | today 00:00 | Format: `YYYY-MM-DD` or any parseable ISO date |
| `toDate` | string | No | today 23:59 | Format: `YYYY-MM-DD` or any parseable ISO date |

### Headers

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <jwt>` |

### Security

- Only admin users may call this route.
- Non-admin callers receive `403`.

---

## Response

### Success response `200`

```json
{
  "success": true,
  "message": "Payout audit logs retrieved successfully",
  "fromDate": "2026-04-26",
  "toDate": "2026-04-26",
  "totalGroups": 2,
  "data": [
    {
      "payout_id": 123,
      "logs": [
        {
          "id": 1,
          "payout_id": 123,
          "action": "BRANCHX_STATUS_CHECK",
          "details": {
            "requestedBy": 1,
            "requestedRole": "admin",
            "from": "PENDING",
            "to": "SUCCESS",
            "responseStatus": "SUCCESS",
            "rawStatus": "SUCCESS",
            "statusCode": "200",
            "branchxResponse": {
              "data": {
                "status": "SUCCESS",
                "requestId": "REQ-123"
              }
            }
          },
          "request_id": "REQ-123",
          "created_at": "2026-04-26T10:00:00.000Z",
          "updated_at": "2026-04-26T10:00:00.000Z"
        },
        {
          "id": 2,
          "payout_id": 123,
          "action": "BRANCHX_STATUS_CHECK_FAILED",
          "details": {
            "requestedBy": 1,
            "requestedRole": "merchant",
            "from": "PENDING",
            "to": "FAILED",
            "responseStatus": "FAILED",
            "rawStatus": "FAILED",
            "statusCode": "200",
            "branchxResponse": {
              "data": {
                "status": "FAILED",
                "requestId": "REQ-123"
              }
            }
          },
          "request_id": "REQ-123",
          "created_at": "2026-04-26T10:05:00.000Z",
          "updated_at": "2026-04-26T10:05:00.000Z"
        }
      ]
    },
    {
      "payout_id": 456,
      "logs": [
        {
          "id": 3,
          "payout_id": 456,
          "action": "BRANCHX_STATUS_CHECK",
          "details": {
            "requestedBy": 1,
            "requestedRole": "admin",
            "responseStatus": "PENDING",
            "rawStatus": "PENDING",
            "branchxResponse": {
              "data": {
                "status": "PENDING",
                "requestId": "REQ-456"
              }
            }
          },
          "request_id": "REQ-456",
          "created_at": "2026-04-26T11:00:00.000Z",
          "updated_at": "2026-04-26T11:00:00.000Z"
        }
      ]
    }
  ]
}
```

### Notes

- `payout_id` groups logs by the related payout transaction.
- `request_id` is extracted from audit record details when available.
- `logs` are ordered by `created_at` ascending.
- If an audit entry does not include a `payout_id`, it is grouped under `null`.

---

## Frontend behavior

### 1. Default date range

- If the admin does not provide dates, call the API without query params.
- The backend defaults to today's start/end.
- For UX, show a date filter defaulted to today.

### 2. Querying the endpoint

Example:

```js
const response = await fetch('/api/payment/v2/payout/audit-logs?fromDate=2026-04-26&toDate=2026-04-26', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
const result = await response.json();
```

### 3. Display logic

Render each `payout_id` group as a transaction block:

- Group header: `Payout ID: 123`
- Optional: display `request_id` from the first log entry in the group
- Timeline list of audit entries, showing:
  - `action`
  - `created_at`
  - extracted `request_id`
  - important fields from `details` such as `from`, `to`, `responseStatus`, and `reason`

### 4. Missing `request_id`

If `request_id` is absent in the audit details, fallback to:
- `details.requestId`
- `details.request_id`
- `details.reference_id`
- `details.branchxResponse.data.requestId`

If none are present, show `Request ID: Not available`.

---

## Error handling

| Status | Frontend behavior |
|-------|--------------------|
| `403` | show "Admin access required" or hide this screen for non-admin users |
| `400` | show validation error, likely malformed dates |
| `500` | show generic backend failure message and allow retry |

---

## Implementation checklist

- [ ] Add an admin-only menu item for "Payout Audit Logs"
- [ ] Pre-fill the date filter with today
- [ ] Call `GET /api/payment/v2/payout/audit-logs`
- [ ] Group results by `payout_id`
- [ ] Display `request_id` and audit action timeline per group
- [ ] Handle `403`, `400`, and `500` responses gracefully
- [ ] Support optional `fromDate` / `toDate` filter updates
