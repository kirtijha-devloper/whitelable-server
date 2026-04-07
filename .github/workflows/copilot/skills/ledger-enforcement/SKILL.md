---
name: ledger-enforcement
description: Ensure every money-related transaction creates a ledger entry and keeps wallet in sync
---
# Ledger Enforcement Skill

## Purpose
Ensure every money-related transaction in the POS application creates a corresponding entry in the `Ledgers` table and keeps `User.wallet` synchronized.

## When to use
Use this skill when the code involves:
- Wallet debit / credit
- Payout processing
- Recharge or CC bill payment
- Razorpay / external payment reconciliation
- Refund or reversal
- Rental charge / franchise income
- Any financial transaction that affects wallet balance

## Instructions
1. Identify the ledger direction:
   - `debit` > 0 → wallet amount goes out
   - `credit` > 0 → wallet amount comes in
   - `debit` and `credit` must not both be positive
2. Prefer service helpers when available:
   - `ledgerService.createLedgerEntry({ ... }, opts)`
   - `ledgerService.createPayoutEntry({ ... }, opts)`
   - `ledgerService.createWalletTransactionEntry({ ... }, opts)`
   - `ledgerService.createRazorpayChargeEntry({ ... })`
3. Required ledger data:
   - `user_id`
   - `transaction_type` (ledger category / code)
   - `debit` or `credit`
   - `description`
   - `balance_before` (auto-calculated by service)
   - `balance` (wallet balance after this ledger entry)
   - `reference_id` / `reference_table` when linking to a related record
   - `transaction_id` for external identifiers
   - `metadata` for extra JSON context
4. Use atomic DB transactions:
   - wrap ledger writes and related record updates in `db.transaction()`
   - pass `{ transaction }` into helper calls or `Ledger.create(..., { transaction })`
   - commit only after everything succeeds
   - rollback on any failure
5. Keep wallet sync in the same transaction:
   - `ledgerService.createLedgerEntry()` updates `User.wallet` automatically
   - direct `Ledger.create()` flows must also update `user.wallet` before commit
6. Failure handling:
   - if ledger creation fails, rollback the whole transaction
   - if user `start_ledger` is disabled, ledger creation is skipped silently
   - for async external API failures, persist pending state and let webhook/cron reconciliation handle ledger repair
7. Note:
   - the codebase stores the post-transaction balance as `balance`, not `balance_after`
   - `balance_before` and `balance` are the canonical wallet snapshot fields

## Output Example

```js
const transaction = await db.transaction();

try {
  const payout = await PayoutTransactions.create({
    user_id,
    amount,
    status: 'PROCESSING'
  }, { transaction });

  await ledgerService.createPayoutEntry({
    userId,
    payoutTransactionId: payout.id,
    amount: payout.total_amount,
    description: `Payout request ${payout.request_id}`,
    metadata: { beneficiary_id, service_charge }
  }, { transaction });

  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}