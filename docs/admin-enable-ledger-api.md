# Admin: Enable Ledger Tracking for a User

This document describes the API endpoint that allows an admin to enable ledger tracking for a specific user.

## Overview

Every user has a `start_ledger` flag (default `false`). When it is `false`, **no ledger entries are recorded** for that user, regardless of wallet activity. Once an admin sets it to `true`, all subsequent wallet transactions for that user are recorded in the ledger table.

> **Important:** This is a one-way operation. There is intentionally **no API to disable** ledger tracking once it is enabled.

---

## Endpoint

| Property | Value |
|---|---|
| Method | `PUT` |
| URL | `/api/user/:id/enable-ledger` |
| Auth | Bearer token — **admin only** |
| Content-Type | Not required (no request body) |

---

## URL Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | integer | Yes | ID of the user whose ledger tracking should be enabled |

---

## Request Body

None required.

### Example

```http
PUT /api/user/42/enable-ledger
Authorization: Bearer <admin_token>
```

---

## Responses

### `200 OK` — Successfully enabled

```json
{
  "success": true,
  "message": "Ledger tracking enabled successfully",
  "id": 42,
  "start_ledger": true
}
```

### `200 OK` — Already enabled (idempotent)

```json
{
  "success": true,
  "message": "Ledger tracking is already enabled for this user",
  "id": 42,
  "start_ledger": true
}
```

### `403 Forbidden` — Non-admin caller

```json
{
  "message": "Only admins can enable ledger tracking"
}
```

### `404 Not Found` — User does not exist

```json
{
  "message": "User not found"
}
```

---

## Behaviour Details

- The endpoint is **idempotent** — calling it on a user who already has `start_ledger: true` returns `200` without making any DB change.
- Once enabled, every call to `createLedgerEntry` internally checks `start_ledger`. If `false`, the entry is silently skipped and `null` is returned — no error is thrown.
- Wallet balance (`user.wallet`) is only synced from ledger entries when they are actually written, so toggling this flag does **not** retroactively create or delete historical ledger rows.

---

## UI Guidelines

1. When the admin opens a user detail page, read `start_ledger` from the response.

2. **If `start_ledger` is `true`:**
   - Show a read-only badge `"Ledger: Active"` (green).
   - **Do not render any button** — ledger tracking is already on and cannot be turned off.

3. **If `start_ledger` is `false`:**
   - Show a read-only badge `"Ledger: Inactive"` (grey).
   - Show an **"Enable Ledger"** button next to the badge.
   - On button click, call:
     ```
     PUT /api/user/{userId}/enable-ledger
     ```
   - On success:
     - Show a success toast: *"Ledger tracking enabled for this user."*
     - Switch the badge to `"Ledger: Active"` (green).
     - **Remove the button** from the UI.

4. Do **not** show a "Disable Ledger" button — there is no such endpoint.

---

## Fetching `start_ledger` Status

The `start_ledger` field is returned as part of the standard user detail responses:

```http
GET /api/user/:id
Authorization: Bearer <admin_token>
```

```json
{
  "id": 42,
  "name": "John Doe",
  "role": "merchant",
  "start_ledger": false,
  ...
}
```

Use this to pre-populate the badge/button state when the admin opens the user detail page.

---

## Roles

| Role | Can call this endpoint |
|---|---|
| admin | ✅ Yes |
| franchaise | ❌ No |
| merchant | ❌ No |
