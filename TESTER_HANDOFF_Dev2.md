# POS-Server — Tester Handoff (Branch: `Dev2`)

> Generated: 2026-09-17 | Branch: `Dev2` (`origin/Dev2`, HEAD `de54f20`) | Repo: `pos-server`
> Purpose: onboarding + test-plan input for QA. No code changes were made for this doc.

## 1. What this app is

Express backend for POS / payments aggregation:

- **Channel:** merchant / franchise onboarding, POS machines lifecycle
- **Pay-in:** POS transactions via Razorpay / Worldline / PineLabs, CSV upload, reconciliation
- **Payout hub (multi-provider):** Vimo, SevenPay, NDIA5/India5, CredXPay, BranchX, MX (MeroRecharge), SDDS
- **Bills:** BillAvenue + BBPS Credit-Card bill payments
- **Money & rules:** wallet, ledger (passbook), POS charge rule engine + legacy slabs, payout charges, commission, service-fee, rental
- **Insights:** dashboard, reports, complaints, KYC, admin/employee management
- **Platform:** Bull/Redis queues + workers, node-cron reconcilers

Recent `Dev2` commits in scope for regression:

```
de54f20 fix(chargeService): restore pre-Sep 12 specificity formula so provider-specific rules (company_name) keep priority
7e4fa3f fix(ledger): preserve T1 settlement holds regardless of user settlement_type
38c0f5c feat(webhook): integrate resolveEffectiveSettlement in worldline webhook worker for T0 daily limit auto-shift
79a4279 feat: enforce POS payin T0/T1 settlement mode, daily limit auto-shift, settlement hold, and GET /api/user/current payload updates
1e63501 fix(webhook): fix 'src is not defined' ReferenceError in razorpay webhook worker
```

Focus regression: **T0/T1 settlement, settlement-hold release, charge-rule specificity, Worldline/Razorpay webhook workers.**

## 2. Tech stack & runtime

| Layer | Value |
|---|---|
| Runtime | Node.js, Express `4.21.2`, entry `server.js` |
| ORM / DB | Sequelize `6.37.6`. Prod/UAT: Postgres (`pg`). Config: `config/database.js`, `config/dbConnection.js` |
| Tests DB | SQLite in-memory when `NODE_ENV=test` (`config/database.js:5-13`, forced in `test/test-setup.js:1-3`) |
| Async | Redis + Bull (`queues/`, `workers/`), `node-cron` (`cron/`) |
| Auth | JWT Bearer, 5h expiry. `Authorization: Bearer <jwt>` |
| Roles | `admin`, `franchise`, `merchant`, `employee` (+ `employee_access_role_id` → permissions) |
| OTP | Bulk9 DLT SMS + email fallback, same code both channels (`README.MD:24-41`) |
| Uploads | `express-fileupload` for onboard/register + `multer` elsewhere (`server.js:67-92`) |
| Webhook auth | Razorpay/Everlife HTTP Basic Auth via env pairs (`README.MD:43-59`, `utils/razorpay/auth.js`) |
| Port / CORS | `PORT` default `5000`, `origin: '*'` (`server.js:43-63`) |
| Tests | Mocha + Chai + Supertest + Sinon (`package.json`) |

### npm scripts (`package.json:5-14`)

```bash
npm run dev     # nodemon server.js
npm start       # node server.js
npm test        # mocha --exit --file test/test-setup.js "test/**/*.test.js"
npm run seed:test
npm run seed:commissions
npm run seed:billers
npm run seed:fix-sequences
npm run webhook:upi
npm run webhook:card
```

### Required env (ask dev for UAT values — do not use prod)

```
DB_NAME, DB_USER, DB_PASS, DB_HOST, DB_DIALECT, DB_PORT
ACCESS_TOKEN_SECRET
BULK9_API_KEY, BULK9_SENDER_ID
WEBHOOK_USERNAME, WEBHOOK_PASSWORD
WEBHOOK_USERNAME_EVERLIFE, WEBHOOK_PASSWORD_EVERLIFE
PINELABS_* (see .env.pinelabs.example)
PORT, NODE_ENV, SYNC_DB
```

> `SYNC_DB=true` only in local dev, never prod (`server.js:427-429`).

## 3. Project structure

