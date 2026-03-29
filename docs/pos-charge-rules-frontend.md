# POS Charge Rules — Frontend Documentation

This document is intended for the **frontend team**. It describes the HTTP API
exposed by the MDR (Merchant Discount Rate) rule engine, how the new **scope**
system works, and what each role should see.

All endpoints require a **Bearer token** in the `Authorization` header (same as
every other API).

---

## Key Concept: Scopes

Every charge rule now carries a **`scope`** field that tells you _who created
it and for whom_. This is the single most important field for building the UI
correctly.

| `scope` value | Created by | Applies to | Editable by |
|---|---|---|---|
| `admin_default` | Admin | Everyone (global fallback) | Admin only |
| `admin_franchise` | Admin | A specific franchise and all its merchants | Admin only |
| `admin_merchant` | Admin | A specific non-franchised merchant | Admin only |
| `franchise_default` | Franchise | All merchants under that franchise | That franchise |
| `franchise_merchant` | Franchise | One specific merchant under that franchise | That franchise |

> **You do NOT need to send `scope` when creating a rule.** The backend
> automatically derives it from the caller's role and the `user_id` /
> `franchaise_id` values in the request body. The field is returned in every
> response and can be used for display, grouping, and filtering.

---

## How Charge Resolution Works (background for UI understanding)

When a POS transaction occurs, the system picks a single "best matching" rule
using a **two-level ranking**:

### 1. Scope tier (higher wins)

| Priority | Scope | Meaning |
|:---:|---|---|
| 5 (highest) | `franchise_merchant` | Franchise set a rate for THIS specific merchant |
| 4 | `admin_merchant` | Admin set a rate for a specific non-franchised merchant |
| 3 | `franchise_default` | Franchise's default rate for all its merchants |
| 2 | `admin_franchise` | Admin's rate for the franchise (and its merchants) |
| 1 (lowest) | `admin_default` | Global fallback rate |

### 2. Dimension specificity (tie-breaker within the same scope)

If there are two rules with the same scope, the one that matches more optional
dimensions wins:

| Matched dimension | Points |
|---|:---:|
| `settlement_type` match | +8 |
| `card_classification` match | +4 |
| `card_brand` match | +2 |
| `card_type` match | +1 |

**Example:** For a VISA CREDIT PLATINUM card transaction of ₹5,000 on a
merchant under franchise #7:

1. The system first looks for a `franchise_merchant` rule targeting this
   exact merchant — if found, use it.
2. Otherwise fall back to `franchise_default` for franchise #7.
3. Otherwise `admin_franchise` for franchise #7.
4. Otherwise `admin_default`.
5. Within each tier, the rule that matches more of {settlement_type,
   card_classification, card_brand, card_type} wins.

If nothing matches at all, a hardcoded **2.5% MDR fallback** is used.

### How franchises earn money

This is the key business logic:

- **Admin** sets a rate for the franchise (scope `admin_franchise`) or uses the
  global default (`admin_default`).
- **Franchise** sets a (higher) rate for its merchants (`franchise_default` or
  `franchise_merchant`).
- When a transaction occurs, the merchant is charged at the franchise's rate,
  and the franchise is charged at the admin's rate. The difference is the
  **franchise earning**.

> This means the franchise UI should always show two columns/sections:
> 1. "What admin charges me" (read-only: `admin_default` + `admin_franchise`)
> 2. "What I charge my merchants" (editable: `franchise_default` +
>    `franchise_merchant`)

---

## Base URL

```
/api/pos-charge-rules
```

---

## Data Model — `pos_charge_rules` table

| Field | Type | Nullable | Description |
|---|---|---|---|
| `id` | integer | — | Primary key, auto-increment |
| `user_id` | integer | yes | Target merchant. `null` = not merchant-specific |
| `franchaise_id` | integer | yes | Target franchise. `null` = global |
| `created_by` | integer | yes | User ID of the creator (for audit) |
| **`scope`** | **string(30)** | **no** | **Rule tier (see table above). Auto-derived by backend.** |
| `payment_mode` | string | no | `"CARD"`, `"UPI"`, etc. — required |
| `card_type` | string | yes | `"CREDIT"`, `"DEBIT"`, etc. `null` = any |
| `card_brand` | string | yes | `"VISA"`, `"MASTERCARD"`, `"RUPAY"`. `null` = any |
| `card_classification` | string | yes | `"CLASSIC"`, `"PLATINUM"`, etc. `null` = any |
| `settlement_type` | string | yes | `"today_settlement"`, `"next_day_settlement"`. `null` = any |
| `min_amount` | decimal | no | Lower bound of amount slab (default 0) |
| `max_amount` | decimal | yes | Upper bound. `null` = no upper limit |
| `charge_percent` | decimal | no | Percentage fee (e.g. `1.7` = 1.7%) |
| `charge_flat` | decimal | yes | Optional flat fee added on top of percent |
| `gst_required` | boolean | yes | Whether GST applies to the calculated charge |
| `gst_percent` | decimal | yes | GST percentage (commonly 18). Only used if `gst_required` is true |
| `is_active` | boolean | no | Only active rules are resolved during transactions |
| `createdAt` | datetime | — | Auto-managed |
| `updatedAt` | datetime | — | Auto-managed |

