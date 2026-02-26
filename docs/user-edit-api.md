# Edit User API

Update an existing user's profile information, KYC documents, and admin-controlled settings.

---

## Endpoint

```
PUT /api/user/:id
```

| | |
|---|---|
| **Auth** | Bearer token (required) |
| **Content-Type** | `application/json` **or** `multipart/form-data` (when uploading files) |

---

## Access Control

| Token Role | Who can be edited |
|---|---|
| `admin` | Any user. Can also set admin-only fields. |
| `franchaise` | Own profile **or** any merchant whose `franchaise_id` matches |
| `merchant` | Own profile only |

Violating these rules returns `403 Forbidden`.

---

## URL Parameter

| Param | Type | Description |
|---|---|---|
| `id` | number | ID of the user to update |

---

## Request Fields

Send only the fields you want to change. All fields are optional.

### Common Fields — any authenticated role

| Field | Type | Description |
|---|---|---|
| `name` | string | Full name |
| `email` | string | Email address (must be unique) |
| `gender` | string | e.g. `Male`, `Female`, `Other` |
| `dob` | string | Date of birth — ISO format `YYYY-MM-DD` |
| `mobile_number` | string | Mobile number (must be unique) |
| `mobile_number_country_code` | string | e.g. `+91` |
| `address1` | string | Address line 1 |
| `address2` | string | Address line 2 |
| `city` | string | City |
| `district` | string | District |
| `pincode` | string | Postal / PIN code |
| `state` | string | State |
| `country` | string | Country |
| `aadhar_number` | string | Aadhaar number |
| `pan_number` | string | PAN number |
| `organization_name` | string | Business / organization name |

### File Fields — multipart/form-data only

| Field | Type | Description |
|---|---|---|
| `pan_photo` | file | PAN card image |
| `aadhar_photo` | file | Aadhaar card front image |
| `aadhar_back_photo` | file | Aadhaar card back image |
| `shop_photo` | file | Shop / business photo |

Files are uploaded to Cloudinary. The returned `data` object will contain updated `*_url` fields.

### Admin-Only Fields

These fields are **silently ignored** when sent by non-admin tokens.

| Field | Type | Allowed values |
|---|---|---|
| `status` | string | `active`, `inactive` |
| `is_approved` | boolean | `true`, `false` |
| `settlement_type` | string | `today_settlement`, `next_day_settlement` |
| `franchaise_id` | number | ID of the franchise to assign |
| `ipay_outlet_id` | number | InstantPay outlet ID |
| `role` | string | `merchant`, `franchaise`, `admin` |

### Protected Fields — never accepted here

`wallet`, `wallet_hold`, `password`, `abheepay_id` are managed by dedicated endpoints and are ignored even for admin.

---

## Example — JSON (no file upload)

```http
PUT /api/user/42
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "city": "Mumbai",
  "organization_name": "Ravi Enterprises"
}
```

## Example — multipart/form-data (with file upload)

```javascript
const form = new FormData();
form.append('name', 'Ravi Kumar');
form.append('city', 'Mumbai');
form.append('pan_photo', panFileInput.files[0]);
form.append('aadhar_photo', aadharFileInput.files[0]);

await fetch('/api/user/42', {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
  // Do NOT set Content-Type manually — browser sets it with the boundary
});
```

## Example — Admin updating status and settlement type

```http
PUT /api/user/42
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "inactive",
  "is_approved": true,
  "settlement_type": "next_day_settlement"
}
```

---

## Success Response — `200 OK`