```
server.js                  # route mounts (server.js:119-242), cron/worker boot (server.js:13-39)
config/                    # database.js, dbConnection.js, config.js, billavenue.js
routes/ (41 files)         # HTTP mapping; subfolders: payments/, cc/, razorpay/, worldline/, credxpay/
controllers/ (44 files)    # orchestration; subfolders: payments/, cc/, razorpay/, worldline/, shared/, credxpay/
services/                  # chargeService.js, commissionService.js, ledgerService.js,
                           # settlementService.js, vimo/ndia5/sevenpay/*, billAvenue/bbps, razorpay/worldline
models/ (53 tables)        # User, Transaction, PayoutTransaction, Ledger, WalletTransaction,
                           # PosChargeRule, CommissionDefault, Beneficiary, etc.
                           # + index.js, initAssociations.js
middleware/                # validateTokenHandler.js, employeePermissionHandler.js,
                           # ipAllowlist.js, errorHandler.js, verifyPartnerRequest.js
queues/ + workers/         # razorpayWebhook, worldlineWebhook, wallet (Bull/Redis)
cron/ (8 jobs)             # resolvePendingBranchx/Sevenpay/Ndia5/Mx/CcBill*, releaseSettlementHolds, chargeRentals
migrations/                # Sequelize migrations (prod path)
utils/                     # masking.js, mail.js, emailOtp.js, sendOtp.js, encryption.js,
                           # permissions.js, dateRange.js, sevenpayEncryption.js
docs/ (62 files)           # API + frontend + diagrams (see §6)
test/ (44 files)           # *.test.js suites
scripts/                   # seedTestData, seedCommissions, seed36Billers, testWebhook, etc.
uploads/, logs/, keys/, static/
*.js at root               # manual probes: tempChargeTest.js, testWorkerCalc.js, etc. (do not rely on)
```

Key files for test design:

- `server.js:119-172` — authoritative mount list
- `docs/feature-map.md:346-391` — feature → base-path → route-file matrix
- `models/initAssociations.js` — entity relations
- `middleware/validateTokenHandler.js`, `middleware/employeePermissionHandler.js`, `utils/permissions.js`
- `services/chargeService.js`, `services/settlementService.js`, `services/ledgerService.js`

## 4. API surface (for test-plan modules)

Auth: `POST /api/user/login` (`mobile_number` + `password`) → `accessToken`. Send as `Authorization: Bearer <jwt>` on protected routes.

| Domain | Base path | Route file |
|---|---|---|
| Auth & Users | `/api/user` | `routes/userRoutes.js` |
| Direct Login DL-tokens | `/api/admin` | `routes/directLoginRoutes.js` |
| KYC | `/api/kyc` | `routes/kycRoutes.js` |
| Admin & Employees | `/api/admin`, `/api/admin/employee-access-roles` | `adminRoutes.js`, `employeeAccessRoleRoutes.js` |
| Company Names | `/api/company-name` | `routes/companyNameRoutes.js` |
| Merchants | `/api/merchant` | `routes/merchantRoutes.js` |
| Franchises | `/api/franchaise` | `routes/franchaiseRoutes.js` |
| POS Machines | `/api/pos-machine` | `routes/posMachineRoutes.js` |
| POS Transactions | `/api/transaction` | `routes/transactionRoutes.js` |
| Reconciliation | `/api/reconciliation` | `routes/reconciliationRoutes.js` |
| Razorpay | `/api/razorpay` | `routes/razorpay/webhook/notificationRoutes.js` |
| Worldline | `/api/worldline`, `/api/worldline-notifications` | `routes/worldline/webhook/notificationRoutes.js` |
| PineLabs + test pages | `/api/pinelabs`, `/`, `/api/test` | `pinelabs*Routes.js` |
| Vimo | `/api/vimo` | `routes/vimoRoutes.js` |
| SevenPay | `/api/sevenpay`, `/api/payout-sevenpay` | `routes/sevenpayPayout.routes.js` |
| NDIA5/India5 | `/api/ndia5`, `/api/india5` | `routes/ndia5Payout.routes.js` |
| CredXPay | `/payout/credxpay`, `/payout/credxpay/callback` | `routes/credxpay/` |
| BranchX v2 | `/api/payment/v2` | `routes/payments/branchxRoutes.js` |
| SDDS v1 | `/api/payment/v1` | `routes/payments/sddsRoutes.js` |
| Shared payout/beneficiaries | `/api/payout` | `routes/payoutRoutes.js` |
| BillAvenue | `/api/bill-avenue` | `routes/cc/billAvenue/billAvenueRoutes.js` |
| Credit Bill | `/api/credit-bill` | `routes/cc/billAvenue/creditBillRoutes.js` |
| BBPS CC | `/api/bbps-cc` | `routes/cc/bbps/bbpsCCBillRoutes.js` |
| Wallet | `/api/wallet` | `routes/walletTransactionRoutes.js` |
| Charge slabs | `/api/charge` | `routes/chargeRoutes.js` |
| Legacy POS charge | `/api/pos-charge` | `routes/posChargeRoutes.js` |
| POS charge rule engine | `/api/pos-charge-rules` | `routes/posChargeRuleRoutes.js` |
| POS txn charge | `/api/pos-transaction-charge` | `routes/posTransactionChargeRoutes.js` |
| Payout charges | `/api/payout-charge`, `/api/user-payout-charge` | `payoutChargeRoutes.js`, `userPayoutChargeRoutes.js` |
| Commission | `/api/commission` | `routes/commissionRoutes.js` |
| Service fee / Rental | `/api/service-fee`, `/api/rental` | `serviceFeeRoutes.js`, `rentalRoutes.js` |
| Ledger | `/api/ledger` | `routes/ledgerRoutes.js` |
| Dashboard / Reports / Complaints | `/api/dashboard`, `/api/report`, `/api/complaint` | `dashboard/report/complaintRoutes.js` |