---

## Endpoints

### 1. Create a rule

```
POST /api/pos-charge-rules
```

**Request body** (JSON):

```json
{
  "user_id": 45,
  "franchaise_id": 7,
  "payment_mode": "CARD",
  "card_type": "CREDIT",
  "card_brand": "VISA",
  "card_classification": "PLATINUM",
  "settlement_type": "today_settlement",
  "min_amount": 0,
  "max_amount": null,
  "charge_percent": 1.7,
  "charge_flat": 0,
  "gst_required": false,
  "gst_percent": 18,
  "is_active": true
}
```

> **Do NOT send `scope`** — it is computed automatically from:
>
> | Caller role | `user_id` | `franchaise_id` | Resulting scope |
> |---|---|---|---|
> | admin | null | null | `admin_default` |
> | admin | null | 7 | `admin_franchise` |
> | admin | 45 | null | `admin_merchant` |
> | franchise | null | _(forced to own id)_ | `franchise_default` |
> | franchise | 45 | _(forced to own id)_ | `franchise_merchant` |

**Permission rules:**

| Caller | What they can create |
|---|---|
| **Admin** | Any scope. But if a merchant has a `franchaise_id`, admin **cannot** create `admin_merchant` for them — must use `admin_franchise` instead. |
| **Franchise** | Only `franchise_default` or `franchise_merchant`. The `franchaise_id` is forced to the caller's own ID. The `user_id` (if set) must be one of their merchants. A franchise **cannot** create a rule targeting their own user ID. |
| **Merchant** | Cannot create rules. |

**Validation enforced by the backend:**

- `charge_percent` >= 0
- `min_amount` <= `max_amount`
- If `gst_required=true`, then `gst_percent` >= 0
- No exact duplicate (same combination of all filter fields + scope + slab)
- No overlapping amount slabs for the same parameter combination + scope

**Success response** (201):

```json
{
  "success": true,
  "message": "Charge rule created",
  "record": {
    "id": 12,
    "scope": "admin_franchise",
    "user_id": null,
    "franchaise_id": 7,
    "payment_mode": "CARD",
    "...": "..."
  }
}
```

> **Note:** The response key is **`record`** (not `data`).

---

### 2. List rules (generic)

```
GET /api/pos-charge-rules/list
```

**Query parameters** (all optional):

| Param | Example | Notes |
|---|---|---|
| `user_id` | `45` | Filter by target merchant |
| `franchaise_id` | `7` | Filter by target franchise |
| `payment_mode` | `CARD` | |
| `card_type` | `CREDIT` | |
| `card_brand` | `VISA` | |
| `card_classification` | `PLATINUM` | |
| `settlement_type` | `today_settlement` | |
| **`scope`** | `admin_default` | **New filter.** One of: `admin_default`, `admin_franchise`, `admin_merchant`, `franchise_default`, `franchise_merchant` |
| `is_active` | `true` | |
| `page` | `1` | Default: 1 |
| `limit` | `20` | Default: 20 |

Example: `?scope=franchise_default&franchaise_id=7&payment_mode=CARD&page=1&limit=50`

**What each role sees** (the backend automatically restricts results):

| Role | Visible scopes | Additional constraint |
|---|---|---|
| **Admin** | All scopes | No restriction — sees everything |
| **Franchise** | `admin_default`, `admin_franchise`, `franchise_default`, `franchise_merchant` | Only sees `admin_franchise` / `franchise_default` / `franchise_merchant` rows where `franchaise_id` = own ID |
| **Merchant** | `admin_default`, `admin_merchant`, `admin_franchise`, `franchise_default`, `franchise_merchant` | Only sees rows that target them: `admin_merchant` where `user_id` = own ID; franchise scopes where `franchaise_id` = own franchise ID. Non-franchised merchants only see `admin_default` + `admin_merchant`. |

**Response** (200):

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "scope": "admin_default",
      "user_id": null,
      "franchaise_id": null,
      "payment_mode": "CARD",
      "card_type": null,
      "card_brand": null,
      "card_classification": null,
      "settlement_type": null,
      "min_amount": "0",
      "max_amount": null,
      "charge_percent": "2.50",
      "charge_flat": "0",
      "gst_required": false,
      "gst_percent": "18",
      "is_active": true,
      "createdAt": "2026-03-10T12:00:00.000Z",
      "updatedAt": "2026-03-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

