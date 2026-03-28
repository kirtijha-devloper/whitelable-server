# BillAvenue CC Bill Payment — Frontend Implementation Guide

## Overview

The BillAvenue integration allows agents to pay Credit Card (CC) bills through the BillAvenue BBPS network. The flow has three main steps:

1. **Get Billers** – fetch the list of supported CC billers.
2. **Fetch Bill** – look up the outstanding bill for a customer (optional but recommended).
3. **Pay Bill** – execute the payment.

Supporting operations:
- **Payment History** – list/view past payments.
- **Transaction Status** – check the status of a specific transaction.
- **Register Complaint** – raise a complaint for a failed payment.

All endpoints require a valid JWT in the `Authorization` header.

---

## Base URL

```
/api/bill-avenue
```

---

## Authentication

Every request must include:

```http
Authorization: Bearer <jwt_token>
```

---

## API Endpoints

### 1. Get Billers

Fetches the list of supported CC billers. The response is cached server-side for 1 hour.

**Request**
```http
GET /api/bill-avenue/billers
```

**Success Response `200`**
```json
{
  "success": true,
  "data": { ... }  // BillAvenue parsed biller list
}
```

**Usage:** Populate a `<select>` or searchable dropdown so the agent can choose a biller (e.g. HDFC Credit Card, ICICI Credit Card, etc.).

---

### 2. Fetch Bill

Validates the customer's account and retrieves the outstanding bill amount. Call this before payment so the agent can confirm the due amount with the customer.

**Request**
```http
POST /api/bill-avenue/fetch-bill
Content-Type: application/json
Authorization: Bearer <token>
```

