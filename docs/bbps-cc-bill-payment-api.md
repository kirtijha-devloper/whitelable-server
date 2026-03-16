# BBPS Credit Card Bill Payment – Frontend API Documentation

**Base URL:** `/api/bbps-cc`  
**Provider:** InstantPay  
**Auth:** All endpoints require `Authorization: Bearer <jwt-token>`

---

## Typical Flow

```
1. GET  /billers                  → user picks a biller (e.g. HDFC Credit Card)
2. POST /biller-details           → get input fields required by that biller
3. POST /pre-payment-enquiry      → (only if biller needs it) fetch/validate bill
4. POST /pay                      → execute the payment
```

---

## 1. GET `/api/bbps-cc/categories`

Fetch all available BBPS utility categories.  
*(Optional – use if you want to show a category picker before billers)*

**Request:**
```http
GET /api/bbps-cc/categories
Authorization: Bearer <token>
```

**Success Response `200`:**
```json
{
  "success": true,
  "data": {
    "data": [
      { "categoryKey": "C15", "categoryName": "Credit Card" },
      { "categoryKey": "C1",  "categoryName": "Mobile (Prepaid)" }
    ]
  }
}
```

---

## 2. GET `/api/bbps-cc/billers`

Fetch all Credit Card billers (HDFC, ICICI, SBI, Axis, etc.).  
This is always scoped to Credit Card category (C15) — no parameter needed.

**Request:**
```http
GET /api/bbps-cc/billers
Authorization: Bearer <token>
```

**Success Response `200`:**
```json
{
  "success": true,
  "count": 12,
  "data": [
    { "billerId": "HDFCCCRD001", "billerName": "HDFC Credit Card" },
    { "billerId": "ICICCCRD001", "billerName": "ICICI Credit Card" },
    { "billerId": "SBICCRD001",  "billerName": "SBI Credit Card" }
  ]
}
```

> **UI tip:** Show this as a dropdown or searchable list. Store the selected `billerId` for the next step.

---

## 3. POST `/api/bbps-cc/biller-details`

Get the input field schema for a specific biller.  
This tells you what params to ask the user (e.g. card number, mobile number).  
Also tells you whether pre-payment enquiry is mandatory.

**Request:**
```http
POST /api/bbps-cc/biller-details
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "billerId": "HDFCCCRD001"
}
```

**Success Response `200`:**
```json
{
  "success": true,
  "data": {
    "data": {
      "billerId": "HDFCCCRD001",
      "billerName": "HDFC Credit Card",
      "supportValidation": "OPTIONAL",
      "fetchRequirement": "MANDATORY",
      "inputParams": [
        {
          "paramName": "Credit Card Number",
          "dataType": "NUMERIC",
          "minLength": 16,
          "maxLength": 16,
          "optional": false
        }
      ],
      "paymentModes": [
        {
          "name": "Cash",
          "paymentInfo": [
            { "name": "Remarks", "optional": true }
          ]
        },
        {
          "name": "UPI",
          "paymentInfo": [
            { "name": "VPA", "optional": false }
          ]
        }
      ]
    }
  }
}
```

> **UI tip:**  
> - Dynamically render an input for each item in `inputParams`. The first input maps to `param1`, second to `param2`.  
> - Render payment mode selector from `paymentModes`.  
> - For the selected payment mode, render extra fields from `paymentModes[n].paymentInfo`.  
> - If `fetchRequirement === 'MANDATORY'` → call `/pre-payment-enquiry` before `/pay`.  
> - If `supportValidation === 'MANDATORY'` → same, call `/pre-payment-enquiry` first.

---

## 4. POST `/api/bbps-cc/pre-payment-enquiry`

Fetch or validate the bill before payment.  
**Only call this if** the biller's `fetchRequirement` or `supportValidation` is `'MANDATORY'`.

