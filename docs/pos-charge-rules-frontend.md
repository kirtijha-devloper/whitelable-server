# POS Charge Rules Frontend Documentation

This document is intended for the **frontend team**.  It describes the HTTP API exposed by the new MDR rule engine.  All endpoints are protected by the existing `Authorization: Bearer <token>` scheme (same as other APIs).

---

## 🔗 Base URL

```
/api/pos-charge-rules
```

This path is mounted by the Express server alongside the legacy POS charge endpoints.  Do **not** call `/api/pos-charge` or `/api/pos-transaction-charge` for the new functionality.

---

## 🛠 Rule Management Endpoints (admin screens)

### Create a rule

```
POST /api/pos-charge-rules
```

**Request body** (JSON):

```json
{
  "user_id": 45,                    // optional merchant (null = global)
  "payment_mode": "CARD",         // required
  "card_type": "CREDIT",          // optional
  "card_brand": "VISA",           // optional
  "card_classification": "PLATINUM", // optional; currently not supplied by Razorpay webhook so often null
  "settlement_type": "TODAY",     // optional
  "min_amount": 0,                 // required (default 0)
  "max_amount": null,              // optional (null = open-ended)
  "charge_percent": 1.7,           // required, ≥0
  "charge_flat": 0,                // optional
  "gst_required": false,           // optional, whether GST applies to the charge
  "gst_percent": 18,               // optional percentage if gst_required is true
  "is_active": true                // optional
}
```

> The backend enforces:
> * `charge_percent` ≥ 0
> * `min_amount <= max_amount`
> * If `gst_required=true` then `gst_percent` must be ≥ 0
> * No overlapping slabs for the same parameter combination
> * No exact duplicate records


### List rules

```
GET /api/pos-charge-rules/list
```

Supports query‑string filters. Example:

```
?user_id=45&payment_mode=CARD&card_brand=VISA&is_active=true&page=2&limit=50
```

Response includes `pagination` metadata.

### Get one rule

```
GET /api/pos-charge-rules/:id
```

Where `:id` is the rule primary key.

### Update a rule

```
PUT /api/pos-charge-rules/:id
```

Body may contain any subset of the creation fields.  Only submitted fields will change.

### Delete a rule

```
DELETE /api/pos-charge-rules/:id
```

Removes the rule from the database.

---

## ⚡ Charge Calculation Endpoint (transaction screens)

```
POST /api/pos-charge-rules/calculate
```

**Body**:

```json
{
  "user_id": 45,
  "payment_mode": "CARD",
  "card_type": "CREDIT",
  "card_brand": "VISA",
  "card_classification": "PLATINUM",
  "settlement_type": "TODAY",
  "amount": 5000
}
```

The service looks up the most specific active rule, using the `settlement_type` stored on the merchant’s user record rather than the webhook payload.  (Any `settlement_type` included in the request body is ignored.)  When the frontend creates or edits a user it must supply one of the two supported values:

```
'today_settlement'   // default
'next_day_settlement'
```

The user model enforces this with a Sequelize `isIn` validation, so invalid strings will be rejected by the API.

Card classification is currently not provided by Razorpay notifications and will usually be null; you may include it manually if available but most lookups omit it.

The engine falls back to a global MDR of **2.5 %** if nothing matches.  It returns both the matched rule row and calculated numbers.

**Response**:

```json
{
  "success": true,
  "rule": { /* matched DB row or fallback */ },
  "charge_percent": 1.7,
  "charge_amount": 85,
  "merchant_settlement": 4915
}
```

Use this endpoint from any payment-related UI (checkout page, POS simulator, QR scan, etc.) to display charges without needing to know the rule logic.

---

## 📝 Notes for Integration

* **Legacy endpoints remain in place but are unrelated**; continue using the new routes for all future work.
* The `/calculate` route is stateless—call it on demand and cache the result client‑side if desired.
* The response includes the raw `rule` row; you can display `rule.id` or other fields for debugging or logging.
* Filtering and pagination parameters on the list endpoint help keep payload sizes small when rendering tables.

Feel free to copy this markdown file into the frontend repo or central docs site.  Reach out if you need sample Postman collections or swagger specs!  🎯