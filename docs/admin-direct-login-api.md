# Admin Direct Login API

Allows an admin to open any merchant, franchisee, or employee account in a new tab **without knowing their password**. The admin's own session is unaffected.

---

## How It Works (Big Picture)

```
Admin logs in normally
        │
        ▼
Admin UI calls POST /api/admin/dl-token  ←─ do this ONCE when the user-list page loads
Gets back a short-lived dl_token (raw, 64-char hex string)
Store it in JS memory / React state (NOT localStorage)
        │
        ▼
User list renders.  Each row has a "Login as" button.
When admin clicks a button, JS calls POST /api/admin/direct-login
with { dl_token, user_id }
Gets back a normal user JWT
        │
        ▼
Open the user dashboard in a new tab using that JWT.
Admin's tab keeps its own admin session — completely separate.
```

---

## Endpoints

| Method | URL | Who calls it | Auth |
|---|---|---|---|
| `POST` | `/api/admin/dl-token` | Admin UI on page load | Admin Bearer JWT |
| `GET` | `/api/admin/dl-token/status` | Admin UI (optional keep-alive check) | Admin Bearer JWT |
| `DELETE` | `/api/admin/dl-token` | Admin UI on logout / revoke button | Admin Bearer JWT |
| `POST` | `/api/admin/direct-login` | Admin UI on "Login as" click | `dl_token` in body |

---

Target users allowed for direct login:
- `merchant`
- `franchaise`
- `employee`

Target users still blocked:
- `admin`

## Step-by-Step Integration

### Step 1 — Admin Logs In (existing flow, no change)

```http
POST /api/user/verify-otp
Content-Type: application/json

{
  "mobile_number": "9876500000",
  "otp": "123456",
  "purpose": "login"
}
```

```json
{
  "success": true,
  "token": "<admin_jwt>"
}
```

Store `admin_jwt` in your auth state as usual.

---

### Step 2 — Generate DL Token (when user-list page mounts)

Call this **once when the user-list page/component loads** — NOT on every button click.

```http
POST /api/admin/dl-token
Authorization: Bearer <admin_jwt>
```

```json
{
  "success": true,
  "message": "Direct-login token generated. Valid for 120 minutes.",
  "data": {
    "dl_token": "a3f9c2e1...64hexchars...b7d0",
    "expires_at": "2026-02-26T12:30:00.000Z",
    "ttl_minutes": 120,
    "warning": "Store this token in your session. It cannot be retrieved again — you must regenerate if lost."
  }
}
```

> **Important:** `dl_token` is returned **once only**. The server stores only its hash.
> Keep it in a JS variable or React `useRef` — never in `localStorage` or `sessionStorage`.

If you call this again (e.g. page refresh), the old token is **immediately invalidated** and a new one is issued.

---

### Step 3 — Login as a User (on "Login as" button click)

```http
POST /api/admin/direct-login
Content-Type: application/json

{
  "dl_token": "a3f9c2e1...64hexchars...b7d0",
  "user_id": 42
}
```

```json
{
  "success": true,
  "message": "Logged in as Ravi Kumar (merchant).",
  "token": "<user_jwt>",
  "user": {
    "id": 42,
    "name": "Ravi Kumar",
    "mobile_number": "9876543210",
    "role": "merchant",
    "abheepay_id": "APM0042",
    "organization_name": "Ravi Enterprises"
  }
}
```

Use `token` (the `user_jwt`) to open the user's dashboard — store it in the new tab's session.

---

### Step 4 — Open in New Tab

Pass the user JWT to the new tab. There are two clean ways to do this:

**Option A — `sessionStorage` via the opener:**
```javascript
// In admin tab
const newTab = window.open('/user-dashboard', '_blank');
newTab.addEventListener('load', () => {
  newTab.sessionStorage.setItem('token', userJwt);
});
```

**Option B — URL param (short-lived, then clear from URL):**
```javascript
// In admin tab
window.open(`/user-dashboard?session_token=${encodeURIComponent(userJwt)}`, '_blank');

// In user-dashboard page (on mount):
const params = new URLSearchParams(window.location.search);
const token = params.get('session_token');
if (token) {
  sessionStorage.setItem('token', token);
  // Remove token from visible URL
  window.history.replaceState({}, '', window.location.pathname);
}
```

---

## Optional — Check Token Status

Use this to show the admin a warning if their DL token is about to expire, or to avoid regenerating unnecessarily.

```http
GET /api/admin/dl-token/status
Authorization: Bearer <admin_jwt>
```

**Response — active token:**
```json
{
  "success": true,
  "active": true,
  "data": {
    "expires_at": "2026-02-26T12:30:00.000Z",
    "used_user_ids_count": 3,
    "created_at": "2026-02-26T10:30:00.000Z"
  }
}
```

