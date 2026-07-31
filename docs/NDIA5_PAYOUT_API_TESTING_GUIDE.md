# NDIA5 Payout API Testing Guide

This guide provides comprehensive documentation and cURL / Postman request structures for testing the **NDIA5 Payout Gateway** integrated into `POS-SERVER`.

---

## 📌 Overview & Base URLs

### Base URLs
* **Production Live Server**: `https://api.abheepay.com`
* **Local Development**: `http://localhost:5003` (or `http://localhost:5000`)

### Authentication & Headers
All requests (except authentication token generation) require a valid **POS Server JWT Bearer Token**:

```http
Authorization: Bearer <YOUR_POS_SERVER_JWT_TOKEN>
Content-Type: application/json
```

---

## 🚀 API Endpoints

---

### 1️⃣ Initiate Payout
Initiates a new payout via NDIA5 gateway.

> [!NOTE]
> **Automatic Pre-Check:** Before processing, this endpoint automatically checks the company's NDIA5 wallet balance.
> * If company balance is **insufficient**, it rejects the payout with `HTTP 400`: `"Server downtime, please try after 10 min"` and logs `insufficient company balance` to `logs/india5.log`.
> * If company balance is **sufficient**, it initiates the IMPS/NEFT/RTGS transfer.

* **HTTP Method**: `POST`
* **Endpoints**: 
  * `POST /api/ndia5/payout/initiate`
  * `POST /api/india5/payout/initiate`

#### **Request Body (JSON):**
```json
{
  "amount": 10,
  "channel": "IMPS",
  "payeeName": "John Doe",
  "bankAccount": "123456789012",
  "ifsc": "SBIN0001234",
  "customerMobile": "9876543210",
  "customerName": "Customer Name",
  "webhookUrl": "https://yourdomain.com/webhook"
}
```

#### **cURL Example:**
```bash
curl -X POST "https://api.abheepay.com/api/ndia5/payout/initiate" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10,
    "channel": "IMPS",
    "payeeName": "John Doe",
    "bankAccount": "123456789012",
    "ifsc": "SBIN0001234",
    "customerMobile": "9876543210",
    "customerName": "Customer Name"
  }'
```

#### **Response (Success - 200 OK):**
```json
{
  "success": true,
  "message": "NDIA5 Payout initiated successfully",
  "data": {
    "payoutId": 105,
    "referenceId": "1785219658250",
    "providerTransactionId": "APU219344",
    "status": "PENDING",
    "serviceCharge": 2,
    "rawResponse": {
      "meta": { "response_code": "ND_000", "message": "SUCCESS" },
      "data": {
        "transaction_id": "APU219344",
        "merchant_reference_id": "1785219658250",
        "status": "PENDING",
        "service_charge": 2,
        "created_at": "2026-07-28T11:50:59+05:30",
        "channel_type": "IMPS"
      },
      "errors": null
    }
  }
}
```

#### **Response (Rejection - Insufficient Company Balance - 400 Bad Request):**
```json
{
  "success": false,
  "message": "Server downtime, please try after 10 min"
}
```

---

### 2️⃣ Check Payout Status
Queries the latest transaction status directly from the NDIA5 Gateway and updates the POS database.

* **HTTP Method**: `POST` or `GET`
* **Endpoints**: 
  * `POST /api/ndia5/payout/status`
  * `GET /api/ndia5/payout/status?referenceId=1785219658250`

#### **Request Body (JSON for POST):**
```json
{
  "referenceId": "1785219658250"
}
```

#### **cURL Example:**
```bash
curl -X POST "https://api.abheepay.com/api/ndia5/payout/status" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "referenceId": "1785219658250"
  }'
```