Notes:

- Money movement is always journalized in `Ledger`; wallet ops go via queue/worker.
- Webhooks are signature/IP-verified, queued on Redis/Bull, processed by workers — assert both sync `200` and eventual side-effects.
- `GET /api/user/current` now includes settlement payload (Dev2 change — include in API checks).
- Malformed JSON → `400 {success:false}`; literal `null` body normalized to `{}` (`server.js:99-115`).

## 5. Core flows to cover

1. **Auth/RBAC:** login, send/verify OTP, TPIN generate/verify, forgot/reset/update password, user CRUD, status toggle, promote to franchise/admin, employee permissions, DL-token create/exchange.
2. **Onboarding:** `multipart/form-data` register (email, password, mobile, role, `bank_passbook` required except employee), PAN/Aadhaar/shop photos, franchise→merchant hierarchy, iPay outlet binding.
3. **POS machines:** create/bulk-create, assign to franchise/merchant, activate/deactivate, mark delivered, return initiated, unassign.
4. **Charges & settlement (high priority on Dev2):** rule CRUD scoped by merchant/admin/franchise, `company_name`/brand specificity, CARD/CREDIT/settlement/amount matching, `GET /api/user/current` settlement fields, T0 daily-limit auto-shift, T1 hold creation + next-day release cron.
5. **Pay-in webhooks:** Razorpay/Worldline ingest → queue → worker → ledger/commission; admin process with custom charge; PineLabs callback/upload; CSV upload/preview.
6. **Payouts (per provider):** beneficiaries CRUD, limit check, initiate/status/reference, callback, pending-cron auto-resolve, manual refund, admin-fail stuck, audit logs.
7. **Bills:** biller lookup/fetch/validate/pay/status, deposit enquiry, complaint register/track, BBPS charge rules.
8. **Wallet/Ledger/Reports:** fund request/transfer/hold/unhold, statement/entries/detail, manual refund, all `GET /api/report/*` variants.
9. **Platform:** rental cron, settlement-hold releaser, pending-resolver crons, `GET /api/ping`, `GET /api/debug/ipay`.

## 6. Docs index (in `docs/`)

Start with `feature-map.md` (mindmap + architecture + table), then `API_DOCUMENTATION.md` (~3195 lines, full endpoint ref).

