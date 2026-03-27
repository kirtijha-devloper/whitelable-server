# Frontend Implementation Guide

This document provides a practical integration guide for building the frontend client for the POS server in this repository.

## 1. Overview

- Project: `pos-server` (Node.js/Express API).
- Base URL: `http://localhost:<PORT>` (default from `server.js` or environment vars).
- Auth model: token-based (likely JWT) with login endpoint.
- Common entities: Users, Wallets, Charges, Transactions, Payouts, POS Machines.

## 2. Setup

1. Clone the repository:

   ```bash
   git clone <repo-url>
   cd pos-server
   npm install
   npm start
   ```

2. Ensure environment variables are configured in `.env` or in your deployment target (DB connection, `PORT`, API keys, etc.).
3. Confirm backend is running and API docs routes are accessible (existing docs in `docs/`).

## 3. Authentication

### Login
- Endpoint: `POST /api/v1/auth/login` (or similar in routes). 
- Payload:
  - `username` or `email`
  - `password`

### Expected response
- `token` (JWT)
- user data

### Frontend flow
1. Collect credentials from login form.
2. Send `POST` request.
3. Store token in `localStorage` or `sessionStorage`.
4. Add `Authorization: Bearer <token>` header for protected calls.

## 4. Common API Patterns

- HTTP methods:
  - `GET` for listing/fetching
  - `POST` for creation
  - `PUT/PATCH` for updates
  - `DELETE` for deletion
- Standard request headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>`

### Example fetch helper

```js
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3000/api/v1';

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function apiFetch(route, options = {}, token) {
  const res = await fetch(`${API_BASE}${route}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...options.headers,
      ...authHeaders(token),
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || `HTTP error ${res.status}`);
  }
  return res.json();
}
```

## 5. Core features / sample endpoints

### Users
- `GET /users` - list users
- `GET /users/:id` - user details
- `POST /users` - create user
- `PATCH /users/:id` - update user
- `DELETE /users/:id` - delete user

### Newly Created User Search (User Search)
- `GET /users/search` - search and filter users with query text and pagination

#### Query parameters
- `q` (optional): text query for `name`, `email`, `username`, `mobile_number`.
- `status` (optional): filter by user status.
- `role` (optional): filter by role (`admin`, `franchaise`, etc.).
- `limit` (optional, default `10`): page size.
- `offset` (optional, default `0`): pagination offset.
- `page` (optional, used in response metadata).

#### Example request
```js
const token = localStorage.getItem('token');
const params = new URLSearchParams({ q: 'john', status: 'active', limit: '25', offset: '0' });
const res = await fetch(`${API_BASE}/users/search?${params.toString()}`, {
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
});
const data = await res.json();
```

#### Example response
```json
{
  "success": true,
  "message": "User search results",
  "data": [
    {
      "id": 123,
      "name": "John Doe",
      "email": "john@example.com",
      "username": "john123",
      "wallet_balance": 540.25,
      "pos_machine_count": 2,
      ...
    }
  ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 25,
    "totalPages": 2
  }
}
```

### POS Charge
- `GET /pos-charges` etc.
- `POST /pos-charges` with invoice/purchase data.

### Wallet and transactions
- `GET /wallets/:id/balance`
- `POST /wallets/:id/transfer`

### KYC and merchant flows
- `POST /kyc` / `GET /kyc/:id`

### Service charges & rules
- `GET /pos-charge-rules`
- `POST /pos-charge-rule`

### Razorpay (if available)
- `POST /razorpay/pay`
- `POST /razorpay/notify` (callback)

## 6. Error handling

- Check `res.status`
- Handle 401/403 by redirecting to login.
- Show user-friendly messages.

## 7. Security best practices

- Do not store JWT in localStorage if XSS is a concern; prefer httponly cookies.
- CSRF protection with same-site cookies if using sessions.
- Validate user input and sanitize before send.

## 8. Testing

- Use tools like Postman/Insomnia to exercise endpoints before coding UI.
- Use `npm test` if unit tests exist.

## 9. Example workflows

### Login and dashboard present
1. User submits login form.
2. Store token.
3. Fetch `/dashboard` or `/dashboard/stats`.
4. Render wallet and transactions.

### Create a charge rule
1. Collect rule input.
2. `POST /pos-charge-rule`.
3. Update UI to reflect new rule list.

## 10. Adding frontend routes

- Use single-page router (`react-router`, `vue-router`, etc.).
- `/login`, `/dashboard`, `/users`, `/transactions`, `/settings`.
- Protect authenticated routes with route guards.

---

> Note: adapt endpoints and field names to exactly match routes in this backend codebase. Inspect `routes/` and controller functions under `controllers/` for definitive API paths.
