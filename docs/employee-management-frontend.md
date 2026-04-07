# Employee Management Frontend Integration

This document covers the frontend changes required after merging the employee management feature into `Dev2`.

## Summary

The backend merge introduces:
- a new `employee` user role
- action-based permissions for employee users
- employee-aware access control for many admin/operational routes
- admin direct-login support for employees
- new user registration/update rules for employee creation and permission assignment

## Frontend impact

### 1. Support `employee` role in user registration and update flows

The frontend must treat `employee` as a valid role in all user management forms.

#### User creation
- `POST /api/user/register`
- New or updated form fields:
  - `role` must support `employee`
  - `permissions` may be provided only when `role` is `employee`
  - `permissions` is an admin-only field and must be a JSON array string or array of slugs
- For employee users, `bank_passbook` is not required.

#### User update
- `PUT /api/user/:id`
- Only `admin` may update:
  - `role`
  - `permissions`
- `permissions` may only be set when the target user is `employee`

### 2. Use employee permission slugs for UI visibility and routing

For `employee` users, the frontend can no longer rely on `role` alone for feature access.
Employee users now require explicit permission slugs to access modules.

#### `GET /api/user/current`
- The current-user payload includes `permissions`.
- Frontend must read this array and derive access from it.

#### New permission slugs introduced

| Permission slug | Frontend meaning | Example feature or page |
|---|---|---|
| `users.create` | Can create users | New user form access |
| `users.list` | Can list users/merchants | User list page |
| `users.search` | Can search users | Search box enabled |
| `users.read` | Can read user details | User-detail page |
| `users.update` | Can update users | Edit user page |
| `users.status.update` | Can change user status | Enable/disable controls |
| `stock.pos.read` | Can view POS machines | POS machine listing |
| `stock.pos.manage` | Can manage POS machines | Create/activate POS machines |
| `wallet.read` | Can view wallet info | Wallet-related dashboard widgets |
| `wallet.manage` | Can perform wallet operations | Credit/debit/reconcile UI |
| `reports.read` | Can see reports | Reports menu |
| `payout.read` | Can view payouts | Payout dashboard |
| `ledger.read` | Can view ledger entries | Ledger page |
| `ledger.manage` | Can manage ledger entries | Ledger edit actions |
| `complaints.read` | Can read complaints | Complaints list |
| `complaints.manage` | Can manage complaints | Complaint status update |
| `rate.settings.read` | Can view charge/commission settings | Rate settings pages |
| `rate.settings.manage` | Can manage charge/commission settings | Add/update/delete rate rules |
| `razorpay.notifications.list` | Can list Razorpay notifications | Notification page access |
| `razorpay.notifications.read` | Can view notification details | Notification detail page |

> Note: `admin` users continue to have full access.

### 3. Update menu/navigation guards

If your frontend currently hides features using only `role !== 'admin'`, update it to also check employee permissions.

Example logic:
- `admin` always sees admin features
- `employee` sees a feature only if `currentUser.permissions` contains the required slug
- non-employee roles follow existing role-based rules

### 4. Extend user listing / search behavior

The backend now supports `role=employee` on `GET /api/user/`.
- Add `employee` to role filter dropdowns
- If the frontend lists employees, show their assigned permission slugs in the row or details pane

### 5. Admin direct-login now includes employees

The `Login as` feature can now target `employee` users.
Update admin user list and direct-login UI to include employee rows.

Relevant endpoints:
- `POST /api/admin/dl-token`
- `GET /api/admin/dl-token/status`
- `DELETE /api/admin/dl-token`
- `POST /api/admin/direct-login`

### 6. Permission editing UI for admins

Admins should be able to assign employee permissions when creating or editing an employee.
- Provide a list of checkboxes or multiselect containing the valid permission slugs
- Submit as `permissions` in the request body
- Only show this field when `role === 'employee'`

## Required frontend changes by section

### User management
- Allow selecting `employee` as a role on registration/update forms
- Show and validate `permissions` only for employee users
- Do not require `bank_passbook` for `employee` registration
- Ensure only admins can send `permissions` in requests

### Authentication/current user state
- Persist and use `permissions` from `/api/user/current`
- Derive UI access rules from `permissions` for employees
- Keep existing full-access behavior for `admin`

### Menu and page guards
- Add permission checks to pages such as:
  - Wallet adjustments
  - POS machine management
  - Ledger and report dashboards
  - Complaint management
  - Route/charge/payout settings
  - Razorpay webhook notifications
- Avoid showing restricted pages to employees without the matching slug

### Direct-login UI
- Include employees in the direct-login target list
- Ensure the direct-login token workflow is implemented as documented in `docs/admin-direct-login-api.md`

### Error handling
- Backend may return `403` for employees lacking the required slug.
- Show a user-friendly "Insufficient permissions" message when that occurs.

## Implementation notes

### Permission field format
- `permissions` can be sent as a JSON string or JSON array
- Example payload for creating an employee:

```json
{
  "email": "employee@example.com",
  "password": "Secret123!",
  "mobile_number": "9876500000",
  "role": "employee",
  "permissions": [
    "users.list",
    "wallet.manage",
    "reports.read"
  ]
}
```

### Example user update payload

```json
{
  "name": "Ravi Kumar",
  "permissions": [
    "users.read",
    "rate.settings.read"
  ]
}
```

> Only admins may send or update `permissions` through the user API.

## Recommended frontend checklist

- [ ] Add `employee` role option in user forms
- [ ] Add employee permission selector for admin-only flows
- [ ] Use `currentUser.permissions` for employee page access
- [ ] Update role filters and employee listing UIs
- [ ] Extend direct-login UI for employee accounts
- [ ] Handle 403 permission rejections gracefully
- [ ] Validate `permissions` payload before sending to backend

## Helpful backend references

- `docs/API_DOCUMENTATION.md` — user creation/update and permission behavior
- `docs/admin-direct-login-api.md` — direct-login workflow
- `docs/razorpay-notifications-api.md` — permission-driven notifications access
- `middleware/employeePermissionHandler.js` — employee permission enforcement
- `utils/permissions.js` — canonical permission slug list

---

This document is intended to be copied into your frontend team documentation or sprint notes.
