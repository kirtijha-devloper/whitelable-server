# Vimo Payout Integration & Flow Documentation

This document describes the complete flow, API details, cryptography system, and database logic implemented in the backend for the **Vimo Payout** service.

---

## 1. Directory Structure & Key Files
- **Service Layer**: [vimo.service.js](file:///d:/AbheePay/POS-SERVER/services/vimo.service.js) — Handles encryption/decryption, token authorization caching, and outgoing API requests to the Vimo bank provider.
- **Controller Layer**: [vimoController.js](file:///d:/AbheePay/POS-SERVER/controllers/vimoController.js) — Manages request validation, ledger debiting/refunding, concurrency locks, duplicate checks, callback processing, and manual admin recovery.
- **Routing Layer**: [vimoRoutes.js](file:///d:/AbheePay/POS-SERVER/routes/vimoRoutes.js) — Exposes API endpoints for the client and webhook callbacks.
- **Penny Drop Validator**: [instantpayService.js](file:///d:/AbheePay/POS-SERVER/services/payments/instantpayService.js) — Validates bank accounts prior to beneficiary registration.

---

## 2. Base Configuration & Authentication
All endpoints (except the public webhook callback) require authentication via `Authorization: Bearer <token>`.

### Authentication/Token Generation
Vimo requires a bearer token generated via dynamic signature authorization.
* **Internal route**: `GET` / `POST` `/api/vimo/auth/token`
* **Provider endpoint**: `/payoutapi/api/signature/authorize`
* **Headers sent to provider**:
  ```http
  secretKey: <VIMO_SECRET_KEY>
  saltKey: <VIMO_SALT_KEY>
  encryptdecryptKey: <VIMO_ENCRYPTDECRYPT_KEY>
  userId: <VIMO_USER_ID>
  ```
* **Internal Behavior**: The backend caches this token (`tokenCache`) for up to 10 minutes (configurable via `VIMO_TOKEN_TTL_MS` in the `.env` file). If the cache is expired or the provider returns a `401 Unauthorized` response, a fresh token is fetched automatically.

---

## 3. Cryptography & Payload Formats
Vimo payloads are encrypted to ensure security during transit. The cryptography module in `vimo.service.js` handles both encryption of outgoing requests and decryption of incoming responses.

### Key Derivation & Candidates
The cryptocontext is derived dynamically based on key source variables:
- **Keys used**: `secretKey`, `saltKey`, and `encryptdecryptKey` configured in env.
- **Key Encoding**: Decided via `VIMO_CRYPTO_KEY_ENCODING` (`utf8`, `hex`, or `auto`).
- **IV Encoding**: Decided via `VIMO_CRYPTO_IV_ENCODING` (`utf8`, `hex`, or `auto`).
- **Cipher Modes**: The service attempts encryption using **AES-GCM** (fallback to **AES-CBC**).
- **Candidate Contexts**: During decryption, if the default context fails, the service sequentially iterates through multiple candidate contexts (trying different encoding modes and IV lengths) to ensure robust payload decryption.

### Encryption (`encryptPlainText`)
- Outgoing JSON requests are stringified and encrypted.
- **Auth Tag**: For AES-GCM, the generated 16-byte authentication tag is appended to the ciphertext.
- **Payload Wrapper**: The encrypted payload is base64-encoded and sent wrapped inside a single `requestBody` property:
  ```json
  {
    "requestBody": "ENCRYPTED_BASE64_STRING..."
  }
  ```

### Decryption (`decryptCipherText`)
- Decrypts the raw string or the `data`/`responseData` property of response bodies.
- Decrypts using **AES-GCM**. If tag authentication fails, falls back to **AES-CBC**.
- **Decompression**: If the decrypted buffer contains zipped data, it is decompressed using **GZIP** (fallback to standard inflate/unzip).
- **Format Fallbacks**: If the response is already in plain readable UTF-8 or a simple base64-encoded string, it bypasses AES decryption.

---

## 4. Master Data & Helper APIs
To ensure request compatibility, the service interacts with several Vimo master endpoints.

### Fetch Bank List
* **Endpoint**: `GET /api/vimo/banks`
* **Provider URL**: `/masterapi/api/master/banklist`
* **Caching**: The complete bank list is cached locally in memory for **24 hours** to prevent hitting rate limits.
* **Bank Code Resolution**: When initiating a payout, the client may send a bank name or bank code. The backend uses `resolveBankCode` to match the bank against the cached list (using normalized exact matching, followed by partial string matching) to identify the correct Vimo bank code (e.g. `SBIN` -> code).

### Fetch Purpose & State Lists
* **Endpoints**: `GET /api/vimo/purposes`, `GET /api/vimo/states`
* **Provider URLs**: `/masterapi/api/master/purposelist`, `/masterapi/api/master/statelist`
* **Role**: Exposes valid alphanumeric codes for payment purposes (e.g., `MERCHANT_PAYOUT`) and state locations (e.g., `DL`).

### Wallet Balance Lookup
* **Endpoint**: `GET /api/vimo/balance`
* **Vimo URL Candidates**: The backend checks multiple candidate URLs sequentially due to variations in Vimo environments:
  1. `/gateway/api/payment/getwalletDetail`
  2. `/gateway/api/payment/getWalletDetail`
  3. `/payoutapi/api/payment/getwalletDetail`
  4. `/payoutapi/api/payment/getWalletDetail`
* **Params**: Requires an active `merchantRefId` to query the provider.

---

## 5. Beneficiary Management & Safeguards
Before initiating a payout, a merchant must register and verify a beneficiary.

### Add Beneficiary
* **Endpoint**: `POST /api/vimo/beneficiaries`
* **Payload**:
  ```json
  {
    "name": "John Doe",
    "account_number": "1234567890",
    "ifsc_code": "SBIN0000001",
    "bank_name": "State Bank of India",
    "bank_code": "SBIN",
    "branch_name": "Main Branch",
    "state": "DL",
    "mobile": "9876543210",
    "email": "johndoe@example.com"
  }
  ```
* **Execution Flow**:
  1. **InstantPay BAV Validation**: The backend calls `instantpayService.verifyBankAccount` (Penny Drop) to verify the account details.
  2. **Penny Drop Verification Charge**: 
     > [!NOTE]
     > The InstantPay Penny Drop validation previously charged a ₹3 fee to the merchant's wallet. In the current codebase, the charge logic inside `instantpayService.js` is inactive/commented out.
  3. **Verification Check**: If the validation status is `FAILED`, registration is rejected with `400 Bad Request`.
  4. **Database Persist (Smart Update / De-duplication)**:
     - Checks if a beneficiary with the same account number and IFSC code already exists for the merchant.
     - **If exists**: Updates mutable fields (ensuring existing non-null fields like `state` are not overwritten with nulls if omitted in the new request) and changes status to `active`.
     - **If new**: Creates a new record in the `Beneficiaries` table.

### Beneficiary Limit Check Safeguard
A dedicated endpoint is exposed to retrieve the remaining monthly limit of a beneficiary based on their account number. This works as a local safeguard to avoid making redundant calls to the provider.
* **Endpoint**: `POST /api/vimo/payout/limit-check`
* **Payload**:
  ```json
  {
    "accountNumber": "1234567890",
    "bankIfsc": "SBIN0000001",
    "provider": "Vimo"
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "provider": "Vimo",
    "accountNumber": "1234567890",
    "bankIfsc": "SBIN0000001",
    "monthlyTotal": 150000.00,
    "limit": 500000.00,
    "remainingLimit": 350000.00
  }
  ```

---

## 6. Payout Initiation Flow
Initiates a fund transfer from the merchant's wallet to the beneficiary bank account.

### Create Payout Request
* **Endpoint**: `POST /api/vimo/payout`
* **Payload**:
  ```json
  {
    "user_id": 2,
    "amount": 1000.00,
    "beneficiary_id": 14,
    "paymentPurpose": "MERCHANT_PAYOUT",
    "paymentMode": "IMPS",
    "lat": "28.6139",
    "long": "77.2090",
    "merchantRefId": "MV-123456" 
  }
  ```

### Execution Diagram & Steps
```mermaid
sequenceDiagram
    participant Frontend
    participant Controller as vimoController
    participant DB as Sequelize Database
    participant VimoAPI as Vimo Payout Gateway
    
    Frontend->>Controller: POST /api/vimo/payout
    
    rect rgb(240, 248, 255)
        note right of Controller: Validation Checks
        Controller->>Controller: 3-Min Duplicate Submission Guard
        Controller->>Controller: Monthly Limit Check (Max ₹500,000 / Beneficiary)
        Controller->>Controller: Resolve Service Charge (Slab Rates)
    end
    
    rect rgb(250, 240, 230)
        note right of Controller: Transaction & Wallet Locking
        Controller->>DB: Start SQL Transaction & Lock User row
        Controller->>DB: Check wallet balance >= Amount + Charge
        Controller->>DB: Check merchantRefId uniqueness
        Controller->>DB: Create PayoutTransaction (status = 'Processing')
        Controller->>DB: Create PayoutAuditLog (VIMO_PAYOUT_INIT)
        Controller->>DB: Debit Wallet (Ledger service entry)
        Controller->>DB: Commit SQL Transaction
    end

    Controller->>VimoAPI: POST /payoutapi/api/payment/payout (Encrypted GCM)
    VimoAPI-->>Controller: Encrypted Response Payload
    Controller->>Controller: Decrypt using AES-GCM / AES-CBC
    Controller->>DB: Log VIMO_PAYOUT_RESPONSE / update transaction details
    Controller-->>Frontend: Return Payout confirmation (Pending/Success status)
```

1. **3-Minute Duplicate Guard**: Prevents accidental double clicks. Checks for any active non-failed payouts with the same user, amount, and beneficiary within the last 3 minutes.
2. **Monthly Cap Check**: Checks total non-failed payouts for this beneficiary in the current calendar month. The maximum allowed is **₹500,000**.
   - **Note**: The system queries globally across all transactions matching the beneficiary's bank account number in the `data` payload, ensuring accurate calculation across duplicate beneficiary records and raw payouts.
3. **Service Charge Resolution**: Queries `PayoutCharge` table for active slab rules based on the payout amount. If none exist, falls back to `VIMO_DEFAULT_SERVICE_CHARGE` env variable.
4. **Concurrency Safety & Balance Deduct (SQL Transaction)**:
   - Locks the user row (`transaction.LOCK.UPDATE`) to serialise balance checks and avoid race conditions.
   - Verifies if the merchant's balance is sufficient for `Amount + Service Charge`.
   - Deducts the full amount from the ledger wallet and creates a `PayoutTransaction` with status `Processing`.
5. **API Dispatch**: Payload is JSON-stringified, encrypted via `AES-GCM` (using `VIMO_ENCRYPTDECRYPT_KEY` and `VIMO_SALT_KEY` as IV), and posted to Vimo.
6. **Response Decryption**: Decrypts the response envelope using AES-GCM (fallback to AES-CBC / gzip decompress). The transaction fields are updated, and the user receives a confirmation.

---

## 7. Payout Status Check
A merchant or cron job can fetch the latest transaction status from Vimo.
* **Endpoint**: `GET` / `POST` `/api/vimo/payout/status`
* **Query/Body Params**: `merchantRefId` or `txnId`
* **Internal Behavior**:
  1. Calls Vimo `/payoutapi/api/payment/payoutstatuscheck`.
  2. **Plain Text Encryption**:
     > [!IMPORTANT]
     > Unlike normal payloads, the status check API expects a **raw string** value of the ID (`merchantRefId` or `txnId`) rather than a JSON object. This raw string is encrypted directly and wrapped in the `requestBody` envelope.
  3. Decrypts the response payload.
  4. Writes a beautifully formatted log entry detailing the transaction states, encryption, and decrypted responses to `logs/vimoStatusCheck.log`.

---

## 8. Webhook / Callback Handler
Vimo calls this endpoint to notify the server of status updates asynchronously.
* **Endpoint**: `POST /api/vimo/callback` (Public)

### Processing Logic
1. **Auditing**: Raw payload is immediately persisted to `PayoutWebhookLog`.
2. **Fast Response**: Responds `200 Success` (responseCode `000`) immediately to Vimo to prevent duplicate webhook retries.
3. **Background Job**: Processing is queued immediately using `setImmediate`:
   - Checks if the transaction is already in a terminal state (`SUCCESS`, `FAILED`, `REVERSED`, `CANCELLED`). If so, **skips** processing to avoid duplicate updates.
   - Maps status:
     - `SUCCESS` / `TRANSFERRED` $\rightarrow$ `SUCCESS`
     - `FAILED` / `FAILURE` / `REJECTED` / `REVERSED` / `CANCELLED` $\rightarrow$ `FAILED`
   - Updates `PayoutTransaction` state, UTR, and callback receipt details.
   - **Refund Logic**: If marked `FAILED`, checks if a refund has already been credited to the ledger. If not, creates a credit ledger entry (`payout_refund`) returning the principal amount + service charge back to the merchant's wallet.

---

## 9. Manual Recovery (Admin override)
If a payout gets stuck in `Processing` due to network loss or missing callbacks, admins can manually mark it failed.
* **Endpoint**: `POST /api/vimo/payout/admin/fail` (Requires `PAYOUT_MANAGE` permission)
* **Rule**: Payout must have been stuck in `Processing` for **at least 10 minutes**.
* **Effect**: Marks transaction as `FAILED`, updates callback status, and credits the principal + service charge back to the merchant's wallet.
