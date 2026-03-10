# CredXPay Payout API Documentation

This document describes the HTTP routes used by the frontend to integrate the CredXPay payout feature. All endpoints are mounted under the `/payout/credxpay` base path on the server.

> **Authentication**: All routes require a valid JWT in the `Authorization` header (`Bearer <token>`). The `validateToken` middleware enforces this.

---

## 1. Finalize Payout

**Endpoint:** `POST /payout/credxpay`

This route initiates a payout request on behalf of a user to one of their verified beneficiaries. The request is processed asynchronously; the client should display a confirmation after submission and monitor the status via other means (not part of this API).

### Request Body (JSON)

```json
{
  "user_id": 123,
  "beneficiary_id": 456,
  "amount": 2500.50,
  "tpin": "1234",
  "latitude": 12.34567,           // optional
  "longitude": 76.54321,          // optional
  "purpose": "Loan repayment"   // optional
}
```

- `user_id` **(required)**: numeric ID of the initiating user (extracted from token in most flows).
- `beneficiary_id` **(required)**: ID of a beneficiary previously created and verified.
- `amount` **(required)**: payout amount (positive number).
- `tpin` **(required)**: user’s transaction PIN.
- `latitude`, `longitude`, `purpose` are optional metadata fields stored with the request.

### Success Response (HTTP 200)

```json
{
  "success": true,
  "message": "Transaction submitted",
  "requestId": "PX1001"
}
```

- `requestId` is the internal reference ID for the payout. Use it for tracking or debugging.

### Error Responses

Common error scenarios:

- `400 Bad Request` – missing/invalid fields, insufficient wallet balance, beneficiary not verified, invalid TPIN, expired TPIN, etc.
- `401 Unauthorized` – missing or invalid JWT, or `user_id` not provided.
- `404 Not Found` – beneficiary or T-PIN record not found.
- `500 Internal Server Error` – unexpected errors during processing.

The body will still be JSON with `{ success: false, message: "..." }`.

---

## 2. Beneficiary Management

These routes are mounted under `/payout/credxpay/beneficiaries` and allow a user to manage their payout beneficiaries. All operations require authentication.

### 2.1 Create Beneficiary

**Endpoint:** `POST /payout/credxpay/beneficiaries`

#### Request Body

```json
{
  "user_id": 123,
  "name": "John Doe",
  "account_number": "012345678901",
  "ifsc_code": "HDFC0001234",
  "bank_name": "HDFC Bank",
  "branch_name": "MG Road",
  "mobile": "9876543210",
  "email": "john@example.com"
}
```

- `user_id`, `name`, `account_number`, `ifsc_code`, and `bank_name` are required.
- `branch_name`, `mobile`, and `email` are optional.

#### Success ([32mHTTP 200[0m)

```json
{
  "success": true,
  "data": {
    "id": 456,
    "user_id": 123,
    "name": "John Doe",
    "account_number": "012345678901",
    "ifsc_code": "HDFC0001234",
    "bank_name": "HDFC Bank",
    "branch_name": "MG Road",
    "mobile": "9876543210",
    "email": "john@example.com",
    "is_verified": false,
    "createdAt": "2025-05-01T10:00:00.000Z",
    "updatedAt": "2025-05-01T10:00:00.000Z"
  }
}
```

The `is_verified` flag starts as `false`; some external process is responsible for verification.

### 2.2 List Beneficiaries

**Endpoint:** `GET /payout/credxpay/beneficiaries/:user_id`

- Replace `:user_id` with the numeric user ID.
- Returns all beneficiaries for that user.

#### Success Response

```json
{
  "success": true,
  "data": [ /* array of beneficiary objects */ ]
}
```

### 2.3 Update Beneficiary

**Endpoint:** `PUT /payout/credxpay/beneficiaries/:id`

- `:id` is the beneficiary record ID.
- Body may contain any updatable fields (name, account_number, ifsc_code, bank_name, branch_name, mobile, email).

#### Success Response

```json
{
  "success": true,
  "data": { /* updated beneficiary object */ }
}
```

### 2.4 Delete Beneficiary

**Endpoint:** `DELETE /payout/credxpay/beneficiaries/:id`

- `:id` is the beneficiary ID to remove.

#### Success Response

```json
{
  "success": true,
  "message": "Deleted"
}
```

#### Errors

- `404 Not Found` if the beneficiary does not exist.

---

## Notes for Frontend Integration

1. **Include JWT** on every request. The server reads user information from the token; `user_id` in the body may be validated against the token payload.
2. **Error handling**: always check `success` field and display `message` to the user.
3. **TPIN validation**: the payout endpoint expects the user's current T-PIN; frontend should collect this securely.
4. **Beneficiary verification**: only verified beneficiaries can be used for payouts; creation endpoint returns `is_verified:false`. The frontend should abstract the verification status and disallow selections until verification completes.

---

Add this file to the docs folder and share with the frontend team. Adjust examples or status codes if future backend changes occur.