**Response — no active token:**
```json
{
  "success": true,
  "active": false,
  "message": "No active direct-login token. Call POST /api/admin/dl-token to generate one."
}
```

---

## Optional — Revoke Token

Call this when the admin logs out, or provide a manual "Revoke" button for security-conscious admins.

```http
DELETE /api/admin/dl-token
Authorization: Bearer <admin_jwt>
```

```json
{
  "success": true,
  "message": "Direct-login token revoked successfully."
}
```

---

## Error Responses

| Status | `message` | Cause |
|---|---|---|
| `400` | `dl_token is required.` | Missing `dl_token` in body |
| `400` | `user_id is required and must be a number.` | Missing or non-numeric `user_id` |
| `401` | `Invalid or expired direct-login token.` | Token is wrong, tampered, or expired |
| `403` | `Admin access only.` | Token belongs to non-admin user |
| `404` | `Target user not found or cannot be impersonated...` | `user_id` doesn't exist or is an admin account |
| `409` | `This user has already been logged in via this token.` | Same `(dl_token, user_id)` used twice — regenerate the DL token for a fresh attempt |
| `422` | `Target user account is inactive.` | User's `status` is not `active` |

---

## Complete React Example

```jsx
// components/UserListPage.jsx
import { useState, useEffect, useRef } from 'react';

const API = '/api';

export function UserListPage({ adminToken }) {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState({});  // { [userId]: true/false }
  const dlToken = useRef(null);                // DL token stored in memory only

  // ── Generate DL token once when the page mounts ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/admin/dl-token`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        const data = await res.json();
        if (data.success) {
          dlToken.current = data.data.dl_token;
        }
      } catch (err) {
        console.error('Failed to generate DL token:', err);
      }
    })();

    // Revoke token when admin navigates away from this page
    return () => {
      if (dlToken.current) {
        fetch(`${API}/admin/dl-token`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
          keepalive: true,   // fires even if the component unmounts mid-request
        });
      }
    };
  }, [adminToken]);

  // ── Load user list ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/user?role=merchant`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then(r => r.json())
      .then(d => setUsers(d.data || []));
  }, [adminToken]);

  // ── Login as user ─────────────────────────────────────────────────────────
  const loginAs = async (userId) => {
    if (!dlToken.current) {
      alert('Direct-login token not available. Please refresh the page.');
      return;
    }
    if (loading[userId]) return;  // prevent double-click

    setLoading(prev => ({ ...prev, [userId]: true }));
    try {
      const res = await fetch(`${API}/admin/direct-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dl_token: dlToken.current, user_id: userId }),
      });
      const data = await res.json();

      if (!data.success) {
        // 409 means this user was already opened — regenerate token if needed
        if (res.status === 409) {
          alert('This user was already opened in a tab. Refresh the page to generate a new session token.');
        } else {
          alert(data.message || 'Direct login failed.');
        }
        return;
      }

      // Open user dashboard in a new tab using URL param method
      const url = `/user-dashboard?session_token=${encodeURIComponent(data.token)}`;
      window.open(url, '_blank');
    } catch (err) {
      console.error('Direct login error:', err);
      alert('Something went wrong. Please try again.');
    } finally {
      setLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  return (
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Name</th><th>Role</th><th>Mobile</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        {users.map(user => (
          <tr key={user.id}>
            <td>{user.id}</td>
            <td>{user.name}</td>
            <td>{user.role}</td>
            <td>{user.mobile_number}</td>
            <td>
              <button
                onClick={() => loginAs(user.id)}
                disabled={loading[user.id]}
              >
                {loading[user.id] ? 'Opening…' : 'Login as'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```jsx
// pages/UserDashboard.jsx — reads the token from URL on mount
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function UserDashboard({ setAuthToken }) {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('session_token');

    if (token) {
      setAuthToken(token);                             // store in your auth state
      // Remove token from the visible URL immediately
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  return <div>User Dashboard Content…</div>;
}
```

---

## Security Notes for Frontend

| Rule | Reason |
|---|---|
| **Never store `dl_token` in `localStorage` or `sessionStorage`** | Those persist beyond the tab and are readable by XSS |
| **Keep `dl_token` in a `useRef` or closure variable** | Cleared automatically when the tab closes |
| **Generate one DL token per page load, not per click** | Each click reuses the same token; generating per-click would invalidate the previous one mid-use |
| **Revoke the token when the admin navigates away** | Defence-in-depth; token expires automatically anyway |
| **Clear `session_token` from the URL immediately** | Prevents it appearing in browser history or server logs |
