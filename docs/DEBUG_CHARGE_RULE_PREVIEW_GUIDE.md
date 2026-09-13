# Debug Charge Rule Preview API Guide (Dry-Run / Simulation)

_Last updated: 2026-09-13_

## Overview
This API endpoint allows Administrators and authorized Employees to perform a **Dry-Run (Simulation)** charge rule lookup using raw webhook transaction payloads or standard parameter fields.

- **URL:** `/api/pos-charge-rules/debug-preview` (also available at `/api/pos-charge-rules/debug-preview-payload`)
- **HTTP Method:** `POST`
- **Authentication:** Admin / Employee Bearer Token (`Authorization: Bearer <token>`)
- **Required Permission:** `RATE_SETTINGS_READ` (or Admin role)
- **Side Effects:** **NONE (100% Read-Only / Simulation)** — No database notifications created/updated, no wallet debits/credits, no ledger entries.

---

## Headers

| Header | Value | Description |
|---|---|---|
| `Content-Type` | `application/json` | Request payload format |
| `Authorization` | `Bearer <ADMIN_JWT_TOKEN>` | Valid Admin / Employee JWT token |

---

## Request Body Parameters

You can pass the transaction details either **directly at top-level** or inside a nested **`payload`** object.

### User Identification (Pass ANY one of the following):
- `user_id` (number/string): The ID of the Merchant / Franchise user.
- `user_mobile` / `mobile` (string): The mobile number of the user.
- `mid` and `tid`: POS Machine MID and TID (if provided, the system auto-resolves the assigned operator user).

### Transaction / Webhook Fields:
- `amount` / `amountOriginal`: Transaction amount (e.g. `100` or `15000`).
- `paymentMode` / `payment_mode`: Payment mode (`CARD`, `UPI`).
- `paymentCardType` / `card_type`: Card type (`CREDIT`, `DEBIT`, `PREPAID`).
- `paymentCardBrand` / `card_brand`: Card brand (`VISA`, `MASTERCARD`, `RUPAY`, `AMEX`, `DINERS`).
- `cardClassification` / `card_classification`: Classification (`BUSINESS`, `CORPORATE`, `PLATINUM`, `GOLD`, `SIGNATURE`, etc.).
- `source`: Webhook source (`agro_axis`, `agro_hdfc`, `everlife`, etc.).
- `mid` & `tid`: Terminal identifiers (for company name & machine resolution).

---

## Example Requests

### Example 1: Direct Raw Webhook Payload
```json
{
  "user_id": 122,
  "amount": 100,
  "amountAdditional": 0,
  "amountCashBack": 0,
  "amountOriginal": 100,
  "authCode": "770157",
  "batchNumber": "135",
  "currencyCode": "INR",
  "customerName": "JAY VIMALKUMAR NATH",
  "customerReceiptUrl": "http://eze.cc/RZPPOS/t/a/48054A0D/",
  "deviceSerial": "1495049774",
  "externalRefNumber": "EZ202609011253558723",
  "formattedPan": "4166-45XX-XXXX-0498",
  "mid": "037135032060203",
  "tid": "77971942",
  "payerName": "JAY VIMALKUMAR NATH",
  "paymentCardBrand": "VISA",
  "paymentCardType": "CREDIT",
  "paymentMode": "CARD",
  "pgInvoiceNumber": "3060",
  "postingDate": "2026-09-01T07:23:58.000+0000",
  "rrNumber": "624407517956",
  "settlementStatus": "PENDING",
  "stan": "3058",
  "status": "AUTHORIZED",
  "txnId": "260901072357312R01ZSCuiQU",
  "txnType": "CHARGE",
  "cardClassification": "BUSINESS",
  "source": "agro_axis"
}
```

### Example 2: Lookup via User Mobile Number
```json
{
  "user_mobile": "9867493007",
  "amount": 25000,
  "paymentMode": "CARD",
  "paymentCardType": "CREDIT",
  "paymentCardBrand": "VISA",
  "cardClassification": "BUSINESS"
}
```

---

## Example Success Response (HTTP 200)

```json
{
  "success": true,
  "message": "Charge rule debug preview calculated successfully (Dry-Run, No DB/Wallet Operation performed)",
  "user": {
    "id": 122,
    "name": "KHADAR BASHA ALLABAKASH",
    "mobile": "9867493007",
    "role": "franchaise",
    "settlement_type": "next_day_settlement",
    "franchaise_id": null
  },
  "resolvedInputs": {
    "paymentMode": "CARD",
    "cardType": "CREDIT",
    "cardBrand": "VISA",
    "cardClassification": "BUSINESS",
    "settlementType": "next_day_settlement",
    "amount": 100,
    "companyName": null
  },
  "matchedRule": {
    "id": 5035,
    "scope": "admin_franchise",
    "user_id": null,
    "franchaise_id": 122,
    "payment_mode": "CARD",
    "card_type": "CREDIT",
    "card_brand": "VISA",
    "card_classification": "BUSINESS",
    "settlement_type": "next_day_settlement",
    "charge_percent": "3.00%",
    "flat_fee": null,
    "min_amount": "0.00",
    "max_amount": null,
    "specificity": 31016
  },
  "franchiseRule": null,
  "calculatedCharge": {
    "chargeRate": "3%",
    "chargeAmount": 3,
    "gstAmount": 0,
    "netAmount": 97,
    "franchiseChargeAmount": 0,
    "franchiseEarning": 0
  }
}
```

---

## Response Fields Explanation

- `user`: Resolved merchant/franchise details (User ID, Role, Settlement Type).
- `resolvedInputs`: Exact normalized dimensions extracted from payload used for SQL rule lookup.
- `matchedRule`: The exact winning rule from `pos_charge_rules` table (including Rule ID, Scope, Rate, and Specificity Score).
- `calculatedCharge`:
  - `chargeRate`: Resolved rate percentage (e.g. `3%`).
  - `chargeAmount`: Calculated MDR deduction in ₹.
  - `gstAmount`: Calculated GST in ₹.
  - `netAmount`: Net amount credited to merchant wallet.
