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
| `mobile_number_country_code` | string | no | Country code prefix. Defaults to `+91`. |

> **Server-enforced required fields:** Only `role`, `email`, `mobile_number`, and `password` will cause a `400` if missing. All other fields are optional at the API level — the frontend form marks several as required for UX purposes.

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
| `pos.assigned`  | `true` if POS machines were successfully assigned. |
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

Refer to the other endpoints in this document for login, password reset, OTP handling, etc. (to be added as needed).