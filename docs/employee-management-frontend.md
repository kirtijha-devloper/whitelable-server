# Employee Management Frontend Integration

This document reflects the current backend contract for employee access management.

## Summary

The backend now supports:
- `employee` as a first-class `User.role`
- admin-managed employee access roles
- one assigned access role per employee
- resolved employee permissions returned from `/api/user/current`
- separate wallet permission slugs for credit and debit
- admin direct-login support for employee accounts

## Core Model

There are now two different role concepts:

1. Top-level user role
- `admin`
- `franchaise`
- `merchant`
- `employee`

2. Employee access role
- admin-defined reusable access-role template
- examples: `management`, `manager`, `account`, `sales`, `support`
- each employee must be assigned exactly one access role

Employees no longer receive direct per-user permissions from frontend.
Frontend should assign `employee_access_role_id`, and backend resolves permissions from that role.

## Admin Access-Role APIs

Base path: `/api/admin/employee-access-roles`

- `GET /meta`
  - returns permission catalog and allowed statuses
- `GET /`
  - list access roles
- `POST /`
  - create access role
- `GET /:id`
  - get access role detail
- `PUT /:id`
  - update access role
- `DELETE /:id`
  - delete access role
  - blocked if assigned to employees

Use these APIs to build the admin UI for:
- create role
- edit role
- list role options for employee assignment

## Employee User Create / Edit

### Create employee
- endpoint: `POST /api/user/register`
- content type: `multipart/form-data`
- required for employee:
  - `email`
  - `password`
  - `mobile_number`
  - `role=employee`
  - `employee_access_role_id`
- `bank_passbook` is not required for employee

Important:
- do not send `permissions`
- backend now rejects direct employee permission assignment

### Update employee
- endpoint: `PUT /api/user/:id`
- admin may change:
  - `role`
  - `employee_access_role_id`
- if target role is `employee`, the assigned `employee_access_role_id` must exist and be active
- if role changes away from `employee`, backend clears the employee access-role assignment

## Current User Contract

`GET /api/user/current` now returns:
- `role`
- `employee_access_role_id`
- `employee_access_role`
  - `id`
  - `name`
  - `slug`
  - `status`
  - `description`
- resolved `permissions`

Example:

```json
{
  "id": 7,
  "role": "employee",
  "employee_access_role_id": 3,
  "employee_access_role": {
    "id": 3,
    "name": "Accounts",
    "slug": "accounts",
    "status": "active",
    "description": null
  },
  "permissions": [
    "wallet.read",
    "wallet.credit",
    "reports.read"
  ]
}
```

Frontend should build employee menu access from `permissions`, not from access-role name.

## Supported Permission Slugs

| Permission slug | Frontend meaning |
|---|---|
| `users.create` | Create users |
| `users.list` | View user list |
| `users.search` | Search users |
| `users.read` | View user detail |
| `users.update` | Edit users |
| `users.status.update` | Activate/deactivate users |
| `stock.pos.read` | View POS machines |
| `stock.pos.manage` | Manage POS machines |
| `wallet.read` | View wallet data |
| `wallet.credit` | Credit wallet balances |
| `wallet.debit` | Debit wallet balances |
| `reports.read` | View reports |
| `payout.read` | View payout pages |
| `ledger.read` | View ledger |
| `ledger.manage` | Manage ledger settings |
| `complaints.read` | View complaints |
| `complaints.manage` | Manage complaints |
| `rate.settings.read` | View rate settings |
| `rate.settings.manage` | Manage rate settings |
| `razorpay.notifications.list` | List Razorpay notifications |
| `razorpay.notifications.read` | View Razorpay notification detail |

## Wallet Permission Notes

Wallet permission split is now:
- `wallet.read`
- `wallet.credit`
- `wallet.debit`

Admin wallet reconcile stays admin-only in this version.

## Frontend Rules

### User creation form
- add `employee` to role options
- when role is `employee`, show access-role selector instead of permission checkboxes
- access-role selector should load from `/api/admin/employee-access-roles`

### User edit form
- if target user role is `employee`, show assigned access role
- allow admin to change the selected access role
- do not send direct `permissions`

### Sidebar / page guards
- `admin` still sees everything
- `employee` only sees features allowed by `currentUser.permissions`
- existing `franchaise` and `merchant` behavior stays unchanged

### Direct login
- admin direct-login can now target employee users too
- existing direct-login UI can include employee rows in the target list

## Suggested Frontend Checklist

- [ ] load employee access-role catalog for admin role management screens
- [ ] load employee access-role list for employee create/edit forms
- [ ] replace direct permission UI on employee forms with access-role selection
- [ ] use `/api/user/current` permissions for employee menu guards
- [ ] split wallet UI guards using `wallet.credit` and `wallet.debit`
- [ ] include employees in admin direct-login target list

## Helpful Backend References

- `routes/employeeAccessRoleRoutes.js`
- `controllers/employeeAccessRoleController.js`
- `controllers/userController.js`
- `middleware/employeePermissionHandler.js`
- `utils/permissions.js`
