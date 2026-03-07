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
  "user_id": 45,                    // optional merchant
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

Rules are validated for duplicate combinations, overlapping slabs and simple sanity checks (min &lt;= max, non‑negative percent).

### List rules

`GET /api/pos-charge-rules/list` with query parameters matching the filter names above plus `page` and `limit`.

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
  "merchant_settlement": 4915
}
```

If no active rule matches the supplied criteria the system returns a default MDR of `2.5%` (configurable in code).

## Table schema

The underlying table is `pos_charge_rules` and matches the specification provided in the design document. An index (`idx_charge_lookup`) covers the lookup columns for fast queries.

## Notes

- Existing `/api/pos-transaction-charge` routes remain untouched.
- The new engine supports wildcards (`NULL` values) and chooses the most specific rule automatically.
- Slab overlap checks are enforced when creating or updating rules.

Refer to the internal developer guide for further implementation details.
