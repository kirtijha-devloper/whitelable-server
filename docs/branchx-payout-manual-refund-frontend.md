# BranchX Payout Manual Refund — Frontend Implementation Guide

> Base URL: **`/api/payment/v2`**
> Requires a valid JWT in the `Authorization: Bearer <token>` header.
> This endpoint is restricted to admin users or employees with the `payout.manage` permission.

---

## When to use manual refund

Use manual refund only when a BranchX payout has been confirmed as `FAILED` by a stored BranchX status response, and the payout was created on or after `2026-04-26T00:00:00Z`.

This endpoint is not a generic payout cancel API. It is specifically for creating a refund ledger entry after a payout failure is already known.

---

## Prerequisite

Before calling manual refund, the frontend should first call the BranchX status check endpoint for the payout to ensure the stored BranchX response is available:

- **POST** `/api/payment/v2/payout/status-check`

The status check must have been executed at least once for this payout so the server has persisted the BranchX response.

---

## Manual refund endpoint

**POST** `/api/payment/v2/payout/manual-refund`

### Request body

One of these fields is required:

- `payout_transaction_id` — internal payout transaction ID
- `requestId` — BranchX request/reference ID (`reference_id`)

Example:

```json
{
  "payout_transaction_id": 123,
  "requestId": "BRX-REF-20260427-0001"
}
```

### Success response

If the refund is created successfully:

```json
{
  "success": true,
  "message": "Manual refund created successfully",
  "action": "manual_refund_created",
  "refundCreated": true,
  "payoutTransactionId": 123,
  "status": "FAILED",
  "branchxStatus": "FAILED",
  "data": { ...stored BranchX status response... }
}
```

If the payout already has an existing refund entry, the response is still successful:

```json
{
  "success": true,
  "message": "Refund already exists; no action taken",
  "action": "manual_refund_skipped_existing",
  "refundCreated": false,
  "payoutTransactionId": 123,
  "status": "FAILED",
  "branchxStatus": "FAILED",
  "data": { ...stored BranchX status response... }
}
```

---

## Error cases

### 403 — not admin

```json
{
  "success": false,
  "message": "Only admin can perform manual refunds"
}
```

### 400 — missing identifier

```json
{
  "success": false,
  "message": "Either payout_transaction_id or requestId is required"
}
```

### 404 — payout not found

```json
{
  "success": false,
  "message": "Payout transaction not found"
}
```

### 400 — payout too old for manual refund

```json
{
  "success": false,
  "message": "Manual refund is allowed only for payouts created on or after 2026-04-26T00:00:00.000Z"
}
```

### 400 — missing BranchX stored status

```json
{
  "success": false,
  "message": "Manual refund requires a previously fetched BranchX status response. Please use status check first."
}
```

### 400 — stored BranchX status not FAILED

```json
{
  "success": false,
  "message": "Stored BranchX status must be FAILED to issue a manual refund",
  "branchxStatus": "SUCCESS|PENDING|UNKNOWN",
  "statusCode": "...",
 "data": { ... }
}
```

---

## Recommended frontend flow

1. Display payout details on the admin payout review screen.
2. If the payout is eligible for manual refund, call `/payout/status-check` first.
3. Confirm the stored BranchX status is `FAILED`.
4. Call `/payout/manual-refund` with `payout_transaction_id` or `requestId`.
5. If `refundCreated` is `true`, show a success toast and update UI state.
6. If `refundCreated` is `false`, show a notice that the refund was already issued.

---

## Notes

- The endpoint only issues a ledger credit; it does not change the payout amount or reverse the original debit entry.
- A manual refund is only allowed for payouts created on or after the effective policy date.
- Use the same `requestId`/`reference_id` stored from the payout record or previous BranchX status-check result.
