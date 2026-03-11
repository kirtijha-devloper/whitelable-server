# POS Charge Rules API

Technical API reference for the rule-based MDR engine. For frontend-specific
guidance (UI layout, scope labels, role-based sections) see
[pos-charge-rules-frontend.md](pos-charge-rules-frontend.md).

## Base path

```
/api/pos-charge-rules
```

All routes are protected by the standard `validateToken` middleware.

---

## The `scope` column

Every rule has a `scope` field (STRING(30), NOT NULL, default `'admin_default'`)
that encodes who created it and who it targets:

| Scope | Creator | Target |
|---|---|---|
| `admin_default` | admin | Global fallback (everyone) |
| `admin_franchise` | admin | A specific franchise (via `franchaise_id`) |
| `admin_merchant` | admin | A specific non-franchised merchant (via `user_id`) |
| `franchise_default` | franchise | All merchants under that franchise |
| `franchise_merchant` | franchise | One specific merchant under that franchise |

The scope is **auto-derived** by the backend when a rule is created or updated.
It is never sent by the client. The derivation logic is:

| Caller role | `user_id` set? | `franchaise_id` set? | Result |
|---|---|---|---|
| admin | no | no | `admin_default` |
| admin | no | yes | `admin_franchise` |
| admin | yes | no | `admin_merchant` |
| franchise | no | _(forced)_ | `franchise_default` |
| franchise | yes | _(forced)_ | `franchise_merchant` |

---

## Charge resolution (specificity scoring)

The engine picks the single best-matching active rule via SQL scoring:

```
score = scope_tier_weight + dimension_specificity
```

**Scope tier weights:**

| Scope | Weight |
|---|:---:|
| `franchise_merchant` | 64 |
| `admin_merchant` | 48 |
| `franchise_default` | 32 |
| `admin_franchise` | 16 |
| `admin_default` | 0 |

**Dimension specificity (0–15):**

| Dimension | Points |
|---|:---:|
| `settlement_type` matched | +8 |
| `card_classification` matched | +4 |
| `card_brand` matched | +2 |
| `card_type` matched | +1 |

Row filtering: only rows where `user_id` matches the merchant OR (`user_id` IS
NULL AND (`franchaise_id` matches OR `franchaise_id` IS NULL)) are considered,
plus the usual dimension and amount-slab filters.

A separate function `getAdminChargeRuleForFranchise()` resolves only
`admin_franchise` + `admin_default` scopes — used internally by the webhook
worker to calculate what the franchise owes the platform (franchise earnings =
merchant charge − admin charge).

Fallback: **2.5% MDR** if nothing matches.

---

## Endpoints

### Create rule

`POST /api/pos-charge-rules`

Body parameters (JSON):

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

> **Permission notes:**
>
> * **admin** may create any combination. If the target merchant has a
>   `franchaise_id`, admin **cannot** create `admin_merchant` — must use
>   `admin_franchise` instead.
> * **franchise** may only create `franchise_default` or `franchise_merchant`.
>   `franchaise_id` is forced to the caller's ID. `user_id` (if set) must be
>   one of their merchants.
> * **merchant** cannot create rules.

Duplicate and overlapping-slab checks are scoped — two rules with different
`scope` values are **not** considered duplicates even if all other fields match.

### List rules

`GET /api/pos-charge-rules/list`

Query parameters: `user_id`, `franchaise_id`, `payment_mode`, `card_type`,
`card_brand`, `card_classification`, `settlement_type`, `scope`, `is_active`,
`page`, `limit`.

The **`scope`** query parameter is new — pass one of the five valid scope
values to filter.

**Role-based visibility:**

| Role | Sees |
|---|---|
| admin | All rules |
| franchise | `admin_default` + `admin_franchise` / `franchise_default` / `franchise_merchant` where `franchaise_id` = own ID |
| merchant | `admin_default` + `admin_merchant` (own) + franchise scopes (own franchise, if any) |

### Franchise helper endpoints

* `GET /api/pos-charge-rules/list/admin` — returns `admin_default` + `admin_franchise`
  rules (for the calling franchise). Read-only: these are rates the admin set.
* `GET /api/pos-charge-rules/list/franchise` — returns `franchise_default` +
  `franchise_merchant` rules created by the calling franchise. Editable.

Both return 403 for non-franchise callers.

### Retrieve single rule

`GET /api/pos-charge-rules/:id`

### Update rule

`PUT /api/pos-charge-rules/:id` with any subset of the creation fields.

The `scope` is **re-derived** if `user_id` or `franchaise_id` changes.

### Delete rule

`DELETE /api/pos-charge-rules/:id`

### Calculate charge

`POST /api/pos-charge-rules/calculate`

Request body: `user_id`, `payment_mode`, `card_type`, `card_brand`,
`card_classification`, `settlement_type`, `amount`.

Response:

```json
{
  "success": true,
  "rule": { "id": 12, "scope": "franchise_default", "..." : "..." },
  "charge_percent": 1.7,
  "charge_amount": 85,
  "gst_amount": 0,
  "merchant_settlement": 4915
}
```

---

## Table schema

Table: `pos_charge_rules`

Key columns: `id`, `user_id`, `franchaise_id`, `created_by`, **`scope`**,
`payment_mode`, `card_type`, `card_brand`, `card_classification`,
`settlement_type`, `min_amount`, `max_amount`, `charge_percent`, `charge_flat`,
`gst_required`, `gst_percent`, `is_active`, `createdAt`, `updatedAt`.

Indexes:
- `idx_charge_lookup` — covers lookup columns for fast queries
- `idx_pos_charge_rules_scope` — covers the `scope` column

Migration `20260311100000-add-scope-to-pos-charge-rules.js` adds the `scope`
column and backfills existing rows based on `user_id`, `franchaise_id`, and
`created_by` patterns.

---

## Notes

- Existing `/api/pos-transaction-charge` and `/api/pos-charge` routes remain
  untouched.
- The engine supports wildcards (`NULL` values) and chooses the most specific
  rule automatically.
- Slab overlap checks are enforced per-scope when creating or updating rules.