**Request:**
```http
POST /api/bbps-cc/pre-payment-enquiry
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "billerId": "HDFCCCRD001",
  "initChannel": "Internet",
  "param1": "4111111111111111",
  "param2": "",
  "transactionAmount": 5000,
  "customerMobile": "9876543210"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `billerId` | string | ✅ | From `/billers` |
| `initChannel` | string | ✅ | Always send `"Internet"` |
| `param1` | string | ✅ | Card / account number (first `inputParams` field) |
| `param2` | string | ❌ | Second `inputParams` field if applicable |
| `transactionAmount` | number | ✅ | Bill amount in rupees |
| `customerMobile` | string | ❌ | 10-digit mobile (used in remarks) |

**Success Response `200`:**
```json
{
  "success": true,
  "message": "Pre-payment enquiry successful",
  "externalRef": "APBBPS20261234567890123",
  "enquiryReferenceId": "ENQ123456789",   // returned at top-level for easy access
  "data": {
    "statuscode": "OI",
    "data": {
      "enquiryReferenceId": "ENQ123456789",
      "billDetails": {
        "CustomerName": "John Doe",
        "billAmount": "5000",
        "dueDate": "2026-03-05"
      }
    }
  }
}
```

> **UI tip:** Display `billDetails` to the user for confirmation before proceeding.  
> Save `enquiryReferenceId` (top-level field) and pass it as `enquiryReferenceId` in `/pay`.

---

## 5. POST `/api/bbps-cc/pay`

Execute the credit card bill payment.

**Request:**
```http
POST /api/bbps-cc/pay
Authorization: Bearer <token>
Content-Type: application/json
```
```json
{
  "billerId": "HDFCCCRD001",
  "initChannel": "Internet",
  "param1": "4111111111111111",
  "param2": "",
  "transactionAmount": 5000,
  "customerMobile": "9876543210",
  "paymentMode": "Cash",
  "paymentInfo": {
    "Remarks": "Monthly CC bill"
  },
  "enquiryReferenceId": "ENQ123456789",
  "geoCode": "28.6139,77.2090",
  "customerPan": "ABCDE1234F"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `billerId` | string | ✅ | From `/billers` |
| `initChannel` | string | ✅ | Always send `"Internet"` |
| `param1` | string | ✅ | Card / account number |
| `param2` | string | ❌ | Second param if biller needs it |
| `transactionAmount` | number | ✅ | Bill amount in rupees |
| `customerMobile` | string | ✅ | 10-digit mobile number |
| `paymentMode` | string | ❌ | `"Cash"` (default) / `"UPI"` / others from biller-details |
| `paymentInfo` | object | ❌ | Dynamic fields for selected `paymentMode` (e.g. `{ "VPA": "user@upi" }` for UPI) |
| `enquiryReferenceId` | string | ❌ | From `/pre-payment-enquiry` response (required when biller mandates fetch) |
| `geoCode` | string | ❌ | `"lat,long"` of user device |
| `customerPan` | string | ❌ | PAN card (required by some billers) |

**Success Response `200`:**
```json
{
  "success": true,
  "message": "CC bill payment successful",
  "externalRef": "APBBPS20261234567890999",
  "statuscode": "TXN",
  "data": {
    "statuscode": "TXN",
    "status": "Transaction Successful",
    "data": {
      "txnReferenceId": "IPAY987654321",
      "txnValue": 5000,
      "billerDetails": { "name": "HDFC Credit Card" },
      "billDetails": {
        "CustomerName": "John Doe",
        "CustomerParamsDetails": [{ "Value": "1111" }]
      }
    }
  }
}
```

**Failure Response `200` (payment failed at provider):**
```json
{
  "success": false,
  "message": "Transaction Failed",
  "externalRef": "APBBPS20261234567890999",
  "statuscode": "ERR",
  "data": { ... }
}
```

> **UI tip:**  
> - Check `success === true` AND `statuscode === "TXN"` or `"TUP"` to show success screen.  
> - `statuscode === "ERR"` → show error message from `message`.  
> - Always show `externalRef` as the transaction reference number to the user.

---

## Error Responses (all endpoints)

| Status | Meaning |
|--------|---------|
| `400` | Missing required fields — check `message` for which field |
| `401` | Invalid or missing JWT token |
| `500` | Server or InstantPay API error — check `message` |

---

## Complete Example (HDFC CC Bill Payment)

```
Step 1: GET  /api/bbps-cc/billers
          → user selects "HDFC Credit Card" (billerId: HDFCCCRD001)

Step 2: POST /api/bbps-cc/biller-details  { billerId: "HDFCCCRD001" }
          → show input for 16-digit card number
          → fetchRequirement: MANDATORY → must do step 3

Step 3: POST /api/bbps-cc/pre-payment-enquiry
          { billerId, initChannel: "Internet", param1: "4111111111111111", transactionAmount: 5000 }
          → show bill details to user for confirmation
          → save enquiryReferenceId from response

Step 4: POST /api/bbps-cc/pay
          { billerId, initChannel: "Internet", param1: "4111111111111111",
            transactionAmount: 5000, customerMobile: "9876543210",
            paymentMode: "Cash", enquiryReferenceId: "ENQ123..." }
          → success: show receipt with externalRef
```