| Topic | File |
|---|---|
| Users, edit, current | `user-api.md`, `user-edit-api.md`, `api-user-current.md`, `api-user-list.md` |
| Admin login, wallet, ledger toggle, payout toggle | `admin-direct-login-api.md`, `admin-wallet-adjustment-api.md`, `admin-enable-ledger-api.md`, `admin-enable-disable-payout.md` |
| POS machine, charge, global rate, rules | `pos-machine-api.md`, `pos-charge.api.md`, `pos-global-rate-api.md`, `pos-charge-rules-api.md`, `pos-charge-rules-frontend.md`, `franchise-pos-charge-rules.md`, `DEBUG_CHARGE_RULE_PREVIEW_GUIDE.md` |
| Commission | `commission.openapi.json`, `commission.postman_collection.json` |
| Payouts | `vimo-*.md`, `branchx-*.md`, `credxpay-*.md`, `NDIA5_*.md`, `7pay-api-integration.md`, `payout-charge-rules-api.md`, `t1-priority-payout.*` |
| Bills | `bbps-cc-*.md`, `billavenue-*.md` |
| Reports/wallet/rental/fees | `report-api.md`, `wallet-balance-api.md`, `rental-api.md`, `rental-rate-api.md`, `service-fee-api.md` |
| Webhooks | `razorpay-*.md` |
| KYC/complaints/dashboard | `kyc-api.md`, `company-name-api.md` |
| Diagrams | `diagrams/`, `*.excalidraw`, `*.svg` |

Postman: `docs/commission.postman_collection.json` is the only checked-in collection — ask devs for remaining collections/environments.

## 7. Existing automated tests (`test/`)

Run locally with no external DB:

```bash
npm test
```

Suites (43 `*.test.js`): `chargeService`, `posChargeRuleRoutes`, `posChargeRoutes`, `posSettlementHold`, `posSettlementRoutes`, `settlementService`, `ledgerService`, `payoutFlow`, `payoutRoutes`, `mxPayout`, `sevenpayPayout`, `ndia5AutoRefund`, `branchxRoutes`, `branchxCallbackForwarding`, `credxpayRoutes`, `vimoIntegration`, `razorpayNotificationRoutes`, `reportRoutes`, `dashboardRoutes`, `commissionController/Routes/DbIntegration`, `serviceFeeRoutes`, `serviceSettingsRoutes`, `serviceToggleAuditLog/Enforcement`, `validateTokenHandler`, `masking`, `userEmailMasking`, `otpRoutes`, `register`, `loginPopupRoutes`, `employee*`, `directLoginRoutes`, `adminWalletRoutes`, `logRoutes`, `resolvePendingCcBillPayment`.

Seed/helpers: `scripts/seedTestData.js`, `seedCommissions.js`, `seed36Billers.js`, `fixSequences.js`, `testWebhook.js`, `testReport.js`, `testChargeRules.js`.

## 8. Local setup for tester (UAT recommended over localhost)

```bash
git fetch && git checkout Dev2 && git pull
npm install
# copy safe UAT .env from dev lead (DB_*, ACCESS_TOKEN_SECRET, BULK9_*, WEBHOOK_*, PINELABS_*)
npm test        # fast SQLite regression
npm run dev     # http://localhost:5000 ; check GET /api/debug/ipay
```

Ask dev lead for: UAT base URL, seeded users per role (admin/franchise/merchant/employee), JWT acquisition steps, provider sandbox keys + callback simulators, Redis/Postgres UAT endpoints, frontend URL if E2E needed.

## 9. Test-plan checklist starter

- [ ] Auth + RBAC matrix (all roles × protected routes, expired/invalid token, employee permission granularity)
- [ ] Onboarding validations (required files, duplicate mobile/email `409`, role constraints)
- [ ] POS machine lifecycle + assignment logs
- [ ] Charge-rule specificity + T0/T1 settlement + hold/release (Dev2 priority)
- [ ] Webhook happy-path + retry + bad-signature + queue-down behavior
- [ ] Payout per-provider happy/fail/pending/manual-refund/audit
- [ ] Bill fetch/pay idempotency + complaint flow
- [ ] Ledger balance invariants (debit == credit legs, failed-payout auto-refund)
- [ ] Reports filter/pagination/coverage for all `GET /api/report/*`
- [ ] File-upload limits (5 MB), CORS preflight, rate-limit, masked PII in logs/responses
- [ ] Cron verification (rental, hold-release, pending resolvers) with clock/data fixtures

## 10. Where to log findings

- App logs: `logs/` (e.g. `logs/mx-payout.log`)
- Uploads: `uploads/` ; static: `static/`
- Debug endpoints (remove/lock in prod): `GET /api/ping`, `GET /api/debug/ipay`, `/api/test/*`
