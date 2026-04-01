# POS Machine API Documentation

**Base URL:** `/api/pos-machine`  
**Authentication:** Required (Bearer Token)

---

## Endpoints Overview

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | Get all POS machines (admin) | ✅ |
| GET | `/list` | Get paginated list (role-based) | ✅ |
| GET | `/:id` | Get single POS machine by ID | ✅ |
| POST | `/` | Create new POS machine | ✅ |
| POST | `/bulk-create` | Bulk create (file upload) | ✅ |
| POST | `/assign` | Assign machine to user | ✅ |
| POST | `/assign-to-merchant` | Assign to merchant | ✅ |
| PUT | `/activate/:id` | Activate POS machine | ✅ |
| PUT | `/de-activate/:id` | Deactivate POS machine | ✅ |
| PUT | `/unassign/:id` | Unassign POS machine (clear user assignment) | ✅ |
| PUT | `/delivered/:id` | Mark as delivered | ✅ |
| PUT | `/returned-initiated/:id` | Mark return initiated | ✅ |
| PUT | `/:id` | Update POS machine | ✅ |
| DELETE | `/:id` | Delete POS machine | ✅ |

---

## Request/Response Examples

### Get All POS Machines
```
http
GET /api/pos-machine
Authorization: Bearer <token>
```

### Get Single POS Machine
```
http
GET /api/pos-machine/:id
Authorization: Bearer <token>
```

### Create POS Machine
```
http
POST /api/pos-machine
Authorization: Bearer <token>
Content-Type: application/json

{
  "tid_number": "POS001",
  "mid_number": "MID001",
  "device_serial_number": "SERIAL001",
  "company_name": "Acme Corp",        # optional, nullable
  "status": "active"
}
```

### Bulk Create
```
http
POST /api/pos-machine/bulk-create
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <excel/csv file>
```

### Assign to User
```
http
POST /api/pos-machine/assign
Authorization: Bearer <token>
Content-Type: application/json

{
  "posMachineId": 123,
  "userId": 456
}
```

### Activate/Deactivate
```http
PUT /api/pos-machine/activate/:id
PUT /api/pos-machine/de-activate/:id
Authorization: Bearer <token>
```

### Unassign POS Machine
```http
PUT /api/pos-machine/unassign/:id
Authorization: Bearer <token>
```

### Update POS Machine
```
http
PUT /api/pos-machine/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "tid_number": "POS001",
  "mid_number": "MID001",
  "device_serial_number": "SERIAL001",
  "company_name": "Acme Corp",        # optional, nullable
  "status": "active"
}
```

### Delete POS Machine
```
http
DELETE /api/pos-machine/:id
Authorization: Bearer <token>
```

---

## Common Status Values
- `active` - Machine is active
- `inactive` - Machine is inactive
- `delivered` - Machine has been delivered
- `returned-initiated` - Return process started

---

## Notes for Frontend Developers
1. All endpoints require a valid JWT token in the Authorization header
2. Bulk create accepts Excel (.xlsx, .xls) or CSV files
3. The `/list` endpoint returns paginated results based on user role
4. ID parameters in URLs should be numeric integers

---
## Upload Excel/CSV from Frontend (POS Machine Bulk Create)

### Endpoint
- POST `/api/pos-machine/bulk-create`
- Header: `Authorization: Bearer <token>`
- Content-Type: `multipart/form-data`
- Form field: `file` (Excel or CSV file)

### Supported file formats
- `text/csv`, `.csv` (standard)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `.xlsx`
- `application/vnd.ms-excel`, `.xls`

### Required columns (case-insensitive mapping)
- `tid_number` (required)
- `mid_number` (required)
- `device_serial_number` (required)
- `company_name` (optional)
- `bank_name` (optional)
- `razorpay_id` (optional)
- `remarks` (optional, default `added`)

### Example using fetch()
```js
const fileInput = document.querySelector('#machineFile');
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('/api/pos-machine/bulk-create', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${authToken}`
  },
  body: formData
})
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      console.log('Created:', data.createdCount);
      console.log('Skipped:', data.skipped);
    } else {
      console.error('Bulk upload failure:', data.message);
    }
  })
  .catch(err => console.error('Upload error:', err));
```

### Example using Axios
```js
const fileInput = document.querySelector('#machineFile');
const formData = new FormData();
formData.append('file', fileInput.files[0]);

axios.post('/api/pos-machine/bulk-create', formData, {
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'multipart/form-data'
  }
})
.then(res => {
  console.log('Created:', res.data.createdCount);
  console.log('Skipped:', res.data.skipped);
})
.catch(err => {
  console.error('Upload failed:', err.response?.data || err.message);
});
```

### Notes
- Server-side route currently reads file with `fs.readFileSync(req.file.path, 'utf-8')` and parses as CSV. For `.xlsx` files, convert to CSV first or extend backend to use `xlsx` and `sheet_to_json`.
- The upload response returns detailed `skipped` rows with per-row errors so user can fix and re-upload.
- Uploaded file is removed after processing.

### Sample response
```json
{
  "success": true,
  "message": "Created 10 machines, skipped 2 rows",
  "createdCount": 10,
  "created": [ ... ],
  "skipped": [{ "row": 3, "data": ..., "error": "Duplicate" }]
}
```

