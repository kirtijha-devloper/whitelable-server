# POS Machine Assignment — Frontend Migration Guide

## Overview

The POS machine table previously used **two separate columns** to track who a machine was assigned to:

| Old Column | Used For |
|---|---|
| `franchaise_id` | Assigned to a franchise user |
| `assigned_user_id` | Assigned to a merchant user |

These have been **consolidated into a single column**:

| New Column | Used For |
|---|---|
| `assigned_to` | Assigned to any user (franchise or merchant) |

The user's `role` field (present in the `assigned_user` object in API responses) tells you whether the machine is assigned to a franchise or a merchant.

---

## API Response Changes

### GET `/api/pos-machines` and GET `/api/pos-machines/:id`

Each POS machine object in the response has changed:

**Before:**
```json
{
  "id": 5,
  "tid_number": "TID001",
  "mid_number": "MID001",
  "status": "active",
  "franchaise_id": 12,
  "assigned_user_id": null,
  "franchaise_detail": { "id": 12, "name": "ABC Franchise" }
}
```

**After:**
```json
{
  "id": 5,
  "tid_number": "TID001",
  "mid_number": "MID001",
  "status": "active",
  "assigned_to": 12,
  "assigned_user": {
    "id": 12,
    "name": "ABC Franchise",
    "email": "abc@franchise.com",
    "role": "franchaise"
  }
}
```

**Key changes:**
- Remove reads of `franchaise_id` — use `assigned_to` instead
- Remove reads of `assigned_user_id` — use `assigned_to` instead
- Remove reads of `franchaise_detail` — use `assigned_user` instead
- Use `assigned_user.role` to determine whether the machine is assigned to a franchise (`"franchaise"`) or merchant (`"merchant"`)
- `assigned_to` and `assigned_user` are `null` when the machine is unassigned

---

## Request Body Changes

### POST/PUT — Assign POS machine

Any request body that previously sent `franchaise_id` or `assigned_user_id` to indicate assignment must now send `assigned_to`.

**Before:**
```json
{ "franchaise_id": 12 }
// or
{ "assigned_user_id": 7 }
```

**After:**
```json
{ "assigned_to": 12 }
// or
{ "assigned_to": 7 }
```

---

## Assignment Endpoints

### Assign machine(s) to any user (admin only)

```
POST /api/pos-machines/assign
Body: { "ids": [1, 2, 3], "user_id": 12 }
```

Works for both franchise and merchant users. The `user_id` is the target user's ID regardless of their role.

### Assign machine to a specific merchant (admin / franchise)

```
POST /api/pos-machines/assign-to-merchant
Body: { "id": 5, "user_id": 7 }
```

Franchise users can only assign machines that are currently `assigned_to` themselves, to merchants who belong to their franchise.

---

## User List — POS Machine Count

The user list endpoint (e.g. `GET /api/users`) returns a `pos_machine_count` field per user (where applicable). This count is now derived from the unified `assigned_to` column — no change to the response shape, but the logic is now consistent across franchise and merchant roles.

---

## Unassign Flow

When a machine is unassigned:
- `assigned_to` is set to `null`
- `assigned_user` in the response will be `null`

Previously you may have checked `franchaise_id === null && assigned_user_id === null` — replace this with simply `assigned_to === null`.

---

## Checklist for Frontend Teams

- [ ] Replace all reads of `franchaise_id` on POS machine objects with `assigned_to`
- [ ] Replace all reads of `assigned_user_id` on POS machine objects with `assigned_to`
- [ ] Replace all reads of `franchaise_detail` with `assigned_user`
- [ ] Use `assigned_user.role` to determine assignment type (franchise vs merchant)
- [ ] Update any "unassigned" checks from dual-null check to `assigned_to === null`
- [ ] Update any request payloads that send `franchaise_id` or `assigned_user_id` to use `assigned_to`
- [ ] Update any forms or dropdowns that submit separate franchise/merchant assignment fields to use a single user ID field