```json
{
  "success": true,
  "message": "User updated successfully.",
  "data": {
    "id": 42,
    "name": "Ravi Kumar",
    "email": "ravi@example.com",
    "mobile_number": "9876543210",
    "mobile_number_country_code": "+91",
    "role": "merchant",
    "abheepay_id": "APM0042",
    "gender": "Male",
    "dob": "1990-05-15T00:00:00.000Z",
    "address1": "Shop No 5",
    "address2": "Market Road",
    "city": "Mumbai",
    "district": "Mumbai Suburban",
    "pincode": "400001",
    "state": "Maharashtra",
    "country": "India",
    "pan_number": "ABCDE1234F",
    "aadhar_number": "XXXX-XXXX-1234",
    "pan_number_url": "https://res.cloudinary.com/.../pan.jpg",
    "aadhar_number_url": "https://res.cloudinary.com/.../aadhar.jpg",
    "aadhar_back_number_url": null,
    "shop_with_photo_url": null,
    "organization_name": "Ravi Enterprises",
    "is_approved": true,
    "is_pos_asigned": true,
    "status": "active",
    "settlement_type": "today_settlement",
    "wallet": "3200.50",
    "wallet_hold": "0.00",
    "franchaise_id": 7,
    "ipay_outlet_id": null,
    "createdAt": "2025-12-01T08:00:00.000Z",
    "updatedAt": "2026-02-26T10:30:00.000Z"
  }
}
```

> `password` is always stripped from the response.

---

## Error Responses

| Status | `message` | Cause |
|---|---|---|
| `400 Bad Request` | `Valid user id is required.` | `:id` is missing or not a number |
| `400 Bad Request` | `No updatable fields provided.` | Request body has no recognised fields |
| `403 Forbidden` | `You can only edit your own profile.` | Merchant trying to edit another user |
| `403 Forbidden` | `You can only edit your own profile or your own merchants.` | Franchise trying to edit an unrelated user |
| `404 Not Found` | `User not found.` | No user exists with that `:id` |
| `409 Conflict` | `Email is already in use by another account.` | `email` matches a different user |
| `409 Conflict` | `Mobile number is already in use by another account.` | `mobile_number` matches a different user |
| `500 Internal Server Error` | `Something went wrong.` | Unexpected server/DB error |

---

## Frontend Implementation Tips

### 1 — Use `multipart/form-data` only when uploading files

```javascript
// Helper: choose the right content type automatically
async function updateUser(userId, fields, files = {}, token) {
  const hasFiles = Object.keys(files).length > 0;

  if (hasFiles) {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) form.append(k, v); });
    Object.entries(files).forEach(([k, file]) => form.append(k, file));

    const res = await fetch(`/api/user/${userId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return res.json();
  }

  // JSON path — faster, no boundary overhead
  const res = await fetch(`/api/user/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
  });
  return res.json();
}
```

### 2 — Send only changed fields (partial update)

The endpoint applies only the fields present in the request body. You do not need to re-send unchanged values.

```javascript
// ✅ Good — only changed fields
updateUser(42, { city: 'Pune' }, {}, token);

// ❌ Unnecessary — sends the entire form even for a one-field change
updateUser(42, entireFormObject, {}, token);
```

### 3 — React form example

```jsx
import { useState } from 'react';

export function EditUserForm({ user, token, onSaved }) {
  const [form, setForm]     = useState({ name: user.name, city: user.city });
  const [files, setFiles]   = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await updateUser(user.id, form, files, token);
      if (!result.success) throw new Error(result.message);
      onSaved(result.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} encType="multipart/form-data">
      <input
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Full Name"
      />
      <input
        value={form.city}
        onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
        placeholder="City"
      />
      <label>
        PAN Card
        <input
          type="file"
          accept="image/*"
          onChange={e => setFiles(f => ({ ...f, pan_photo: e.target.files[0] }))}
        />
      </label>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Saving…' : 'Save Changes'}
      </button>
    </form>
  );
}
```

### 4 — Axios example

```javascript
import axios from 'axios';

// JSON update
await axios.put(`/api/user/${userId}`, { name: 'Ravi', city: 'Delhi' }, {
  headers: { Authorization: `Bearer ${token}` },
});

// File upload (multipart)
const form = new FormData();
form.append('name', 'Ravi');
form.append('pan_photo', file);

await axios.put(`/api/user/${userId}`, form, {
  headers: { Authorization: `Bearer ${token}` },
  // axios sets Content-Type boundary automatically for FormData
});
```
