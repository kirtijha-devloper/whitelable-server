# Vimo Payout Admin Fail (Frontend)

This document describes how the admin frontend should mark a stuck Vimo payout as failed.

## Overview

- Endpoint is JWT-protected.
- Only admin or authorized employee users can perform this action.
- The backend only allows the action when the payout:
  - belongs to provider `Vimo`
  - is currently in `Processing`
  - has been in that state for more than 10 minutes
- On success, the backend marks the payout as `FAILED` and refunds `amount + service_charge` back to the merchant wallet.

---

## Endpoint

- `POST /api/vimo/payout/admin/fail`

### Headers

- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

---

## Request Body

Send any one of the following keys. All three map to the same backend lookup value:

- `reference_id`
- `merchantRefId`
- `referenceId`

### Recommended payload

```json
{
  "reference_id": "APPV00000001"
}
```

### Also accepted

```json
{
  "merchantRefId": "APPV00000001"
}
```

```json
{
  "referenceId": "APPV00000001"
}
```

Use the payout reference already shown in the admin payout table or payout details drawer.

---

## Success Response

### `200 OK`

```json
{
  "success": true,
  "message": "Vimo payout marked failed and refund processed",
  "reference_id": "APPV00000001",
  "refundAmount": 1010
}
```

### Meaning

- payout status has been updated to `FAILED`
- callback-related fields were also updated internally
- refund has already been processed by the backend
- `refundAmount = amount + service_charge`

---

## Error Responses

### `400 Bad Request` - reference missing

```json
{
  "success": false,
  "message": "reference_id or merchantRefId is required"
}
```

Frontend action:
- do not send request without a payout reference
- if this appears, show a generic validation error and log the payload sent

### `400 Bad Request` - payout not old enough

```json
{
  "success": false,
  "message": "Payout has not been processing for more than 10 minutes"
}
```

Frontend action:
- keep the row in `Processing`
- show message like `This payout can only be failed after 10 minutes in Processing state`

### `403 Forbidden`

```json
{
  "success": false,
  "message": "Admin access required"
}
```

Frontend action:
- hide or disable this action for non-admin users
- if returned anyway, show an authorization error

### `404 Not Found`

```json
{
  "success": false,
  "message": "No Vimo processing payout found for the given reference"
}
```

Possible reasons:
- wrong reference
- payout is not a Vimo payout
- payout already moved out of `Processing`

Frontend action:
- refresh the payout list/details
- show the latest status from the server

### `409 Conflict`

```json
{
  "success": false,
  "message": "Payout is not in Processing state (current=SUCCESS)"
}
```

The actual `current=...` value depends on the latest row state.

Frontend action:
- treat this as stale UI data
- refresh the row and replace the visible status

### `500` or other server errors

```json
{
  "success": false,
  "message": "<server message>"
}
```

Frontend action:
- show a generic failure toast
- do not assume refund happened unless the request returned `success: true`

---

## Recommended UI Behavior

## Where to show the action

Show `Mark Failed` only in the admin payout management UI, for example:

- payout list row action menu
- payout details side panel
- stuck payout resolution screen

## When to enable the action

Enable only when all local conditions are true:

- logged-in user is admin
- payout provider is `Vimo`
- payout status is `Processing`
- payout age is more than 10 minutes

If the frontend cannot reliably compute payout age, it can still show the action for `Processing` rows and let the backend enforce the 10-minute rule.

## Confirmation modal

Use a confirmation modal before calling the API.

Suggested modal copy:

- Title: `Mark Vimo payout as failed?`
- Body: `This will mark the payout as FAILED and refund the payout amount plus service charge to the merchant wallet.`
- Primary button: `Mark Failed`
- Secondary button: `Cancel`

---

## Recommended Frontend Flow

1. Admin opens payout list or payout detail view.
2. Frontend checks row eligibility.
3. Admin clicks `Mark Failed`.
4. Frontend opens confirmation modal.
5. On confirm, call `POST /api/vimo/payout/admin/fail`.
6. On `200`, show success toast with refund amount.
7. Refresh:
   - payout list
   - payout detail panel
   - merchant wallet/ledger widgets if visible in the same screen

---

## Suggested API Helper

```javascript
export async function markVimoPayoutFailed(referenceId, token) {
  const response = await fetch('/api/vimo/payout/admin/fail', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ reference_id: referenceId })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to mark payout as failed');
  }

  return data;
}
```

---

## Suggested Success Handling

- update row status to `FAILED`
- remove the `Mark Failed` action from that row
- show toast:

```text
Vimo payout marked failed. Refund processed: Rs. 1010
```

Use the actual `refundAmount` from the API response.

---

## Suggested Failure Handling Map

| HTTP | Backend message | UI handling |
|------|------------------|-------------|
| `400` | `reference_id or merchantRefId is required` | Validation error |
| `400` | `Payout has not been processing for more than 10 minutes` | Inform user and keep row unchanged |
| `403` | `Admin access required` | Hide action and show unauthorized message |
| `404` | `No Vimo processing payout found for the given reference` | Refresh row/list |
| `409` | `Payout is not in Processing state (current=...)` | Refresh row/list as stale data |
| `500` | any | Generic error toast |

---

## Notes

- The backend already prevents duplicate refunding by checking for an existing `payout_refund` ledger entry before creating one.
- Frontend should not try to calculate the refund amount itself for display after the action. Use `refundAmount` from the API response.
- This action is for admin operations only. Merchant and franchise payout screens should not expose it.