#### **Response (200 OK):**
```json
{
  "success": true,
  "message": "NDIA5 Payout Status fetched successfully",
  "data": {
    "payoutId": 105,
    "referenceId": "1785219658250",
    "status": "PENDING",
    "serviceCharge": 2,
    "rawResponse": {
      "meta": { "responseCode": "ND_000", "message": "SUCCESS" },
      "data": {
        "transactionId": 219344,
        "merchantReferenceId": "1785219658250",
        "status": "PENDING",
        "serviceCharge": 2
      },
      "errors": null
    }
  }
}
```

---

### 3️⃣ Check NDIA5 Provider Balance (Admin Only)
Fetches the current NDIA5 company account balance from the provider gateway.

> [!IMPORTANT]
> **Admin Protection:** This endpoint is strictly restricted to users with the `admin` role. Non-admin users will receive `HTTP 403 Forbidden`.

* **HTTP Method**: `POST` or `GET`
* **Endpoints**: 
  * `POST /api/ndia5/payout/balance`
  * `GET /api/ndia5/payout/balance`

#### **Request Body (JSON - Optional):**
```json
{
  "accountNumber": "123456789012",
  "ifsc": "SBIN0001234"
}
```

#### **cURL Example:**
```bash
curl -X POST "https://api.abheepay.com/api/ndia5/payout/balance" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

#### **Response (Admin - 200 OK):**
```json
{
  "success": true,
  "message": "NDIA5 balance fetched successfully",
  "data": {
    "success": true,
    "rawResponse": 20000,
    "balance": 20000
  }
}
```

#### **Response (Non-Admin - 403 Forbidden):**
```json
{
  "success": false,
  "message": "Access denied: Self balance check is restricted to Admin only"
}
```

---

### 4️⃣ Manual Refund Payout
Manually processes wallet refund for a `FAILED` NDIA5 payout transaction.

> [!WARNING]
> **Manual Refund Policy:** Automatic refunds are disabled for NDIA5 payouts. If a payout fails, an authorized employee/admin must call this endpoint to trigger a wallet refund.

* **HTTP Method**: `POST`
* **Endpoint**: `POST /api/ndia5/payout/manual-refund`

#### **Request Body (JSON):**
```json
{
  "reference_id": "1785219658250"
}
```

#### **cURL Example:**
```bash
curl -X POST "https://api.abheepay.com/api/ndia5/payout/manual-refund" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reference_id": "1785219658250"
  }'
```

#### **Response (200 OK):**
```json
{
  "success": true,
  "message": "NDIA5 manual refund executed successfully.",
  "refundCreated": true,
  "refundAmount": 10,
  "payoutTransactionId": 105
}
```

---

### 5️⃣ Get Payout Audit Logs
Retrieves historical audit entries for a specific NDIA5 payout transaction.

* **HTTP Method**: `GET`
* **Endpoint**: `GET /api/ndia5/payout/audit-logs/by-payout?reference_id=1785219658250`

#### **cURL Example:**
```bash
curl -X GET "https://api.abheepay.com/api/ndia5/payout/audit-logs/by-payout?reference_id=1785219658250" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 📁 Logs & Background Cron Jobs

### 1. Request & Response Logging (`logs/india5.log`)
All API calls (**Login**, **Balance Check**, **Initiate Payout**, **Status Check**) automatically append structured entries to `logs/india5.log`:

```json
[2026-07-28T06:45:53.690Z] [INITIATE_PAYOUT_REJECTED] {
  "timestamp": "2026-07-28T06:45:53.690Z",
  "api": "INITIATE_PAYOUT_REJECTED",
  "error": "insufficient company balance",
  "requestedAmount": 9999999,
  "availableCompanyBalance": 20000,
  "balanceCheckFailed": false
}
```

### 2. Cron Resolver (`cron/resolvePendingNdia5.js`)
* **Schedule**: Every 3 minutes (`0 */3 * * * *`).
* **Logs**: Written to `logs/india5-payout-cron.log`.
* **Behavior**: Polling scans `PENDING` transactions older than 3 minutes, updates DB state to `SUCCESS` or `FAILED`, and logs `PayoutAuditLog` entries without auto-refunding.
