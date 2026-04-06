# POS Server — Complete API Documentation

> **Base URL:** `http://<host>:<port>`  
> **Default Port:** `5000`  
> **Authentication:** All protected routes require a `Bearer` token in the `Authorization` header.  
> `Authorization: Bearer <jwt_token>`  
> Tokens are obtained from the Login endpoint and expire in **5 hours**.

---

## Table of Contents

1. [Authentication & Users](#1-authentication--users)
2. [Admin](#2-admin)
3. [Franchise](#3-franchise)
4. [Merchant](#4-merchant)
5. [POS Machine](#5-pos-machine)
6. [Wallet Transactions](#6-wallet-transactions)
7. [Ledger (Passbook)](#7-ledger-passbook)
8. [Dashboard](#8-dashboard)
9. [POS Transactions (Legacy)](#9-pos-transactions-legacy)
10. [POS Charge (Legacy Slabs)](#10-pos-charge-legacy-slabs)
11. [POS Charge Rules (New Engine)](#11-pos-charge-rules-new-engine)
12. [Charge Types & Slabs](#12-charge-types--slabs)
13. [Commission](#13-commission)
14. [Rental](#14-rental)
15. [Service Fee](#15-service-fee)
16. [Payout Charge](#16-payout-charge)
17. [POS Transaction Charge](#17-pos-transaction-charge)
18. [Reports](#18-reports)
19. [KYC](#19-kyc)
20. [BBPS — Credit Card Bill Payment](#20-bbps--credit-card-bill-payment)
21. [BranchX Payments (v2)](#21-branchx-payments-v2)
22. [CredXPay Payout](#22-credxpay-payout)
23. [Razorpay Webhooks & Notifications](#23-razorpay-webhooks--notifications)
24. [Direct Login (Admin)](#24-direct-login-admin)
25. [Company Name](#25-company-name)
26. [Complaints](#26-complaints)
27. [TPIN](#27-tpin)
28. [Credit Bill Payment (BillAvenue)](#28-credit-bill-payment-billavenue)

---

## 1. Authentication & Users

**Base path:** `/api/user`

---

### POST `/api/user/login`
**Auth:** Public

**Request Body** (`application/json`):
| Field | Type | Required | Description |
|---|---|---|---|
| `mobile_number` | string | Yes | Registered mobile number |
| `password` | string | Yes | Account password |

**Response `200`:**
```json
{
  "accessToken": "<jwt_token>",
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "mobile_number": "9876543210",
    "role": "merchant",
    "ipay_outlet_id": null
  }
}
```

**Response `401`:** Invalid credentials.

---

### POST `/api/user/register`
**Auth:** `Bearer token` (Admin or Franchise)  
**Content-Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Email address |
| `password` | string | Yes | Password |
| `mobile_number` | string | Yes | Mobile number |
| `role` | string | Yes | `merchant` \| `franchise` \| `admin` \| `employee` |
| `employee_access_role_id` | number | Yes for `employee` | Admin-managed employee access role ID |
| `company_or_shop_name` | string | No | Business name |
| `bank_passbook` | file | Yes | Bank passbook/statement image. Not required for `employee`. |
| `pan_photo` | file | No | PAN card image |
| `aadhar_photo` | file | No | Aadhaar front image |
| `aadhar_back_photo` | file | No | Aadhaar back image |
| `shop_photo` | file | No | Shop front image |

**Response `201`:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": 5,
    "username": "APM00005",
    "abheepay_id": "APM00005",
    "role": "employee",
    "employee_access_role_id": 3,
    "employee_access_role": {
      "id": 3,
      "name": "Accounts",
      "slug": "accounts",
      "status": "active",
      "description": null
    },
    "permissions": ["wallet.read", "wallet.credit"]
  }
}
```

**Response `409`:** Mobile/email already registered.

---

### POST `/api/user/send-otp`
**Auth:** `Bearer token`

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `mobile_number` | string | Yes | Mobile number to send OTP to |

**Response `200`:**
```json
{ "message": "OTP sent successfully" }
```

---

### POST `/api/user/verify-otp`
**Auth:** Public

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `mobile_number` | string | Yes | Mobile number |
| `otp` | string | Yes | OTP code received |

**Response `200`:**
```json
{ "success": true, "message": "OTP verified" }
```

---

### POST `/api/user/forgot-password`
**Auth:** Public

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `mobile_number` | string | Yes | Registered mobile number |

**Response `200`:**
```json
{ "message": "OTP sent to your mobile number" }
```

---

### POST `/api/user/reset-password`
**Auth:** Public

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `mobile_number` | string | Yes | Mobile number |
| `otp` | string | Yes | OTP code |
| `newPassword` | string | Yes | New password |

**Response `200`:**
```json
{ "success": true, "message": "Password reset successfully" }
```

---

### GET `/api/user/`
**Auth:** `Bearer token`

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Records per page (default: 10) |
| `status` | string | No | Filter by status (`active`, `inactive`) |
| `role` | string | No | Filter by role (`merchant`, `franchaise`, `admin`, `employee`) |

> Franchise users only see their own merchants. Admin sees all. Employee users need explicit permissions for list/search access.

**Response `200`:**
```json
{
  "success": true,
  "message": "Users retrieved successfully",
  "data": [
    {
      "id": 1,
      "name": "...",
      "email": "...",
      "mobile_number": "...",
      "role": "merchant",
      "status": "active",
      "wallet": "1000.00",
      "pos_machine_count": 2
    }
  ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

---

### GET `/api/user/current`
**Auth:** `Bearer token`

Returns the currently authenticated user's profile.

**Response `200`:**
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john@example.com",
  "mobile_number": "9876543210",
  "role": "employee",
  "wallet": "1500.00",
  "employee_access_role_id": 3,
  "employee_access_role": {
    "id": 3,
    "name": "Accounts",
    "slug": "accounts",
    "status": "active",
    "description": null
  },
  "permissions": ["wallet.read", "wallet.credit"]
}
```

---

### GET `/api/user/:id`
**Auth:** `Bearer token`

Employee users require the `users.read` permission.

**Path Params:** `id` — User ID

**Query Params:**
| Param | Type | Required | Description |
|---|---|---|---|
| `is_pos_detail_required` | boolean | No | If `true`, includes assigned POS machines |

**Response `200`:**
```json
{
  "user": { "id": 1, "name": "...", "role": "merchant", "..." : "..." },
  "charges": {
    "pos_transaction_charges": [],
    "payoutCharges": [],
    "rentals": []
  },
  "pos_details": []
}
```

---

### PUT `/api/user/update-password`
**Auth:** `Bearer token`

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `id` | number | Yes (admin only) | Target user ID |
| `newPassword` | string | Yes | New password |
| `currentPassword` | string | Yes (non-admin) | Current password |

**Response `200`:**
```json
{ "success": true, "message": "Password updated successfully" }
```

---

### PUT `/api/user/:id`
**Auth:** `Bearer token`  
**Content-Type:** `multipart/form-data`

> Admin can edit any user. Franchise can edit self or own merchants. Merchant can only edit self. Employee requires `users.update`.

**Form Fields (all optional):**
| Field | Type | Description |
|---|---|---|
| `name` | string | Full name |
| `email` | string | Email address |
| `mobile_number` | string | Mobile number |
| `organization_name` | string | Business name |
| `dob` | string | Date of birth (YYYY-MM-DD) |
| `gender` | string | Gender |
| `address1` | string | Address line 1 |
| `address2` | string | Address line 2 |
| `city` | string | City |
| `district` | string | District |
| `pincode` | string | Pin code |
| `state` | string | State |
| `country` | string | Country |
| `pan_number` | string | PAN number |
| `aadhar_number` | string | Aadhaar number |
| `pan_photo` | file | PAN card image |
| `aadhar_photo` | file | Aadhaar image |
| `bank_passbook` | file | Bank passbook image |
| `settlement_type` | string | Admin-only: `default` \| `instant` |
| `role` | string | Admin-only role update (`merchant` \| `franchise` \| `admin` \| `employee`) |
| `employee_access_role_id` | number | Admin-only employee access role assignment |

**Response `200`:**
```json
{ "success": true, "message": "User updated successfully", "data": { "..." : "..." } }
```

> Direct employee `permissions` input is deprecated. Assign `employee_access_role_id` instead.

---

### POST `/api/user/tpin`
**Auth:** `Bearer token`

Generates a new TPIN for the authenticated user.

**Response `200`:**
```json
{ "success": true, "message": "TPIN generated successfully" }
```

---

### POST `/api/user/tpin/verify`
**Auth:** `Bearer token`

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `tpin` | string | Yes | TPIN to verify |

**Response `200`:**
```json
{ "success": true, "message": "TPIN verified" }
```

---

## 2. Admin

**Base path:** `/api/admin`

---

### GET `/api/admin/`
**Auth:** Public (no token required — dashboard summary)

**Response `200`:**
```json
{
  "message": "Admin Dashboard Data Fetched Successfully",
  "data": {
    "posMachines": { "active": 10, "inactive": 2 },
    "merchants": { "count": 50 },
    "franchaises": { "count": 5 }
  }
}
```

---

### GET `/api/admin/merchants/unassigned`
**Auth:** `Bearer token` (Admin only)

Returns merchants that have no franchise assigned (`franchaise_id IS NULL`).

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 20, max: 100 |
| `status` | string | No | `active` \| `inactive` |
| `search` | string | No | Partial match on name, email, or mobile |

**Response `200`:**
```json
{
  "success": true,
  "message": "Unassigned merchants fetched successfully.",
  "data": {
    "total": 12,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "merchants": [ { "id": 1, "name": "...", "email": "...", "mobile_number": "..." } ]
  }
}
```

---

### POST `/api/admin/wallet/credit`
**Auth:** `Bearer token` (Admin only)

Directly adds money to a user's wallet.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Target user ID |
| `amount` | number | Yes | Amount to credit (positive) |
| `reason` | string | No | Reason for adjustment |

**Response `201`:**
```json
{
  "success": true,
  "message": "Wallet credited successfully.",
  "data": {
    "ledger_id": 101,
    "user_id": 5,
    "user_name": "John Doe",
    "amount": 500.00,
    "balance_before": 1000.00,
    "balance_after": 1500.00,
    "description": "Admin credit: top up"
  }
}
```

---

### POST `/api/admin/wallet/debit`
**Auth:** `Bearer token` (Admin only)

Directly removes money from a user's wallet.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Target user ID |
| `amount` | number | Yes | Amount to debit (positive) |
| `reason` | string | No | Reason for adjustment |

**Response `200`:** Same structure as credit response.

---

### POST `/api/admin/wallet/reconcile/:userId`
**Auth:** `Bearer token` (Admin only)

Recomputes the wallet balance from ledger SUM(credit - debit) and corrects drift.

**Path Params:** `userId` — User ID

**Response `200`:**
```json
{
  "success": true,
  "message": "Wallet reconciled",
  "data": {
    "user_id": 5,
    "old_balance": 950.00,
    "new_balance": 1000.00,
    "adjusted": true
  }
}
```

---

### POST `/api/admin/dl-token`
**Auth:** `Bearer token` (Admin only)

Generates a direct-login token. Returns the raw token **once only** — store it.

**Response `201`:**
```json
{
  "success": true,
  "message": "Direct-login token generated. Valid for 120 minutes.",
  "data": {
    "dl_token": "<raw_hex_token>",
    "expires_at": "2026-03-18T12:00:00.000Z",
    "ttl_minutes": 120,
    "warning": "Store this token in your session. It cannot be retrieved again."
  }
}
```

---

### GET `/api/admin/dl-token/status`
**Auth:** `Bearer token` (Admin only)

**Response `200`:**
```json
{
  "success": true,
  "active": true,
  "expires_at": "2026-03-18T12:00:00.000Z",
  "used_count": 2
}
```

---

### DELETE `/api/admin/dl-token`
**Auth:** `Bearer token` (Admin only)

Revokes the active direct-login token immediately.

**Response `200`:**
```json
{ "success": true, "message": "Direct-login token revoked." }
```

---

### POST `/api/admin/direct-login`
**Auth:** Public (DL token is the credential)

Exchanges a DL token for a standard user JWT without knowing the user's password.

Target roles allowed for direct login: `merchant`, `franchaise`, `employee`

Admin accounts are still protected and cannot be direct-logged-in.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `dl_token` | string | Yes | Raw direct-login token from admin |
| `user_id` | number | Yes | ID of the user to log in as |

**Response `200`:**
```json
{
  "success": true,
  "message": "Logged in successfully",
  "accessToken": "<5h user JWT>",
  "user": { "id": 5, "name": "...", "role": "merchant" }
}
```

---

### `/api/admin/employee-access-roles`
**Auth:** `Bearer token` (Admin only)

Manage reusable access-role templates for employee users.

Available endpoints:
- `GET /api/admin/employee-access-roles/meta`
- `GET /api/admin/employee-access-roles`
- `POST /api/admin/employee-access-roles`
- `GET /api/admin/employee-access-roles/:id`
- `PUT /api/admin/employee-access-roles/:id`
- `DELETE /api/admin/employee-access-roles/:id`

**Create/Update body fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Admin-facing role name |
| `slug` | string | No | Stable key; auto-generated from `name` if omitted |
| `description` | string | No | Optional description |
| `status` | string | No | `active` \| `inactive` |
| `permissions` | array/string | Yes | JSON array of supported employee permission slugs |

**Delete behavior:**
- delete is blocked if the role is assigned to any employee user

---

## 3. Franchise

**Base path:** `/api/franchaise`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/franchaise/:id/onboard`
**Auth:** `Bearer token`  
**Content-Type:** `multipart/form-data`

Onboards an existing user as a franchise.

**Path Params:** `id` — User ID to onboard

**Form Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `organization_name` | string | No | Organization name |
| `dob` | string | No | Date of birth |
| `gender` | string | No | Gender |
| `address1` | string | No | Address line 1 |
| `address2` | string | No | Address line 2 |
| `city` | string | No | City |
| `district` | string | No | District |
| `pincode` | string | No | Pin code |
| `state` | string | No | State |
| `country` | string | No | Country |
| `pan_number` | string | No | PAN number |
| `aadhar_number` | string | No | Aadhaar number |
| `pan_photo` | file | No | PAN card image |
| `aadhar_photo` | file | No | Aadhaar card image |
| `shop_photo` | file | No | Shop photo |

**Response `200`:**
```json
{ "id": 3 }
```

---

### GET `/api/franchaise/`
**Auth:** `Bearer token`

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | `active` \| `inactive` (default: `active`) |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 10 |

**Response `200`:**
```json
{
  "success": true,
  "message": "Users retrieved successfully",
  "data": [ { "id": 1, "name": "...", "role": "franchaise" } ],
  "pagination": { "total": 5, "page": 1, "limit": 10, "totalPages": 1 }
}
```

---

### GET `/api/franchaise/:id`
**Auth:** `Bearer token`

**Response `200`:** Full franchise user object.

---

### PUT `/api/franchaise/:id/status`
**Auth:** `Bearer token`

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | Yes | `active` \| `inactive` |

**Response `200`:**
```json
{ "message": "Status updated", "id": 3 }
```

---

## 4. Merchant

**Base path:** `/api/merchant`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/merchant/:id/onboard`
**Auth:** `Bearer token`  
**Content-Type:** `multipart/form-data`

Onboards an existing user as a merchant.

**Path Params:** `id` — User ID

**Form Fields:** Same as franchise onboard above (pan_photo, aadhar_photo, shop_photo + profile fields).

**Response `200`:**
```json
{ "id": 7 }
```

---

### GET `/api/merchant/`
**Auth:** `Bearer token`

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | Default: `active` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 10 |

> Franchise users only see their own merchants.

**Response `200`:** Paginated merchant list.

---

### GET `/api/merchant/transaction-charges`
**Auth:** `Bearer token`

Lists transaction charges deducted per Razorpay transaction.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | No | Filter by merchant (admin only) |
| `pos_machine_id` | number | No | Filter by POS machine |
| `start_date` | string | No | Start date `YYYY-MM-DD` |
| `end_date` | string | No | End date `YYYY-MM-DD` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 10 |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "merchant_id": 5,
      "razorpay_transaction_id": "TXN123",
      "transaction_amount": "1000.00",
      "charge_amount": "20.00",
      "gst_amount": "3.60",
      "net_amount": "976.40",
      "charge_rate": "2.00",
      "payment_method": "CARD",
      "payment_card_type": "CREDIT",
      "payment_card_brand": "VISA"
    }
  ],
  "pagination": { "total": 10, "page": 1, "limit": 10, "totalPages": 1 },
  "summary": {
    "total_transactions": 10,
    "total_transaction_amount": 10000,
    "total_charge_amount": 200,
    "total_net_amount": 9800
  }
}
```

---

### GET `/api/merchant/:id`
**Auth:** `Bearer token`

**Response `200`:** Full merchant user object.

---

### PUT `/api/merchant/:id/status`
**Auth:** `Bearer token`

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | Yes | `active` \| `inactive` |

**Response `200`:**
```json
{ "message": "Status updated", "id": 7 }
```

---

### PUT `/api/merchant/:id/ipay-outlet`
**Auth:** `Bearer token` (Admin only)

Sets the InstantPay outlet ID for a merchant (used for KYC/payouts).

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `ipay_outlet_id` | number | Yes | InstantPay outlet ID |

**Response `200`:**
```json
{ "success": true, "message": "Outlet ID updated" }
```

---

## 5. POS Machine

**Base path:** `/api/pos-machine`  
**Auth:** All routes require `Bearer token`

---

### GET `/api/pos-machine/`
**Auth:** `Bearer token`

All POS machines (admin), or scoped by role.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | `active` \| `in_active` |
| `tid_number` | string | No | Filter by TID |
| `mid_number` | string | No | Filter by MID |
| `device_serial_number` | string | No | Filter by serial |
| `razorpay_id` | string | No | Filter by Razorpay ID |
| `company_name` | string | No | Filter by company name |
| `is_pos_asigned` | boolean | No | Filter by assignment status |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 10 |

**Response `200`:**
```json
{
  "success": true,
  "list": [
    {
      "id": 1,
      "tid_number": "TID001",
      "mid_number": "MID001",
      "device_serial_number": "SN001",
      "razorpay_id": "rzp_123",
      "status": "active",
      "company_name": "ABC Corp",
      "assigned_user": { "id": 5, "name": "John", "email": "j@e.com" },
      "franchaise_detail": { "id": 2, "name": "Franchise A" }
    }
  ],
  "pagination": { "total": 20, "page": 1, "limit": 10, "totalPages": 2 }
}
```

---

### GET `/api/pos-machine/list`
**Auth:** `Bearer token`

Role-based filtered list with pagination. Same query params as above.

---

### POST `/api/pos-machine/`
**Auth:** `Bearer token`

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `tid_number` | string | Yes | Terminal ID |
| `mid_number` | string | Yes | Merchant ID |
| `device_serial_number` | string | Yes | Device serial number |
| `company_name` | string | No | Company name |
| `razorpay_id` | string | No | Razorpay terminal ID |
| `remarks` | string | No | Notes |

**Response `201`:**
```json
{ "success": true, "message": "POS machine created", "id": 1 }
```

---

### POST `/api/pos-machine/bulk-create`
**Auth:** `Bearer token`  
**Content-Type:** `multipart/form-data`

Upload a CSV file to create multiple POS machines at once.

**Form Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | CSV file with columns: `tid_number`, `mid_number`, `device_serial_number`, `company_name` |

**Response `201`:**
```json
{ "success": true, "message": "Bulk create completed", "created": 20, "skipped": 2 }
```

---

### POST `/api/pos-machine/assign`
**Auth:** `Bearer token`

Assign a POS machine to a user by ID.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `pos_machine_id` | number | Yes | POS machine ID |
| `user_id` | number | Yes | User ID to assign to |

**Response `200`:**
```json
{ "success": true, "message": "POS machine assigned" }
```

---

### POST `/api/pos-machine/assign-to-merchant`
**Auth:** `Bearer token`

Assign a single POS machine to a merchant.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `pos_machine_id` | number | Yes | POS machine ID |
| `merchant_id` | number | Yes | Merchant user ID |

**Response `200`:**
```json
{ "success": true, "message": "POS machine assigned to merchant" }
```

---

### PUT `/api/pos-machine/activate/:id`
**Auth:** `Bearer token`

**Path Params:** `id` — POS machine ID

**Response `200`:**
```json
{ "success": true, "message": "POS machine activated" }
```

---

### PUT `/api/pos-machine/de-activate/:id`
**Auth:** `Bearer token`

**Response `200`:**
```json
{ "success": true, "message": "POS machine deactivated" }
```

---

### PUT `/api/pos-machine/unassign/:id`
**Auth:** `Bearer token`

Removes assignment from a POS machine.

**Response `200`:**
```json
{ "success": true, "message": "POS machine unassigned" }
```

---

### PUT `/api/pos-machine/delivered/:id`
**Auth:** `Bearer token`

Marks machine as delivered.

**Response `200`:**
```json
{ "success": true, "message": "Marked as delivered" }
```

---

### PUT `/api/pos-machine/returned-initiated/:id`
**Auth:** `Bearer token`

Marks machine return as initiated.

**Response `200`:**
```json
{ "success": true, "message": "Return initiated" }
```

---

### GET `/api/pos-machine/:id`
**Auth:** `Bearer token`

**Response `200`:** Full POS machine object.

---

### PUT `/api/pos-machine/:id`
**Auth:** `Bearer token`

Update POS machine fields.

**Request Body** (all optional):
| Field | Type | Description |
|---|---|---|
| `tid_number` | string | Terminal ID |
| `mid_number` | string | Merchant ID |
| `device_serial_number` | string | Serial number |
| `company_name` | string | Company name |
| `razorpay_id` | string | Razorpay terminal ID |
| `remarks` | string | Notes |
| `status` | string | `active` \| `in_active` |

**Response `200`:**
```json
{ "success": true, "message": "Updated" }
```

---

### DELETE `/api/pos-machine/:id`
**Auth:** `Bearer token`

**Response `200`:**
```json
{ "success": true, "message": "POS machine deleted" }
```

---

## 6. Wallet Transactions

**Base path:** `/api/wallet`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/wallet/request`
**Auth:** `Bearer token`

Request funds (wallet top-up request).

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | User requesting funds |
| `amount` | number | Yes | Amount to request |
| `reason` | string | No | Reason for request |

**Response `200`:**
```json
{ "message": "Fund Requested", "balance": "1000.00", "hold": "0.00", "id": 15 }
```

---

### POST `/api/wallet/transer/:id`
**Auth:** `Bearer token` (Admin only)

Approve and transfer a pending fund request.

**Path Params:** `id` — Wallet transaction ID to approve

**Response `200`:**
```json
{ "message": "Amount Transfered", "balance": "1500.00", "hold": "0.00" }
```

---

### POST `/api/wallet/hold/:id`
**Auth:** `Bearer token` (Admin only)

Move a pending request to hold status.

**Path Params:** `id` — Wallet transaction ID

**Response `200`:**
```json
{ "message": "Amount held", "balance": "1000.00", "hold": "500.00" }
```

---

### POST `/api/wallet/unhold/:id`
**Auth:** `Bearer token` (Admin only)

Release a held amount back to wallet.

**Path Params:** `id` — Hold transaction ID

**Response `200`:**
```json
{ "message": "Amount held", "balance": "1500.00", "hold": "0.00" }
```

---

### POST `/api/wallet/filter`
**Auth:** `Bearer token`

Filter/search wallet transactions.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | No | `request` \| `transfer` \| `hold` \| `unhold` |
| `id` | number | No | Specific transaction ID |
| `status` | string | No | `pending` \| `completed` |
| `user_id` | number | No | Filter by user |

**Response `200`:**
```json
{
  "count": 5,
  "transactions": [
    {
      "id": 15,
      "type": "request",
      "status": "pending",
      "amount": "500.00",
      "reason": "Top up",
      "requested_by": 5,
      "approved_by": null,
      "request_details": { "id": 5, "name": "John", "email": "john@e.com" },
      "approve_details": null
    }
  ]
}
```

---

### GET `/api/wallet/requests`
**Auth:** `Bearer token`

Returns all wallet transactions (unfiltered list).

**Response `200`:** Array of wallet transaction objects.

---

### GET `/api/wallet/list`
**Auth:** `Bearer token`

Role-scoped wallet transaction list.
- Admin: all transactions
- Franchise: transactions for assigned merchants
- Merchant: own transactions only

**Response `200`:**
```json
{ "count": 10, "walletTransactions": [ { "..." : "..." } ] }
```

---

### GET `/api/wallet/history/:id`
**Auth:** `Bearer token`

Single transaction history entry.

**Path Params:** `id` — Wallet transaction ID

**Response `200`:** Single wallet transaction object with user details.

---

### GET `/api/wallet/:id`
**Auth:** `Bearer token`

Get a specific wallet request by ID.

**Response `200`:** Wallet transaction object.

---

## 7. Ledger (Passbook)

**Base path:** `/api/ledger`  
**Auth:** All routes require `Bearer token`

---

### GET `/api/ledger/statement/list`
**Auth:** `Bearer token`

List wallet transaction statements.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `status` | string | No | Default: `completed` |
| `searched_role` | string | No | Admin/Franchise: filter by `merchant` role |

**Response `200`:**
```json
{
  "count": 20,
  "transactions": [ { "id": 1, "type": "request", "amount": "500.00", "status": "completed" } ]
}
```

---

### GET `/api/ledger/entries`
**Auth:** `Bearer token`

Passbook-style ledger with running balance (debit / credit / balance per entry).

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes (Admin) | Target user ID (admin required; merchant uses own) |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |
| `transaction_type` | string | No | e.g. `razorpay_charge`, `wallet_transfer_credit`, etc. |
| `status` | string | No | `completed` \| `pending` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 50 |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": 1,
        "transaction_type": "razorpay_charge",
        "description": "...",
        "debit": "20.00",
        "credit": "0.00",
        "balance_before": "1000.00",
        "balance": "980.00",
        "createdAt": "2026-03-01T10:00:00.000Z"
      }
    ],
    "pagination": { "total": 100, "page": 1, "limit": 50, "totalPages": 2 },
    "current_balance": "980.00"
  }
}
```

---

### GET `/api/ledger/entries/:id`
**Auth:** `Bearer token`

Single ledger entry with full linked source record.

**Path Params:** `id` — Ledger entry ID

**Response `200`:** Full ledger entry object with metadata.

---

## 8. Dashboard

**Base path:** `/api/dashboard`  
**Auth:** All routes require `Bearer token`

---

### GET `/api/dashboard/`
**Auth:** `Bearer token`

Role-scoped dashboard statistics (today's data).

**Response `200` (Admin):**
```json
{
  "message": "Dashboard fetched",
  "data": {
    "pos_machines": { "active": 10, "inactive": 2 },
    "merchants": { "count": 50 },
    "franchaises": { "count": 5 },
    "pos_transactions": { "total": 150000, "success": 140000, "fail": 10000 },
    "today_total_payout": 25000
  }
}
```

**Response `200` (Franchise):**
```json
{
  "data": {
    "assigned_merchants": { "count": 10 },
    "pos_machines": { "count": 8 },
    "pos_transactions": { "total": 50000, "success": 48000, "fail": 2000 },
    "today_total_payout": 5000
  }
}
```

**Response `200` (Merchant):**
```json
{
  "data": {
    "pos_transactions": { "total": 10000, "success": 9500, "fail": 500 },
    "today_total_payout": 1000
  }
}
```

---

### GET `/api/dashboard/today-payouts`
**Auth:** `Bearer token`

Today's payout list for the authenticated user.

**Response `200`:** Array of today's payout transactions.

---

## 9. POS Transactions (Legacy)

**Base path:** `/api/transaction`  
**Auth:** No token required on most routes (legacy)

---

### POST `/api/transaction/upload-csv`
**Content-Type:** `multipart/form-data`

Upload POS transaction data via CSV.

**Form Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | Yes | CSV transaction file |

**Response `200`:**
```json
{ "message": "CSV uploaded and processed" }
```

---

### GET `/api/transaction/`

List all transactions.

**Response `200`:** Array of transaction records.

---

### GET `/api/transaction/filter`

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `from_date` | string | No | `YYYY-MM-DD` |
| `to_date` | string | No | `YYYY-MM-DD` |
| `status` | string | No | Transaction status |
| `mid` | string | No | Merchant ID filter |

**Response `200`:** Filtered transaction array.

---

### GET `/api/transaction/file-uploaded`

List all uploaded CSV files.

**Response `200`:** Array of file upload records.

---

### GET `/api/transaction/:id`

Get transaction by ID.

**Response `200`:** Single transaction object.

---

## 10. POS Charge (Legacy Slabs)

**Base path:** `/api/pos-charge`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/pos-charge/default`
**Auth:** Admin only

Create a default POS charge slab.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `paymentMode` | string | No | e.g. `CARD`, `UPI`, `WALLET` |
| `paymentCardType` | string | No | `CREDIT` \| `DEBIT` |
| `paymentCardBrand` | string | No | e.g. `VISA`, `MASTERCARD` |
| `percent_fee` | number | Yes | Charge percentage (non-zero) |
| `is_active` | boolean | No | Default: `true` |

**Response `201`:**
```json
{ "message": "Default POS charge created", "record": { "id": 1, "percent_fee": "2.00" } }
```

---

### GET `/api/pos-charge/default`
**Auth:** `Bearer token`

List all default POS charge slabs.

**Response `200`:** Array of default charge records.

---

### PUT `/api/pos-charge/default/:id`
**Auth:** Admin only

Update a default POS charge. Same body as create (all fields optional).

**Response `200`:**
```json
{ "message": "Updated", "record": { "..." : "..." } }
```

---

### DELETE `/api/pos-charge/default/:id`
**Auth:** Admin only

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

### POST `/api/pos-charge/user`
**Auth:** Admin or Franchise

Link a POS charge to a user.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Target merchant/user |
| `pos_charge_default_id` | number | Yes (franchise) | Reference to default charge |
| `paymentMode` | string | No | Override payment mode |
| `percent_fee` | number | No | Override percentage |

**Response `201`:**
```json
{ "message": "User POS charge linked", "record": { "..." : "..." } }
```

---

### GET `/api/pos-charge/user`
**Auth:** `Bearer token`

List user-specific POS charge links (role-filtered).

**Response `200`:** Array of user charge records.

---

### PUT `/api/pos-charge/user/:id`
**Auth:** Admin or Franchise

**Response `200`:**
```json
{ "message": "Updated" }
```

---

### DELETE `/api/pos-charge/user/:id`
**Auth:** Admin or Franchise

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

### POST `/api/pos-charge/calculate`
**Auth:** `Bearer token`

Calculate the effective POS charge for a user and transaction.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Merchant user ID |
| `amount` | number | Yes | Transaction amount in ₹ |
| `paymentMode` | string | No | e.g. `CARD` |
| `paymentCardType` | string | No | `CREDIT` \| `DEBIT` |
| `paymentCardBrand` | string | No | e.g. `VISA` |

**Response `200`:**
```json
{
  "charge": { "percent_fee": 2.0, "fee": 20.00 },
  "source": "user_specific"
}
```

---

### GET `/api/pos-charge/razorpay-options`
**Auth:** `Bearer token`

Returns distinct field values seen in Razorpay notifications (payment modes, card types, etc.) for populating filter dropdowns.

**Response `200`:**
```json
{
  "paymentModes": ["CARD", "UPI", "WALLET"],
  "cardTypes": ["CREDIT", "DEBIT"],
  "cardBrands": ["VISA", "MASTERCARD", "RUPAY"]
}
```

---

### POST `/api/pos-charge/global-rate`
**Auth:** Admin only

Set / update the global fallback POS rate.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `rate` | number | Yes | Global rate percentage |

**Response `200`:**
```json
{ "message": "Global rate set", "rate": 2.5 }
```

---

### GET `/api/pos-charge/global-rate`
**Auth:** `Bearer token`

**Response `200`:**
```json
{ "rate": 2.5, "updatedAt": "2026-01-01T00:00:00.000Z" }
```

---

## 11. POS Charge Rules (New Engine)

**Base path:** `/api/pos-charge-rules`  
**Auth:** All routes require `Bearer token`

This is the **current recommended charge engine** (supersedes legacy slabs).

---

### POST `/api/pos-charge-rules/`
**Auth:** `Bearer token` (Admin or Franchise)

Create a new charge rule.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `payment_mode` | string | Yes | `CARD` \| `UPI` \| `WALLET` \| `CASH` \| `CHEQUE` — or `null` for wildcard |
| `card_type` | string | No | `CREDIT` \| `DEBIT` |
| `card_brand` | string | No | `VISA` \| `MASTERCARD` \| `RUPAY` \| etc. |
| `card_classification` | string | No | Card classification (e.g. `CORPORATE`) |
| `settlement_type` | string | No | `default` \| `instant` |
| `min_amount` | number | No | Min transaction amount for rule to apply |
| `max_amount` | number | No | Max transaction amount for rule to apply |
| `charge_percent` | number | Yes | Charge percentage (≥ 0) |
| `charge_flat` | number | No | Flat charge amount |
| `gst_required` | boolean | No | Whether GST applies |
| `gst_percent` | number | No | GST percentage (required when `gst_required=true`) |
| `is_active` | boolean | No | Default: `true` |
| `user_id` | number | No | Link to specific merchant user |
| `franchaise_id` | number | No | Link to specific franchise |

**Response `201`:**
```json
{
  "success": true,
  "message": "Rule created",
  "data": { "id": 10, "payment_mode": "CARD", "charge_percent": "2.00" }
}
```

---

### GET `/api/pos-charge-rules/list`
**Auth:** `Bearer token`

Generic list of all rules (backward-compatible).

**Response `200`:** Array of charge rule objects.

---

### GET `/api/pos-charge-rules/list/merchant`
**Auth:** `Bearer token`

Merchant-specific grouped list of applicable rules.

**Response `200`:** Rules grouped by payment method.

---

### GET `/api/pos-charge-rules/list/admin`
**Auth:** `Bearer token` (Franchise/Admin)

Lists admin-level rules applicable to a franchise.

**Response `200`:** Array of admin charge rules.

---

### GET `/api/pos-charge-rules/list/franchise`
**Auth:** `Bearer token` (Franchise/Admin)

Lists franchise-specific custom rules.

**Response `200`:** Array of franchise charge rules.

---

### GET `/api/pos-charge-rules/:id`
**Auth:** `Bearer token`

**Response `200`:** Single rule object.

---

### PUT `/api/pos-charge-rules/:id`
**Auth:** `Bearer token`

Update a rule. Same fields as create (all optional).

**Response `200`:**
```json
{ "success": true, "message": "Rule updated", "data": { "..." : "..." } }
```

---

### DELETE `/api/pos-charge-rules/:id`
**Auth:** `Bearer token`

**Response `200`:**
```json
{ "success": true, "message": "Rule deleted" }
```

---

### POST `/api/pos-charge-rules/calculate`
**Auth:** `Bearer token`

Calculate the charge for a given transaction against the rule engine.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Merchant/user ID |
| `amount` | number | Yes | Transaction amount |
| `payment_mode` | string | No | `CARD` \| `UPI` etc. |
| `card_type` | string | No | `CREDIT` \| `DEBIT` |
| `card_brand` | string | No | `VISA` \| `MASTERCARD` etc. |
| `settlement` | string | No | `default` \| `instant` |

**Response `200`:**
```json
{
  "success": true,
  "rule": {
    "id": 10,
    "charge_percent": "2.00",
    "gst_required": true,
    "gst_percent": "18.00"
  },
  "calculation": {
    "transaction_amount": 1000.00,
    "charge": 20.00,
    "gst_amount": 3.60,
    "net_amount": 976.40
  }
}
```

---

## 12. Charge Types & Slabs

**Base path:** `/api/charge`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/charge/type`

Create a new charge type category.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Charge type name |
| `category` | string | Yes | Category identifier |

**Response `201`:** Created charge type object.

---

### GET `/api/charge/type`

List all charge types.

**Response `200`:** Array of charge type objects.

---

### DELETE `/api/charge/type/:id`

Delete a charge type by ID.

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

### POST `/api/charge/slab`

Create a new charge slab.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `charge_type_id` | number | Yes | Related charge type ID |
| `charge_type_category` | string | Yes | Category (e.g. `branchx_payout`) |
| `min_amount` | number | No | Min amount |
| `max_amount` | number | No | Max amount |
| `flat_fee` | number | No | Flat fee |
| `percent_fee` | number | No | Percent fee |
| `is_active` | boolean | No | Default: `true` |

**Response `201`:** Created slab object.

---

### POST `/api/charge/slab/list`

Get slabs filtered by category and optional user.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `category` | string | Yes | Charge category |
| `user_id` | number | No | Filter by user |

**Response `200`:** Array of slabs.

---

### GET `/api/charge/slab/:id`

Get a slab by ID.

**Response `200`:** Single slab object.

---

### PUT `/api/charge/slab/:id`

Update a slab. Same fields as create (all optional).

**Response `200`:** Updated slab.

---

### DELETE `/api/charge/slab/:id`

Delete a slab.

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

### GET `/api/charge/slab/user/:id`

Get slabs for a specific user.

**Response `200`:** Array of slabs for the user.

---

## 13. Commission

**Base path:** `/api/commission`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/commission/default`
**Auth:** Admin only

Create a default commission slab.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Slab name |
| `min_amount` | number | No | Min transaction amount |
| `max_amount` | number | No | Max transaction amount |
| `flat_fee` | number | No | Flat commission |
| `percent_fee` | number | No | Percent commission |
| `is_active` | boolean | No | Default: `true` |

**Response `201`:** Created commission slab.

---

### GET `/api/commission/default`

List all default commission slabs.

**Response `200`:** Array of default slabs.

---

### PUT `/api/commission/default/:id`
**Auth:** Admin only

Update a default slab.

**Response `200`:** Updated slab.

---

### DELETE `/api/commission/default/:id`
**Auth:** Admin only

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

### POST `/api/commission/user`

Link/create a commission slab for a user.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Target user |
| `commission_slab_id` | number | No | Reference to default slab |
| `flat_fee` | number | No | Override flat fee |
| `percent_fee` | number | No | Override percent fee |

**Response `201`:** Created user commission link.

---

### GET `/api/commission/user`

List user commission links.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Filter by user |

**Response `200`:** Array of user commission records.

---

### PUT `/api/commission/user/:id`

Update a user commission link.

**Response `200`:** Updated record.

---

### DELETE `/api/commission/user/:id`

Remove a user commission link.

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

### POST `/api/commission/calculate`

Get the best matching commission for a user and calculate the fee.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Target user |
| `amount` | number | No | Transaction amount (calculates fee if provided) |

**Response `200`:**
```json
{
  "commission": { "id": 1, "percent_fee": "1.50", "flat_fee": null },
  "fee": 15.00
}
```

---

## 14. Rental

**Base path:** `/api/rental`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/rental/`

Create a rental record.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | Yes | Merchant ID |
| `franchaise_id` | number | No | Franchise ID |
| `amount` | number | Yes | Rental amount |
| `type` | string | No | Rental type |
| `status` | string | No | `active` \| `inactive` |
| `is_default` | boolean | No | Default: `false` |

**Response `201`:** Created rental object.

---

### GET `/api/rental/list`

List rentals with filters.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | No | Filter by merchant |
| `status` | string | No | `active` \| `inactive` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 10 |

**Response `200`:** Paginated rental list.

---

### GET `/api/rental/:id`

Get rental by ID.

**Response `200`:** Single rental object.

---

### PUT `/api/rental/:id`

Update a rental.

**Response `200`:** Updated rental object.

---

### DELETE `/api/rental/:id`

Delete a rental.

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

## 15. Service Fee

**Base path:** `/api/service-fee`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/service-fee/`
**Auth:** Admin only

Create a service fee entry.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `service_name` | string | Yes | e.g. `bank_verification`, `payout` |
| `flat_fee` | number | No | Flat fee |
| `percent_fee` | number | No | Percent fee |
| `is_active` | boolean | No | Default: `true` |

**Response `201`:** Created service fee record.

---

### GET `/api/service-fee/`

List all service fees.

**Response `200`:** Array of service fee records.

---

### PUT `/api/service-fee/:id`
**Auth:** Admin only

Update a service fee.

**Response `200`:** Updated record.

---

### DELETE `/api/service-fee/:id`
**Auth:** Admin only

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

## 16. Payout Charge

**Base path:** `/api/payout-charge`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/payout-charge/`

Create a payout charge slab.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | Yes | Target merchant |
| `min` | number | No | Min payout amount |
| `max` | number | No | Max payout amount |
| `amount` | number | No | Flat charge amount |
| `percentage` | number | No | Charge percentage |
| `status` | string | No | `active` \| `inactive` |
| `is_default` | boolean | No | Default: `false` |

**Response `201`:** Created payout charge object.

---

### GET `/api/payout-charge/list`

List payout charges with filters.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | No | Filter by merchant |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 10 |

**Response `200`:** Paginated payout charge list.

---

### GET `/api/payout-charge/:id`

Get a payout charge by ID.

**Response `200`:** Single payout charge object.

---

### PUT `/api/payout-charge/:id`

Update a payout charge.

**Response `200`:** Updated payout charge.

---

### DELETE `/api/payout-charge/:id`

Delete a payout charge.

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

## 17. POS Transaction Charge

**Base path:** `/api/pos-transaction-charge`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/pos-transaction-charge/`

Create a POS transaction charge config.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | Yes | Target merchant |
| `method` | string | No | Payment method |
| `network` | string | No | Card network |
| `card_type` | string | No | `CREDIT` \| `DEBIT` |
| `subtype` | string | No | Card subtype |
| `rate_percentage` | number | Yes | Charge rate |
| `is_default` | boolean | No | Default: `false` |

**Response `201`:** Created record.

---

### GET `/api/pos-transaction-charge/list`

List POS transaction charge configs.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | No | Filter by merchant |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 10 |

**Response `200`:** Paginated list.

---

### GET `/api/pos-transaction-charge/:id`

Get by ID. **Response `200`:** Single record.

---

### PUT `/api/pos-transaction-charge/:id`

Update. **Response `200`:** Updated record.

---

### DELETE `/api/pos-transaction-charge/:id`

Delete. **Response `200`:** `{ "message": "Deleted" }`

---

## 18. Reports

**Base path:** `/api/report`  
**Auth:** All routes require `Bearer token`

---

### GET `/api/report/pos-txn`

POS transaction report.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `from_date` | string | No | `YYYY-MM-DD` (default: today) |
| `to_date` | string | No | `YYYY-MM-DD` (default: today) |
| `status` | string | No | Transaction status |
| `cardHolderName` | string | No | Partial match on cardholder name |
| `posTxnNo` | string | No | Transaction number filter |
| `deviceNo` | string | No | Device number |

**Response `200`:** Array of POS transactions for the period.

---

### GET `/api/report/wallet`

Wallet transaction report (role-scoped).

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Admin: filter by user |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |
| `type` | string | No | `request` \| `transfer` \| `hold` etc. |

**Response `200`:** Array of wallet transactions.

---

### GET `/api/report/razorpay`

Razorpay notification report (user-scoped).

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Admin/Franchise: filter by user |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |
| `status` | string | No | `AUTHORIZED` \| `FAILED` \| `CAPTURED` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 50 |

**Response `200`:** Paginated Razorpay notification list.

---

### GET `/api/report/razorpay/all`
**Auth:** Admin only

All Razorpay notifications without user restriction.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number | No | Default: 1 |
| `limit` | number | No | Max: 50 |
| `source` | string | No | `razorpay` \| `everlife` |

**Response `200`:**
```json
{
  "success": true,
  "count": 200,
  "pagination": { "total": 200, "page": 1, "limit": 50, "totalPages": 4 },
  "data": [
    {
      "id": 1,
      "txn_id": "TXN123",
      "status": "AUTHORIZED",
      "amount": "1000.00",
      "mid": "MID001",
      "tid": "TID001",
      "user": { "id": 5, "name": "...", "email": "..." },
      "posMachine": { "id": 1, "mid_number": "MID001", "tid_number": "TID001" }
    }
  ]
}
```

---

### GET `/api/report/ledger`

Ledger report with date range.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Admin/Franchise: filter by user |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |
| `transaction_type` | string | No | Ledger entry type |

**Response `200`:** Array of ledger entries.

---

### GET `/api/report/payout`

Payout report with balance before/amount/balance after.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Admin: filter by user |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |
| `status` | string | No | `SUCCESS` \| `PENDING` \| `FAILED` |

**Response `200`:** Array of payout records.

---

### GET `/api/report/bbps`

BBPS CC bill payment report.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Admin: filter by user |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |

**Response `200`:** Array of BBPS CC payment records.

---

### GET `/api/report/all-transactions`

Combined report: Razorpay + Payout + BBPS + Direct Transfers, ordered by date.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Admin/Franchise: filter by user |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 50 |

**Response `200`:** Paginated list of mixed transaction types.

---

### GET `/api/report/users`

User listing report.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `role` | string | No | `merchant` \| `franchaise` |
| `status` | string | No | `active` \| `inactive` |
| `search` | string | No | Partial match on name, email, mobile |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 20 |

> Franchise users only see their own merchants.

**Response `200`:** Paginated user report list.

---

## 19. KYC

**Base path:** `/api/kyc`  
**Auth:** All routes require `Bearer token`

---

### GET `/api/kyc/info`

Returns user info for pre-filling the KYC form and whether KYC is already complete.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "John Doe",
    "mobile": "9876543210",
    "email": "john@example.com",
    "pan": "ABCDE1234F",
    "aadhaar": "XXXX-XXXX-1234",
    "kyc_completed": false,
    "ipay_outlet_id": null
  }
}
```

---

### POST `/api/kyc/initiate`

Initiates KYC via InstantPay. Missing fields are auto-filled from the user record.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `mobile` | string | No* | 10-digit mobile (uses profile if omitted) |
| `email` | string | No* | Email (uses profile if omitted) |
| `aadhaar` | string | No* | Aadhaar number (uses profile if omitted) |
| `pan` | string | No* | PAN number (uses profile if omitted) |
| `bankAccountNo` | string | Yes | Bank account number |
| `bankIfsc` | string | Yes | Bank IFSC code |
| `latitude` | number | No | GPS latitude |
| `longitude` | number | No | GPS longitude |
| `consent` | string | Yes | Consent string (e.g. `"Y"`) |

**Response `200`:**
```json
{
  "success": true,
  "message": "OTP Sent",
  "data": {
    "otpReferenceID": "REF123456",
    "hash": "abc123hash"
  }
}
```

---

### POST `/api/kyc/validate-otp`

Validates the OTP and saves the outlet ID on success.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `otpReferenceID` | string | Yes | Reference ID from `/initiate` |
| `otp` | string | Yes | OTP received on mobile |
| `hash` | string | Yes | Hash from `/initiate` |

**Response `200`:**
```json
{
  "success": true,
  "message": "KYC completed",
  "data": { "outletId": 12345 }
}
```

---

## 20. BBPS — Credit Card Bill Payment

**Base path:** `/api/bbps-cc`  
**Auth:** All routes require `Bearer token`

---

### GET `/api/bbps-cc/categories`

Fetch all BBPS utility categories.

**Response `200`:**
```json
{ "success": true, "data": [ { "categoryId": "C15", "categoryName": "Credit Card" } ] }
```

---

### GET `/api/bbps-cc/billers`

Fetch CC billers list.

**Response `200`:**
```json
{ "success": true, "count": 25, "data": [ { "billerId": "BLR001", "billerName": "HDFC CC" } ] }
```

---

### POST `/api/bbps-cc/biller-details`

Get the input schema and details for a specific biller.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `billerId` | string | Yes | Biller ID from the billers list |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "billerName": "HDFC CC",
    "billerInputParams": [ { "paramName": "Credit Card Number", "dataType": "NUMERIC", "minLength": 16 } ],
    "paymentModes": [ { "paymentMode": "Cash", "paymentInfo": [] } ]
  }
}
```

---

### POST `/api/bbps-cc/pre-payment-enquiry`

Fetch/validate the bill before payment (required for billers that mandate it).

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `billerId` | string | Yes | Biller ID |
| `param1` | string | Yes | Card/account number |
| `param2` | string | No | Secondary parameter if required |
| `transactionAmount` | number | Yes | Bill amount in ₹ |
| `customerMobile` | string | No | 10-digit customer mobile |
| `geoCode` | string | No | `"lat,long"` string |

**Response `200`:**
```json
{
  "success": true,
  "message": "Pre-payment enquiry successful",
  "enquiryReferenceId": "ENQ123456",
  "externalRef": "EXT789",
  "data": { "billAmount": 1500.00, "dueDate": "2026-04-01" }
}
```

---

### POST `/api/bbps-cc/pay`

Execute the CC bill payment.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `billerId` | string | Yes | Biller ID |
| `param1` | string | Yes | Card/account number |
| `param2` | string | No | Secondary param |
| `transactionAmount` | number | Yes | Amount in ₹ |
| `customerMobile` | string | Yes | 10-digit mobile |
| `paymentMode` | string | No | `Cash` \| `UPI` (default: `Cash`) |
| `paymentInfo` | object | No | Dynamic fields from biller-details |
| `enquiryReferenceId` | string | No | From pre-payment enquiry |
| `geoCode` | string | No | `"lat,long"` string |
| `customerPan` | string | No | PAN (required by some billers) |

**Response `200`:**
```json
{
  "success": true,
  "message": "Payment successful",
  "data": {
    "transactionId": "TXN987654",
    "status": "SUCCESS",
    "amount": 1500.00,
    "chargeAmount": 20.00,
    "receiptUrl": "..."
  }
}
```

---

### GET `/api/bbps-cc/payments`

List CC bill payment records.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | No | Admin: filter by user |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 20 |

**Response `200`:** Paginated list of CC bill payment records.

---

### GET `/api/bbps-cc/payments/:id`

Get a specific CC bill payment record.

**Response `200`:** Single payment record.

---

### GET `/api/bbps-cc/charge-rules`
**Auth:** Admin only

List BBPS CC charge rules.

**Response `200`:** Array of charge rules.

---

### POST `/api/bbps-cc/charge-rules`
**Auth:** Admin only

Create a BBPS CC charge rule.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `from_amount` | number | Yes | Min slab amount |
| `to_amount` | number | Yes | Max slab amount |
| `rate_type` | string | Yes | `flat` \| `percentage` |
| `rate` | number | Yes | Charge value |
| `is_active` | boolean | No | Default: `true` |

**Response `201`:** Created charge rule.

---

### PUT `/api/bbps-cc/charge-rules/:id`
**Auth:** Admin only

Update a charge rule. **Response `200`:** Updated rule.

---

### DELETE `/api/bbps-cc/charge-rules/:id`
**Auth:** Admin only

**Response `200`:** `{ "message": "Deleted" }`

---

## 21. BranchX Payments (v2)

**Base path:** `/api/payment/v2`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/payment/v2/payout`

Initiate a payout to a beneficiary via BranchX.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | Yes | Merchant user ID |
| `beneficiary_id` | number | Yes | Target beneficiary ID |
| `amount` | number | Yes | Payout amount in ₹ |
| `tpin` | string | Yes | TPIN for authorization |
| `purpose` | string | No | Purpose of payout |
| `latitude` | number | No | GPS latitude |
| `longitude` | number | No | GPS longitude |
| `service_charge` | number | No | Override service charge (auto-calculated if omitted) |

**Response `200`:**
```json
{
  "success": true,
  "message": "Payout request processed successfully",
  "data": { "status": "SUCCESS", "utr": "UTR123456", "api_ref": "REF789" }
}
```

---

### POST `/api/payment/v2/remitter/kyc/input`

Submit KYC input for a remitter.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Remitter name |
| `dob` | string | Yes | Date of birth (`YYYY-MM-DD`) |
| `mobile` | string | Yes | Mobile number |
| `docs` | array | Yes | Array of document objects |

**Response `200`:**
```json
{ "success": true, "message": "KYC input submitted successfully", "data": { "..." : "..." } }
```

---

### GET `/api/payment/v2/remitter/kyc/verify`

Verify KYC OTP for a remitter.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `otp` | string | Yes | OTP received |

**Response `200`:**
```json
{ "success": true, "message": "KYC verification completed successfully", "data": { "..." : "..." } }
```

---

### POST `/api/payment/v2/bank/validation`

Validate a bank account (penny drop).

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `accountNumber` | string | Yes | Bank account number |
| `ifscCode` | string | Yes | Bank IFSC code |
| `mobileNumber` | string | No | Mobile number |
| `requestId` | string | No | Unique request ID |
| `bankName` | string | No | Bank name |

**Response `200`:**
```json
{
  "success": true,
  "message": "Bank account validated successfully",
  "data": {
    "utr": "UTR123",
    "name": "John Doe",
    "api_ref": "REF456",
    "status": "SUCCESS"
  }
}
```

---

### GET `/api/payment/v2/beneficiaries/:merchant_id`

List active/verified beneficiaries for a merchant.

**Path Params:** `merchant_id` — Merchant user ID

**Response `200`:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "id": 1,
      "merchant_id": 5,
      "beneficiary_name": "Jane Doe",
      "account_number": "1234567890",
      "ifsc_code": "HDFC0001234",
      "bank_name": "HDFC Bank",
      "mobile_number": "9876543210",
      "status": "verified"
    }
  ]
}
```

---

### POST `/api/payment/v2/add-beneficiary`

Add a new beneficiary (includes bank validation automatically).

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `merchant_id` | number | Yes | Merchant user ID |
| `mobile_number` | string | Yes | Beneficiary mobile |
| `bank_name` | string | Yes | Bank name |
| `account_number` | string | Yes | Account number |
| `ifsc_code` | string | Yes | IFSC code |
| `beneficiary_name` | string | Yes | Beneficiary full name |
| `email` | string | Yes | Email address |

**Response `200`:**
```json
{ "success": true, "message": "Beneficiary added successfully", "data": { "id": 1, "..." : "..." } }
```

---

### DELETE `/api/payment/v2/beneficiary/:id`

Soft-delete (deactivate) a beneficiary.

**Path Params:** `id` — Beneficiary ID

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `merchantId` | number | Yes | Owner merchant ID |

**Response `200`:**
```json
{ "success": true, "message": "Beneficiary deactivated" }
```

---

## 22. CredXPay Payout

**Note:** These routes use a different base path (not under `/api`).

---

### POST `/payout/credxpay`
**Auth:** `Bearer token`

Initiate a payout via CredXPay.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Authenticated user ID |
| `beneficiary_id` | number | Yes | Target beneficiary ID |
| `amount` | number | Yes | Payout amount in ₹ |
| `tpin` | string | Yes | TPIN for authorization |
| `latitude` | number | No | GPS latitude |
| `longitude` | number | No | GPS longitude |
| `purpose` | string | No | Purpose description |

**Response `200`:**
```json
{
  "success": true,
  "message": "Payout initiated",
  "data": {
    "request_id": "REQ123",
    "status": "PENDING",
    "amount": 1000.00,
    "service_charge": 5.00
  }
}
```

---

### POST `/payout/credxpay/beneficiaries`
**Auth:** `Bearer token`

Create a new CredXPay beneficiary.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `user_id` | number | Yes | Owner user ID |
| `name` | string | Yes | Beneficiary name |
| `account_number` | string | Yes | Bank account number |
| `ifsc_code` | string | Yes | IFSC code |
| `bank_name` | string | Yes | Bank name |
| `branch_name` | string | No | Branch name |
| `mobile` | string | No | Mobile number |
| `email` | string | No | Email address |

**Response `200`:**
```json
{ "success": true, "data": { "id": 1, "name": "Jane Doe", "is_verified": false } }
```

---

### GET `/payout/credxpay/beneficiaries/:user_id`
**Auth:** `Bearer token`

List beneficiaries for a user.

**Response `200`:**
```json
{ "success": true, "data": [ { "id": 1, "name": "Jane Doe", "account_number": "...", "is_verified": true } ] }
```

---

### PUT `/payout/credxpay/beneficiaries/:id`
**Auth:** `Bearer token`

Update a beneficiary (any fields in request body).

**Response `200`:**
```json
{ "success": true, "data": { "..." : "..." } }
```

---

### DELETE `/payout/credxpay/beneficiaries/:id`
**Auth:** `Bearer token`

Delete a beneficiary permanently.

**Response `200`:**
```json
{ "success": true, "message": "Deleted" }
```

---

## 23. Razorpay Webhooks & Notifications

**Base path:** `/api/razorpay`

---

### POST `/api/razorpay/webhook`
**Auth:** Razorpay signature verification (no user JWT needed)

Webhook endpoint called by Razorpay for transaction events. Stores the notification and queues business logic processing.

> **For Frontend:** Do not call this directly. It is an internal webhook.

---

### GET `/api/razorpay/notification`
**Auth:** `Bearer token`

List Razorpay transaction notifications.

> Access is limited to admin users and employee users with `razorpay.notifications.list`.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 20 |
| `status` | string | No | `AUTHORIZED` \| `FAILED` \| `CAPTURED` \| `VOIDED` |
| `start_date` | string | No | `YYYY-MM-DD` |
| `end_date` | string | No | `YYYY-MM-DD` |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "txn_id": "TXN123",
      "status": "AUTHORIZED",
      "amount": "1000.00",
      "mid": "MID001",
      "tid": "TID001",
      "processed": true,
      "processing_status": "completed",
      "createdAt": "2026-03-01T10:00:00.000Z"
    }
  ],
  "pagination": { "total": 50, "page": 1, "limit": 20, "totalPages": 3 }
}
```

---

### GET `/api/razorpay/notification/:id`
**Auth:** `Bearer token`

Get a single Razorpay notification by ID.

> Access is limited to admin users and employee users with `razorpay.notifications.read`.

**Response `200`:** Full notification object with all payment details.

---

## 24. Direct Login (Admin)

Already documented under [Section 2 — Admin](#2-admin) (`/api/admin/dl-token`, `/api/admin/direct-login`).

---

## 25. Company Name

**Base path:** `/api/company-name`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/company-name/`
**Auth:** Admin only

Create a company name entry.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Company name |

**Response `201`:** Created company name record.

---

### GET `/api/company-name/`

List all company names.

**Response `200`:** Array of company name records.

---

### PUT `/api/company-name/:id`
**Auth:** Admin only

Update a company name.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Updated company name |

**Response `200`:** Updated record.

---

### DELETE `/api/company-name/:id`
**Auth:** Admin only

**Response `200`:**
```json
{ "message": "Deleted" }
```

---

## 26. Complaints

**Base path:** `/api/complaint`  
**Auth:** All routes require `Bearer token`

---

### POST `/api/complaint/submit`

Submit a complaint.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | Complaint message |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "user_id": 5,
    "message": "My POS machine is not working",
    "status": "pending",
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
}
```

---

### GET `/api/complaint/`

List complaints. Admin sees all; other roles see their own.

**Response `200`:**
```json
[
  {
    "id": 1,
    "message": "Issue with POS",
    "status": "pending",
    "user": { "id": 5, "name": "John Doe", "email": "john@e.com" },
    "createdAt": "2026-03-18T10:00:00.000Z"
  }
]
```

---

### PUT `/api/complaint/:id/status`
**Auth:** `Bearer token`

Update a complaint status.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | Yes | `pending` \| `resolved` \| `closed` |

**Response `200`:**
```json
{ "success": true, "data": { "id": 1, "status": "resolved" } }
```

---

## 27. TPIN

**Base path:** `/api/user` (TPIN endpoints are part of the User module)  
See [Section 1 — POST `/api/user/tpin`](#post-apiusertpin) and [POST `/api/user/tpin/verify`](#post-apiusertpinverify).

There is also a standalone TPIN generation endpoint (legacy):

### POST `/api/tpin` *(if mounted separately)*
**Auth:** No token required

Generate a TPIN.

**Response `200`:**
```json
{ "success": true, "message": "TPIN generated" }
```

---

## 28. Credit Bill Payment (BillAvenue)

**Base path:** `/api/credit-bill`  
**Auth:** No token required on this route

---

### POST `/api/credit-bill/payment`

Pay a credit card bill via BillAvenue gateway.

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| `cardNumber` | string | Yes | Credit card number |
| `amount` | number | Yes | Bill payment amount in ₹ |
| `billerId` | string | Yes | Biller identifier |
| `customerMobile` | string | No | Customer mobile number |
| `customerEmail` | string | No | Customer email |

**Response `200`:**
```json
{
  "success": true,
  "message": "Bill payment processed",
  "data": {
    "transactionId": "TXN_BA_123",
    "status": "SUCCESS",
    "amount": 2000.00
  }
}
```

---

## Common Response Formats

### Success Response
```json
{
  "success": true,
  "message": "Operation description",
  "data": { }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description"
}
```

### Validation Error (`400`)
```json
{
  "success": false,
  "message": "Missing required fields: field1, field2"
}
```

### Unauthorized (`401`)
```json
{
  "success": false,
  "message": "Not authorized, token failed"
}
```

### Forbidden (`403`)
```json
{
  "success": false,
  "message": "Admin access only."
}
```

### Not Found (`404`)
```json
{
  "success": false,
  "message": "Resource not found."
}
```

---

## Roles Summary

| Role | Description |
|---|---|
| `admin` | Full access to all resources and all users |
| `franchaise` | Manages their merchants and own data |
| `merchant` | Access to own data only |

---

## Notes for Frontend

- All dates should be sent in `YYYY-MM-DD` format.
- Token expiry is **5 hours** — refresh by calling `/api/user/login` again.
- File uploads must use `multipart/form-data` content type (not JSON).
- The `Authorization` header must be exactly: `Authorization: Bearer <token>`.
- Pagination is zero-indexed internally but **page numbers start at 1** in all API calls.
- `wallet` amounts in user objects are stored as decimal strings (e.g. `"1500.00"`).
