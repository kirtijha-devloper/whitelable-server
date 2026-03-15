# GET /api/user — List Users

Returns a paginated list of users. This endpoint is protected and requires a valid JWT access token.

## Request

```
GET /api/user
Authorization: Bearer <token>
```

### Query Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `page` | integer | no (default: `1`) | Page number for pagination. |
| `limit` | integer | no (default: `10`) | Number of results per page. |
| `status` | string | no | Filter by user status (e.g., `active`, `inactive`). |
| `role` | string | no | Filter by role (e.g., `merchant`, `franchaise`, `admin`). |

> Note: Franchise users only see merchants belonging to themselves (`franchaise_id` is applied automatically).

---

## Success Response (200)

```json
{
  "success": true,
  "message": "Users retrieved successfully",
  "data": [
    {
      "id": 123,
      "name": "Merchant Name",
      "email": "merchant@example.com",
      "mobile_number": "9999999999",
      "mobile_number_country_code": "+91",
      "password": "$2b$10$...",
      "role": "merchant",
      "abheepay_id": "APM00001",
      "dob": null,
      "gender": null,
      "address1": null,
      "address2": null,
      "city": null,
      "district": null,
      "pincode": null,
      "state": null,
      "country": null,
      "pan_number": null,
      "aadhar_number": null,
      "pan_number_url": null,
      "aadhar_number_url": null,
      "aadhar_back_number_url": null,
      "shop_with_photo_url": null,
      "bank_passbook_url": null,
      "is_approved": false,
      "organization_name": null,
      "is_pos_asigned": false,
      "status": "active",
      "wallet": "0.00",
      "wallet_hold": "0.00",
      "settlement_type": "today_settlement",
      "franchaise_id": null,
      "company_or_shop_name": null,
      "username": "APM00001",
      "ipay_outlet_id": null,
      "pos_machine_count": 2,
      "createdAt": "2026-03-16T00:00:00.000Z",
      "updatedAt": "2026-03-16T00:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 123,
    "page": 1,
    "limit": 10,
    "totalPages": 13
  }
}
```

### Notes on response fields

- `data` is an array of user objects.
- Each user object currently includes all model fields (including `password` hash).
- `pos_machine_count` is the number of POS machines currently assigned to that user (in the returned page).
- `pagination` contains total count and page metadata for paging UI.

---

## Error Responses

- `401 Unauthorized`: Missing or invalid token.
- `500 Internal Server Error`: Unexpected failure on the server.
