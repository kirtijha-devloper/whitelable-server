# Razorpay Webhook Notifications API

This document explains how the frontend (or any client) can retrieve and
filter Razorpay webhook notifications that have been recorded in the system.
There are two supported notification sources:

* **`razorpay`** — standard webhook messages received directly from Razorpay.
* **`everlife`** — notifications forwarded from the Everlife provider using the
  secondary credentials integration.

The source is stored on every `razorpay_notifications` row and may be used for
filtering and reporting.

---

## Base path

```
/api/razorpay/webhook
```

(Note: the webhook POST endpoint itself is unauthenticated and receives
requests from Razorpay.  The endpoints below require a valid JWT token.)

---

## List notifications

```
GET /api/razorpay/webhook/notification
```

**Query parameters** (all optional):

* `status` — notification status field (`SUCCESS`, `FAILED`, etc.)
* `txn_id` — partial match on Razorpay transaction id
* `mid` — merchant id (partial match)
* `tid` — terminal id (partial match)
* `deviceSerial` — device serial (partial match)
* `paymentMode` — payment mode string
* `startDate`, `endDate` — ISO dates to restrict `createdAt` range
* `source` — **razorpay** or **everlife**; filters rows that were recorded
  with the given source value
* `page`, `limit` — pagination controls (defaults: page=1, limit=10)

### Example

To fetch only notifications that originated from the Everlife credentials:

```
GET /api/razorpay/webhook/notification?source=everlife&page=1&limit=20
Authorization: Bearer <token>
```

The server will apply a `WHERE source = 'everlife'` clause in addition to the
other filters.  You may combine `source` with any of the other parameters.

The response is a paginated JSON object containing an array of formatted
notifications and pagination metadata (see `notificationController.js` for
details).

---

## Get a single notification

```
GET /api/razorpay/webhook/notification/:id
```

Requires authentication.  Returns the raw notification record along with the
`source` field so you can tell whether it came from Razorpay or Everlife.

---

## Notes for frontend

* Always include the `Authorization: Bearer <token>` header when calling the
  `/notification` endpoints.
* Use the `source` query parameter to quickly switch between raw Razorpay and
  Everlife-origin notifications for debugging or reporting.
* The backend automatically returns dates and amounts from the parsed
  `event_json` payload when the top-level columns are null.

Feel free to copy this markdown into your frontend documentation site or
Postman collection.