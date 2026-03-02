# Service Fee API

This set of endpoints allows the application to store and manage flat/percentage
fees associated with various internal services (activation, bank verification,
etc.).  Only users with the **admin** role may create, update or delete records.
All authenticated users can retrieve the list for display purposes.

## Constants

The server exports predefined service name constants in `constants.serviceNames`.
Frontend code may use these when referring to specific fee types, for example:

```js
import { serviceNames } from '/path/to/constants';

// use in requests or conditionals
const feeType = serviceNames.BANK_VERIFICATION;
```

Current values available (keep this list in sync with `constants.js`):

- `serviceNames.BANK_VERIFICATION` → `'bank_verification'`
- `serviceNames.ACTIVATION`      → `'activation'`
- `serviceNames.KYC`             → `'kyc'`

Using constants keeps UI code in sync with the backend and prevents spelling
errors.
## Endpoints

### GET `/api/service-fee`

Returns a list of all configured service fees (newest first).

**Request**
- Headers: `Authorization: Bearer <token>`

**Response** (`200`):

```json
[
  {
    "id": 1,
    "service_name": "bank_verification",
    "flat_fee": "10.00",
    "percent_fee": "0.00",
    "is_active": true,
    "created_by": 1,
    "updated_by": null,
    "createdAt": "2026-03-02T12:00:00.000Z",
    "updatedAt": "2026-03-02T12:00:00.000Z"
  }
]
```

Errors:
- `401` if no/invalid auth token.

### POST `/api/service-fee`

Create a new service fee (admin only).

**Body parameters** (JSON):
- `serviceName` (string, required) – **must** equal one of the values exported in `constants.serviceNames` (e.g. `serviceNames.BANK_VERIFICATION`).

> **Note:** when a bank account is successfully validated via
> `/api/payment/v2/bank/validation`, the system automatically applies the
> configured `bank_verification` service fee (if any) and debits it from the
> merchant's ledger.  The front end does not need to handle this separately.
- `flat_fee` (number, optional)
- `percent_fee` (number, optional)
- `is_active` (boolean, optional)

At least one of `flat_fee` or `percent_fee` must be non-zero.  If both are
supplied, percent fee is used during calculation.  Providing a `serviceName` not
defined in the constants results in a `400` error.

**Response** (`201`):

```json
{ "message": "Service fee created", "record": { /* new object */ } }
```

Error codes:
- `400` missing/invalid parameters or duplicate service name
- `403` if user is not admin
- `401` no auth

### PUT `/api/service-fee/:id`

Update an existing fee record (admin only).

**Body** may include any of the POST fields; changing `serviceName` checks for
duplicates.  Sending `flat_fee`/`percent_fee` of `0` will clear the value.

**Responses**
- `200` update success
- `404` no record with that id
- `400` duplicate name or invalid values
- `403` non-admin
- `401` auth failure

### DELETE `/api/service-fee/:id`

Remove a fee record (admin only).  Responds with `200` on success or `404` if
the id does not exist.

---

### Frontend usage notes

* Fetch the list on page load to populate summaries or allow admins to edit
  each entry.  The `id` is used for update/delete operations.
* The same constants object used by the server should be mirrored on the client
  (or fetched from a shared module) to ensure consistency across builds.
* Write forms that accept both numeric and percentage input, and validate that
  at least one value is entered before submitting.
* Remember to include the auth token with every request.

This document can be shared with the frontend developers to understand how the
service fee CRUD works and what expectations exist for request/response
formatting.