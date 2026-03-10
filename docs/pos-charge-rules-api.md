# POS Charge Rules API

This new module implements the rule-based MDR engine described in the technical documentation. It runs alongside the existing `posCharge` endpoints and does **not** touch them.

## Base path

```
/api/pos-charge-rules
```

All routes are protected by the standard `validateToken` middleware.

### Create rule

`POST /api/pos-charge-rules`

Body parameters (JSON):

```json
{
  "user_id": 45,                    // optional merchant; null means non-specific
  "franchaise_id": 7,              // optional franchise; null means global
  "payment_mode": "CARD",         // required
  "card_type": "CREDIT",          // optional
  "card_brand": "VISA",           // optional
  "card_classification": "PLATINUM", // optional
  "settlement_type": "TODAY",     // optional
  "min_amount": 0,                 // required (defaults to 0)
  "max_amount": null,              // optional (null = open-ended)
  "charge_percent": 1.7,           // required >=0
  "charge_flat": 0,                // optional
  "is_active": true                // optional
}
```

> **Permission notes:**
>
> * **admin** may create any combination. Merchant rules are allowed only if the
>   target merchant has no `franchaise_id` (otherwise use a franchise rule).
> * **franchaise** may create or modify rules where `franchaise_id` equals their
>   own ID; rules for specific merchants require that the merchant belongs to
>   the franchise.
>
> The same restrictions apply to updates and deletes.

Rules are validated for duplicate combinations, overlapping slabs and simple sanity checks (min &lt;= max, non‑negative percent).

### List rules

`GET /api/pos-charge-rules/list` with query parameters matching the filter names above plus `page` and `limit`.

There are two additional helper endpoints for franchise users:

* `GET /api/pos-charge-rules/list/admin` – returns global defaults plus any
  franchise‑level rules **not created by the franchise itself**; these are
  considered system/admin charges and cannot be edited or deleted by the
  franchise user.
* `GET /api/pos-charge-rules/list/franchise` – returns only the rules that the
  calling franchise user created (either merchant‑specific or a default).  The
  franchise may update/delete records returned by this endpoint.

> **Visibility rules:**
>
> * **admin:** sees all records.
> * **franchaise:** sees their own franchise defaults
>   (`franchaise_id = <their id>`), any rule explicitly targeting them
>   (`user_id = <their id>`), and also any merchant-specific rules for merchants
>   under their franchise (useful for legacy data; new rules of that type are
>   not created by the system).
> * **merchant:** sees a personal rule (`user_id` equal theirs) if one exists,
>   otherwise the applicable default(s) – first the franchise default (if the
>   merchant has a `franchaise_id`), then the global default (`franchaise_id` is
>   `NULL`).

The endpoint accepts the additional `franchaise_id` filter to locate rules by
franchise when needed.

### Retrieve single rule

`GET /api/pos-charge-rules/:id`

### Update rule

`PUT /api/pos-charge-rules/:id` with any subset of the fields from creation.

### Delete rule

`DELETE /api/pos-charge-rules/:id`

### Calculate charge

`POST /api/pos-charge-rules/calculate`

Request body accepts the same parameters used for lookup (user_id, payment_mode, card_type, card_brand, card_classification, settlement_type) plus `amount`.

Response:

```json
{
  "success": true,
  "rule": { /* matching database row or fallback */ },
  "charge_percent": 1.7,
  "charge_amount": 85,
  "gst_amount": 15.3,       // if gst_required=true and gst_percent specified
  "merchant_settlement": 4899.7
}
```

If no active rule matches the supplied criteria the system returns a default MDR of `2.5%` (configurable in code).

Rules are now looked up by both `user_id` **and** `franchaise_id` so that
franchise‑level defaults can be defined independent of individual merchants.  The
engine will select the most specific applicable rule (merchant wins over
franchise over global).

## Table schema

The underlying table is `pos_charge_rules` and matches the specification provided in the design document. An index (`idx_charge_lookup`) covers the lookup columns for fast queries.

New column added in 2026-03-10 migration:

* `created_by` – integer reference to the user who created the rule.  Used
  internally for permission checks and to differentiate admin‑supplied
  defaults from franchise‑created overrides.

## Notes

- Existing `/api/pos-transaction-charge` routes remain untouched.
- The new engine supports wildcards (`NULL` values) and chooses the most specific rule automatically.
- Slab overlap checks are enforced when creating or updating rules.

Refer to the internal developer guide for further implementation details.
