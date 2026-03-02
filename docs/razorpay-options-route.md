# Razorpay Options Endpoint

**Endpoint:** `GET /api/pos-charge/razorpay-options`

Returns the distinct values currently stored in the `razorpay_notifications` table for the
following columns:

- `payment_mode`
- `payment_card_type`
- `payment_card_brand`

This information is typically used by the frontend to populate filter dropdowns or other UI
controls that depend on actual values present in the database. Only authenticated users may
access the endpoint, and it simply performs three `DISTINCT` queries internally.

## Response format

```json
{
  "payment_modes": ["CARD", "UPI"],
  "payment_card_types": ["CREDIT", "DEBIT", "UNKNOWN", "PREPAID"],
  "payment_card_brands": ["DINERS", "", "AMEX", "VISA", "MASTER_CARD", "RUPAY"]
}
```

- Empty string (`""`) means a record existed with a blank brand value.
- Nulls are filtered out by the server.
- Arrays will be empty if no notifications have been received yet.

## Usage notes

1. Useful for building dynamic, data-driven forms and filters on the admin dashboard.
2. Avoids hard-coded option lists in the frontend.
3. Can be called whenever the UI needs to refresh possible values.

Authentication is required; the same token used for other API calls is valid.
