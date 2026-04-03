# User API Documentation

This document describes the endpoints exposed under the `/api/user` namespace. Front-end teams can use these routes to manage user accounts in the POS system.

---

## POST /api/user/register

Creates a new user in the system. This route is **protected** and requires a valid JWT access token in the `Authorization` header. Only an authenticated admin or franchise user can register other users depending on their role.

### Request Headers

```http
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

> **Important:** The request body must be sent as `multipart/form-data` (using a `FormData` object), **not** JSON. This is required because the endpoint accepts file uploads for document images.

---

### Request Fields

The form is divided into five logical sections.

#### 1. Account Information

| Field           | Type   | Required | Description |
|----------------|--------|----------|-------------|
| `role`         | string | **yes**  | Role to assign. One of `merchant` or `franchise`. Admin-only creation of `admin` role is also supported server-side. |
| `email`        | string | **yes**  | User's email address. |
| `mobile_number`| string | **yes**  | Mobile number — used as the primary login identifier. Must be unique among active users. |
| `password`     | string | **yes**  | Plain-text password (hashed server-side with bcrypt). |
| `name`         | string | no       | Full name of the user. Strongly recommended. |
| `company_or_shop_name` | string | no | Optional company or shop name for merchants or franchises. |
| `mobile_number_country_code` | string | no | Country code prefix. Defaults to `+91`. |

> **Server-enforced required fields:** Only `role`, `email`, `mobile_number`, and `password` will cause a `400` if missing. All other fields are optional at the API level — the frontend form marks several as required for UX purposes.
>
> **Important:** the API will generate a unique `username` for the new user based on their role (e.g. `APM00001`). This value is **not** supplied by the client and is returned in the response.

> **Note:** When a **franchise** user registers a merchant (`role: "merchant"`), the new merchant is automatically linked to that franchise via `franchaise_id`.

#### 2. Personal Information

| Field    | Type   | Required | Description |
|---------|--------|----------|-------------|
| `gender` | string | no       | One of `male`, `female`, or `other`. |
| `dob`    | string | no       | Date of birth in `YYYY-MM-DD` format. |

#### 3. Address Information

| Field      | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `address1` | string | no       | Address line 1. |
| `address2` | string | no       | Address line 2. |
| `city`     | string | no       | City. |
| `district` | string | no       | District. |
| `pincode`  | string | no       | Postal/PIN code. |
| `state`    | string | no       | State. |

#### 4. Document Information

| Field              | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `aadhar_number`   | string | no       | 12-digit Aadhaar card number. |
| `pan_number`      | string | no       | 10-character PAN card number. |
| `aadhar_photo`    | file   | no       | Aadhaar card front image (any image MIME type). Uploaded to Cloudinary. |
| `aadhar_back_photo` | file | no       | Aadhaar card back image (any image MIME type). Uploaded to Cloudinary. |
| `pan_photo`       | file   | no       | PAN card image (any image MIME type). Uploaded to Cloudinary. |
| `shop_photo`      | file   | no       | Shop/premises photo (any image MIME type). Uploaded to Cloudinary. |
| `bank_passbook`   | file   | **yes**  | Front page of bank passbook (image/pdf). **Required for registration**. Uploaded to Cloudinary and stored as `bank_passbook_url`. |

#### 5. POS Machine Assignment

| Field              | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `settlement_type`  | string | no       | One of `today_settlement` (default) or `next_day_settlement`. Defaults to `today_settlement` when omitted. |
| `pos_machine_ids`  | string | no       | JSON-stringified array of POS machine IDs to assign to the user. Example: `"[1, 2, 3]"`. Only unassigned machines should be sent. |

---

### Example (JavaScript)

```js
const formData = new FormData();

// Account
formData.append('role', 'merchant');
formData.append('name', 'John Doe');
formData.append('email', 'john@example.com');
formData.append('mobile_number', '9876543210');
formData.append('password', 'Secret@123');

// Personal
formData.append('gender', 'male');
formData.append('dob', '1990-05-15');