**Body**
```json
{
  "billerId": "HDFC000CC00ANZ",
  "customerParams": {
    "CRN": "4111111111111234"
  },
  "amount": 5000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `billerId` | string | Yes | Biller ID from the biller list |
| `customerParams` | object | Yes | Key-value pairs of customer identifiers (e.g. card number, CRN). Keys vary per biller. |
| `amount` | number | No | If provided, a balance pre-check is performed before the API call |

**Success Response `200`**
```json
{
  "success": true,
  "data": { ... }  // Parsed BillAvenue bill fetch response
}
```

**Insufficient Balance Response `400`**
```json
{
  "success": false,
  "message": "Insufficient balance. Minimum required is ₹5060.00 (transaction + charge + buffer).",
  "currentBalance": 1000.00,
  "requiredBalance": 5060.00,
  "requiredCharge": 30.00
}
```

**Notes:**
- The `customerParams` keys depend on the selected biller. Derive them from the biller info response.
- Display the fetched bill amount to the agent for confirmation before proceeding to payment.

---

### 3. Pay Bill

Executes the CC bill payment. The server debits the wallet, calls BillAvenue, deducts the service charge on success, or reverses the debit on failure.

**Request**
```http
POST /api/bill-avenue/pay
Content-Type: application/json
Authorization: Bearer <token>
```

**Body**
```json
{
  "billerId": "HDFC000CC00ANZ",
  "customerParams": {
    "CRN": "4111111111111234"
  },
  "amount": 5000,
  "paymentMode": "Cash",
  "quickPay": "Y",
  "splitPay": null,
  "ccf": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `billerId` | string | Yes | Biller ID |
| `customerParams` | object | Yes | Same as fetch-bill |
| `amount` | number | Yes | Payment amount in INR |
| `paymentMode` | string | No | Payment mode. Default: `"Cash"` |
| `quickPay` | string | No | `"Y"` / `"N"` (BillAvenue quick pay flag) |
| `splitPay` | any | No | Split pay data (biller-specific) |
| `ccf` | any | No | Customer Convenience Fee data (biller-specific) |

**Success Response `200`**
```json
{
  "success": true,
  "message": "Bill payment successful",
  "transactionRefId": "BA20240328123456",
  "responseCode": "000",
  "data": { ... }
}
```

**Payment Failed Response `200`**
```json
{
  "success": false,
  "message": "Bill payment failed",
  "transactionRefId": "BA20240328123456",
  "responseCode": "099",
  "data": { ... }
}
```

> **Note:** A `200` HTTP status does **not** mean the payment succeeded. Always check `success` and `responseCode`. Response code `"000"` means success.

**Insufficient Balance Response `400`**
```json
{
  "success": false,
  "message": "Insufficient balance. Minimum required is ₹5060.00 (transaction + charge + buffer).",
  "currentBalance": 1200.00,
  "requiredBalance": 5060.00,
  "requiredCharge": 30.00
}
```

---

### 4. List Payment Records

Returns the agent's payment history (paginated). Admin users see all records.

**Request**
```http
GET /api/bill-avenue/payments?page=1&limit=25&status=success&billerId=HDFC000CC00ANZ
```

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Records per page (default: 25) |
| `status` | string | Filter by status: `pending`, `success`, `failed` |
| `billerId` | string | Filter by biller |
| `transactionRefId` | string | Partial match search |

**Success Response `200`**
```json
{
  "success": true,
  "count": 42,
  "data": [
    {
      "id": 1,
      "user_id": 10,
      "biller_id": "HDFC000CC00ANZ",
      "customer_params": { "CRN": "4111111111111234" },
      "transaction_amount": "5000.00",
      "payment_mode": "Cash",
      "transaction_ref_id": "BA20240328123456",
      "status": "success",
      "response_code": "000",
      "charge_amount": "30.00",
      "createdAt": "2024-03-28T10:00:00.000Z",
      "updatedAt": "2024-03-28T10:00:05.000Z"
    }
  ]
}
```

---

### 5. Get Single Payment Record

**Request**
```http
GET /api/bill-avenue/payments/:id
```

**Success Response `200`**
```json
{
  "success": true,
  "data": { ... }  // Single BillAvenuePayment record
}
```

**Error Responses**
- `404` — record not found
- `403` — forbidden (trying to access another user's record)

---

### 6. Check Transaction Status

Use this to verify a transaction outcome if the payment response was ambiguous or a network error occurred.

**Request**
```http
POST /api/bill-avenue/transaction-status
Content-Type: application/json
Authorization: Bearer <token>
```

**Body**
```json
{
  "transactionRefId": "BA20240328123456"
}
```

**Success Response `200`**
```json
{
  "success": true,
  "data": { ... }  // Parsed BillAvenue transaction status response
}
```

---

### 7. Register Complaint

Raise a complaint for a failed or disputed transaction.

**Request**
```http
POST /api/bill-avenue/complaint
Content-Type: application/json
Authorization: Bearer <token>
```

**Body**
```json
{
  "billerId": "HDFC000CC00ANZ",
  "transactionRefId": "BA20240328123456",
  "reason": "Transaction Failed",
  "description": "Amount debited but payment not reflected"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `billerId` | string | Yes | Biller ID |
| `transactionRefId` | string | Yes | Transaction reference from BillAvenue |
| `reason` | string | No | Short reason (default: `"Transaction Failed"`) |
| `description` | string | No | Detailed description |

**Success Response `200`**
```json
{
  "success": true,
  "data": { ... }  // Parsed BillAvenue complaint response
}
```

---

## Recommended UI Flow

```
[1] Select Biller
        ↓
[2] Enter Customer Details (customerParams)
        ↓
[3] Enter Amount  ──→  [Optional: Fetch Bill to confirm due amount]
        ↓
[4] Review: Amount + Service Charge + Biller Name
        ↓
[5] Confirm & Pay  ──→  POST /api/bill-avenue/pay
        ↓
[6] Show Result (success/failure + transactionRefId)
        ↓
    (on failure) ──→  [Check Status] or [Register Complaint]
```

---

## Wallet Balance & Charge Logic

The server enforces a **minimum balance** check before every payment:

```
minimumRequired = txnAmount + serviceCharge + ₹30 (buffer)
```

- Service charge is calculated from the `BbpsCcChargeRule` table (same rules as BBPS CC charges).
- If the balance is insufficient, the API returns `400` with `currentBalance`, `requiredBalance`, and `requiredCharge`.
- Show the agent their current balance and the required minimum before allowing them to submit a payment.

---

## Response Code Reference

| Code | Meaning |
|------|---------|
| `000` | Success |
| Any other | Failure — display `data` details or prompt to check status |

---

## Error Handling

| HTTP Status | Meaning | Suggested UI Action |
|-------------|---------|---------------------|
| `400` | Validation error / insufficient balance | Show the `message` field to the agent |
| `401` | Unauthenticated | Redirect to login |
| `403` | Forbidden | Show "Access denied" |
| `404` | Record not found | Show "Not found" |
| `500` | Server/API error | Show generic error; offer "Check Status" button |

For `500` errors on the pay endpoint, the server **automatically reverses** the wallet debit. Instruct agents to use "Check Transaction Status" before retrying.

---

## Payment Record Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Internal record ID |
| `user_id` | integer | Agent/user ID |
| `biller_id` | string | BillAvenue biller ID |
| `customer_params` | JSON | Customer identifiers used for the transaction |
| `transaction_amount` | decimal | Amount paid (INR) |
| `payment_mode` | string | Payment mode (e.g. `Cash`) |
| `transaction_ref_id` | string | BillAvenue transaction reference |
| `status` | string | `pending` / `success` / `failed` |
| `response_code` | string | BillAvenue response code |
| `charge_amount` | decimal | Service charge deducted |
| `response` | JSON | Full raw response from BillAvenue |
| `createdAt` | datetime | Record creation time |