---

### 3. List admin-set rules (franchise helper)

```
GET /api/pos-charge-rules/list/admin
```

**Who can call:** Franchise users only (returns 403 for others).

Returns rules with scope `admin_default` or `admin_franchise` (where
`franchaise_id` = the caller's ID). These are the rates the admin has set
**for** the franchise — the franchise **cannot** edit or delete them.

> **Use this endpoint to build the "What admin charges me" section** in the
> franchise dashboard.

Same query-string filters as the generic list (except `user_id`,
`franchaise_id`, and `scope` are controlled by the endpoint).

---

### 4. List franchise-created rules (franchise helper)

```
GET /api/pos-charge-rules/list/franchise
```

**Who can call:** Franchise users only (returns 403 for others).

Returns rules with scope `franchise_default` or `franchise_merchant` where
`franchaise_id` = the caller's ID. These are rules the franchise **created
themselves** — they can be edited or deleted.

> **Use this endpoint to build the "What I charge my merchants" section** in
> the franchise dashboard.

Same filters as generic list. Accepts `user_id` to narrow down to a specific
merchant.

---

### 5. List merchant charge rules (merchant helper)

```
GET /api/pos-charge-rules/list/merchant
```

**Who can call:** Merchant users only (returns 403 for others).

Returns rules grouped by origin — **no pagination**, always returns all matching rules.

**Query parameters** (all optional): `payment_mode`, `card_type`, `card_brand`,
`card_classification`, `settlement_type`, `is_active`.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "admin_default": [ { "id": 1, "scope": "admin_default", "..." : "..." } ],
    "admin_merchant": [ { "id": 5, "scope": "admin_merchant", "..." : "..." } ],
    "franchise_default": [ { "id": 9, "scope": "franchise_default", "..." : "..." } ],
    "franchise_merchant": [ { "id": 12, "scope": "franchise_merchant", "..." : "..." } ]
  }
}
```

> For non-franchised merchants, `franchise_default` and `franchise_merchant` will be empty arrays.

> **Use this endpoint to build the merchant's "My Rates" page** instead of the generic `/list`
> when you want the data pre-grouped by origin.

---

### 6. Get a single rule

```
GET /api/pos-charge-rules/:id
```

Returns one rule by primary key.

**Response** (200):

```json
{
  "success": true,
  "record": { "id": 12, "scope": "franchise_default", "..." : "..." }
}
```

---

### 7. Update a rule

```
PUT /api/pos-charge-rules/:id
```

Body may contain any subset of the creation fields. Only submitted fields
change. The `scope` is **re-derived** automatically if `user_id` or
`franchaise_id` changes.

**Permissions:** Admin can update any rule. Franchise can only update rules
they created (`franchise_default` / `franchise_merchant` scoped to their own
franchise —- identified by `created_by` matching the caller). Merchant cannot update rules.

**Response** (200):

```json
{
  "success": true,
  "message": "Rule updated",
  "record": { "id": 12, "scope": "franchise_default", "..." : "..." }
}
```

> **Note:** The response key is **`record`**.

---

### 8. Delete a rule

```
DELETE /api/pos-charge-rules/:id
```

Permanently removes the rule. Same permissions as update (franchise must be the `created_by`).

**Response** (200):

```json
{
  "success": true,
  "message": "Rule deleted"
}
```

---

### 9. Calculate charge (preview / simulation)

```
POST /api/pos-charge-rules/calculate
```

Use this from any payment screen to preview what a merchant will be charged.

**Request body:**

```json
{
  "user_id": 45,
  "payment_mode": "CARD",
  "card_type": "CREDIT",
  "card_brand": "VISA",
  "card_classification": "PLATINUM",
  "settlement_type": "today_settlement",
  "amount": 5000
}
```

> **Note:** The backend uses the `settlement_type` stored on the merchant's
> user record, not the one in this request body. If you need to override it,
> update the user record first.

**Response** (200):

```json
{
  "success": true,
  "rule": {
    "id": 12,
    "scope": "franchise_default",
    "payment_mode": "CARD",
    "card_type": "CREDIT",
    "charge_percent": "1.70",
    "charge_flat": "0",
    "gst_required": false,
    "gst_percent": "18"
  },
  "charge_percent": 1.7,
  "charge_amount": 85,
  "gst_amount": 0,
  "merchant_settlement": 4915
}
```

If no rule matches, fallback MDR of **2.5%** is applied and `rule` will be a
synthetic fallback object.

---

## Frontend UI Guide by Role

### Admin Dashboard

The admin has full CRUD on all rules. Suggested UI sections:

1. **Global Defaults** — list filtered by `scope=admin_default`. These apply
   to everyone unless overridden by a more specific scope.
2. **Franchise-specific rates** — list filtered by `scope=admin_franchise`.
   Show with the franchise name/ID. This is the rate the admin charges a
   franchise.
3. **Merchant-specific rates** — list filtered by `scope=admin_merchant`.
   Only for non-franchised merchants (merchants without a `franchaise_id`).

When creating a rule:

| Target | Set `user_id` to | Set `franchaise_id` to | Resulting scope |
|---|---|---|---|
| Global default | `null` | `null` | `admin_default` |
| For a franchise | `null` | franchise's user ID | `admin_franchise` |
| For a non-franchised merchant | merchant's user ID | `null` | `admin_merchant` |

### Franchise Dashboard

Split the screen into two sections:

#### Section A: "Admin rates" (read-only)

Call `GET /api/pos-charge-rules/list/admin`.

Display a table showing the rates the admin has set. The franchise **cannot
edit or delete** these. Show a label like _"Set by admin"_ or a lock icon.

These define what the franchise owes the platform per transaction.

#### Section B: "My rates for merchants" (editable)

Call `GET /api/pos-charge-rules/list/franchise`.

Display an editable table. This is what the franchise charges its merchants.
The franchise can create, edit, and delete rules here.

- **Default rate** (scope `franchise_default`): applies to all merchants under
  the franchise who don't have a merchant-specific rule. Create with
  `user_id = null`.
- **Merchant-specific rate** (scope `franchise_merchant`): overrides the
  default for one specific merchant. Create with `user_id = <merchant id>`.

> **Earning indicator:** Optionally show a calculated column:
> `franchise_rate - admin_rate = earning per transaction`. Fetch the admin
> rate from Section A and the franchise rate from Section B for the same
> combination to display the margin.

### Merchant Dashboard

Merchants have read-only access. You have two options:

- **`GET /api/pos-charge-rules/list/merchant`** — returns rules **pre-grouped** by
  `admin_default`, `admin_merchant`, `franchise_default`, `franchise_merchant`. No
  pagination. Preferred for building the "My Rates" view.
- **`GET /api/pos-charge-rules/list`** — the generic endpoint. Backend auto-filters
  to only applicable rules. Use when you need pagination or additional filters.

Show a simple table of the charge rates that apply to them. Use human-friendly
labels for the `scope` field:

| Raw `scope` value | Display as |
|---|---|
| `admin_default` | Platform Default |
| `admin_franchise` | Franchise Rate (set by platform) |
| `admin_merchant` | Your Custom Rate (set by platform) |
| `franchise_default` | Franchise Rate |
| `franchise_merchant` | Your Custom Rate (set by franchise) |

---

## Quick Reference: scope Filter Cheat Sheet

| UI screen | Endpoint | `scope` filter | Notes |
|---|---|---|---|
| Admin → global defaults | `GET /list?scope=admin_default` | `admin_default` | |
| Admin → franchise rates | `GET /list?scope=admin_franchise` | `admin_franchise` | |
| Admin → merchant overrides | `GET /list?scope=admin_merchant` | `admin_merchant` | |
| Franchise → admin-set rates | `GET /list/admin` | _(automatic)_ | Read-only |
| Franchise → own rates | `GET /list/franchise` | _(automatic)_ | Editable |
| Merchant → rates (grouped) | `GET /list/merchant` | _(automatic)_ | Grouped, no pagination |
| Merchant → rates (paginated) | `GET /list` | _(automatic)_ | Paginated |
| Any role → charge preview | `POST /calculate` | — | Stateless |

---

## Notes

- **Legacy endpoints** (`/api/pos-charge`, `/api/pos-transaction-charge`)
  remain untouched and unrelated. Use only the `/api/pos-charge-rules` routes.
- The `/calculate` endpoint is stateless — call on demand, cache client-side.
- The response always includes the full `rule` object; display `rule.scope` or
  `rule.id` for debugging/logging.
- `card_classification` is currently not supplied by Razorpay webhooks and
  will usually be `null`. Include it manually if available.
- **Response keys:** Create/Get/Update all return the rule under **`record`**, not `data`.
- **Franchise role name:** Internally the DB stores the role as `franchaise` (historical typo).
  The backend accepts both `franchise` and `franchaise` spellings transparently — the
  frontend does not need to worry about this.
- `charge_percent`, `charge_flat`, `min_amount`, `max_amount`, `gst_percent` are returned
  as decimal strings (e.g. `"1.70"`) — use `parseFloat()` before arithmetic.