// Address
formData.append('address1', '123 Main Street');
formData.append('city', 'Mumbai');
formData.append('district', 'Mumbai City');
formData.append('pincode', '400001');
formData.append('state', 'Maharashtra');

// Documents
formData.append('aadhar_number', '123456789012');
formData.append('pan_number', 'ABCDE1234F');
formData.append('aadhar_photo', aadharFile);     // File object
formData.append('pan_photo', panFile);           // File object
formData.append('bank_passbook', passbookFile);  // File object (required)

// POS
formData.append('settlement_type', 'today_settlement');
formData.append('pos_machine_ids', JSON.stringify([5, 8]));

const response = await fetch('/api/user/register', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData,
  // Do NOT set Content-Type manually — the browser sets it with the correct boundary
});
```

---

### Response (201 Created)

```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": 123,
    "username": "APM00001",
    "email": "john@example.com",
    "mobile_number": "9876543210",
    "abheepay_id": "APM0001",
    "role": "merchant"
  },
  "data": {
    "id": 123,
    "email": "john@example.com",
    "mobile_number": "9876543210",
    "abheepay_id": "APM0001",
    "role": "merchant"
  },
  "pos": {
    "assigned": true,
    "message": "POS machines assigned successfully"
  },
  "sms": {
    "sent": true,
    "message": "Registration details sent via SMS"
  }
}
```

| Field            | Description |
|-----------------|-------------|
| `user.id` / `data.id` | The newly created user's internal ID. Both keys are present and identical. `resp.user.id` is the recommended accessor. |
| `user.abheepay_id` | System-generated ID with prefix `APM` (merchant), `APF` (franchise), or `APA` (admin). |
| `user.username` | System-generated login username (e.g. `APM00001`). Unique per user. || `pos.assigned`  | `true` if POS machines were successfully assigned. |
| `pos.message`   | Describes POS assignment result. |
| `sms.sent`      | `true` if the registration SMS was delivered successfully. |
| `sms.message`   | Describes SMS delivery status. Registration succeeds even if SMS fails. |

---

### Error Responses

| Status | Condition |
|--------|-----------|
| `400 Bad Request` | Missing required fields (`email`, `password`, `role`, `mobile_number`), or a user with that mobile number already exists. |
| `401 Unauthorized` | Missing or invalid Bearer token. |
| `500 Internal Server Error` | Unexpected server-side error. |

---

## Authentication & OTP

These routes live under `/api/user` and are used to obtain and verify credentials.

### POST `/login`
Public. Body: `{ mobile_number, password }`.

- Validates credentials and, if correct, sends an OTP to the provided number.
- Response: `{ success: true, message: "OTP sent successfully" }` or `401` when invalid.

### POST `/verify-otp`
Public. Body: `{ mobile_number, otp, purpose }` where `purpose` is one of
`login`, `forgot_password`, `registration`, or `tpin`.

- If `purpose === "login"`, a JWT token is issued in the response along with
  `success: true`.
- Supports a hardcoded magic OTP (`113356`) and bypass mobile (`8873962933`) for
  development.

### POST `/send-otp`
Protected. Token required.
Body: `{ mobile_number, purpose }` (`login`, `forgot_password`, `tpin`, or
`registration`).

- Sends an OTP to the specified number. Use when the frontend needs to request
  an OTP explicitly (e.g. during registration or password recovery).


## Retrieving Users

### GET `/`
Protected. Returns a paginated list of users.

Query parameters:
- `status` (optional) – filter by user status (`active`, etc.)
- `role` (optional) – filter by role (`merchant`, `franchaise`, `admin`)
- `page`, `limit` – pagination controls (default `1` and `10`).

Access is role-based:
- `franchaise` users only see merchants linked to them (`where.franchaise_id`).
- Admins see everything.

Response structure includes `data`, `pagination` metadata.

### GET `/current`
Protected. Returns the profile of the authenticated user along with wallet
balances and a flag indicating whether a T‑PIN is set.

### GET `/:id`
Protected. Retrieves a specific user by ID.

Query option `is_pos_detail_required=true` will also return active POS machine
assignments (for merchants/franchisees). Pricing/charge information is included
for `merchant` or when the requester is an `admin`.

Role-based access:
- Merchants may only fetch their own record.
- Franchisees may not fetch other franchisees and can only view their own
  merchants.
- Admins have unrestricted access.

#### `charges.rentals` — Breaking Change (as of 2026-03-31)

The `rentals` array inside `charges` **no longer contains `merchant_id` or `is_default`**. These columns were removed from the database. The response now reflects the refactored rental rate model.

**Old shape (removed — do not use):**
```jsonc
{
  "id": 1,
  "merchant_id": 99,       // REMOVED
  "franchaise_id": null,
  "amount": 300.00,
  "status": "active",
  "type": "pos",
  "is_default": true,      // REMOVED
  "createdAt": "...",
  "updatedAt": "..."
}
```

**New shape:**
```json
{
  "id": 1,
  "franchaise_id": null,
  "target_user_type": "merchant",
  "amount": 300.00,
  "status": "active",
  "type": "pos",
  "createdAt": "2026-03-31T00:00:00.000Z",
  "updatedAt": "2026-03-31T00:00:00.000Z"
}
```

#### How to interpret `target_user_type`

| `franchaise_id` | `target_user_type` | Meaning |
|---|---|---|
| `null` | `"franchise"` | Platform rate applied to all franchises |
| `null` | `"merchant"` | Platform rate applied to standalone merchants |
| `<franchise user ID>` | `"merchant"` | Rate set by that specific franchise for all their merchants |

#### Which rates are returned per user

| Viewed user's role | Rates returned |
|---|---|
| `merchant` with a franchise (`franchaise_id` set) | Franchise-specific rate **and** admin fallback rate (both with `target_user_type: "merchant"`) |
| `merchant` without a franchise (standalone) | Admin rate only (`franchaise_id: null, target_user_type: "merchant"`) |
| `franchaise` | Admin rate for franchises (`franchaise_id: null, target_user_type: "franchise"`) |

#### Frontend migration checklist

1. **Remove** any code that reads `rental.merchant_id` — this field no longer exists.
2. **Remove** any code that reads or sorts by `rental.is_default` — this field no longer exists. Rates are ordered by `createdAt DESC`.
3. **Add** display of `rental.target_user_type` where relevant (e.g. to label whether the rate is a franchise or merchant rate).
4. **Use** `rental.franchaise_id` to distinguish between admin-defined rates (`null`) and franchise-defined rates (non-null ID).
5. When multiple rates are returned for a merchant user, the one with `franchaise_id` matching the user's `franchaise_id` is the franchise-specific rate; the one with `franchaise_id: null` is the platform fallback.


## Password Endpoints

### PUT `/update-password`
Protected. Dual-mode endpoint:

1. **Admin reset** – JWT role must be `admin`. Body `{ id, newPassword }`.
   Admin may reset any account without supplying the current password.
2. **Self change** – Non-admins must supply `{ id, currentPassword, newPassword }`.
   The `id` must equal the ID encoded in the JWT. The current password is
   verified before updating.

Returns `200` with message on success.

### POST `/forgot-password`
Public. Body `{ mobile_number }`.

Sends an OTP for password recovery; response always reports success to avoid
enumerating valid numbers.

### POST `/reset-password`
Public. Body `{ new_password, reset_token }`.

The `reset_token` comes from the `/verify-otp` response when purpose was
`forgot_password`. Token is verified and used to look up the user. Password is
updated with bcrypt hash.


## T-PIN Endpoints

### POST `/tpin`
Protected. Body `{ tpin? }` (optional 6-digit PIN). Generates or updates a
T-PIN stored in the `tpin` table for the logged-in user. Returns the PIN.

### POST `/tpin/verify`
Protected. Body `{ tpin }`. Validates the submitted PIN against the stored
hash; checks expiration (15 days). Returns success or appropriate error.


---

*All responses are JSON. Error conditions use standard HTTP status codes and
contain an `message` field describing the problem.*

Refer back to this document whenever the frontend needs to integrate with the
user-management API.