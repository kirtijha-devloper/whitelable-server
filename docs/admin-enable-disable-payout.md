# Admin: Enable/Disable Payout for Users

This document describes how the frontend can call the API to enable or disable per-user payout permissions. This ability allows admin to control who can initiate payout operations.

## Endpoint

- Method: `PUT`
- URL: `/api/user/:id/status`
- (Legacy) `/api/merchant/:id/status` and `/api/franchaise/:id/status` are still supported for backward compatibility.
- Auth: Bearer token (admin / franchise for own merchants)

## Request body

You can toggle any or both of these fields:

- `status`: `"active"` / `"inactive"` - existing account status
- `is_payout_enabled`: `true` / `false`

### Example (disable payout)

```http
PUT /api/merchant/123/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "is_payout_enabled": false
}
```

### Example (enable payout)

```http
PUT /api/merchant/123/status
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "is_payout_enabled": true
}
```

## Response

### Success (`200`)

```json
{
  "message": "User updated",
  "id": 123,
  "status": "active",
  "is_payout_enabled": false
}
```

### Errors

- `400` if neither `status` nor `is_payout_enabled` is present.
- `403` for unauthorized user role.
- `404` if user not found.

## UI guidelines

- Show a toggle (`Enable Payout`) on merchant/franchise user admin page.
- Call this endpoint when toggle changes.
- Display success or error toast based on response.
- Re-fetch user details after success to sync UI state.

## Roles

Payout permission is applicable only for:
- `merchant`
- `franchaise`

Admin users can enable/disable it, but cannot use the payout API path as merchant/franchise.
