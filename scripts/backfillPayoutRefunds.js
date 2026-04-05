/**
 * backfillPayoutRefunds.js
 *
 * One-time script to fix wallet drift caused by historical payout failures that
 * were refunded via direct user.wallet mutation (old code) without a corresponding
 * ledger credit entry.
 *
 * For each PayoutTransaction where:
 *   - status = 'FAILED'
 *   - no matching 'payout_refund' credit row exists in Ledgers with the same reference_id
 *
 * ...a payout_refund credit is created so that SUM(credit) - SUM(debit) correctly
 * reflects the true balance.
 *
 * Usage:
 *   node scripts/backfillPayoutRefunds.js            # dry run (no DB writes)
 *   node scripts/backfillPayoutRefunds.js --apply    # apply for all users
 *   node scripts/backfillPayoutRefunds.js --user 47  # single user dry run
 *   node scripts/backfillPayoutRefunds.js --user 47 --apply
 */

require('dotenv').config();
const Ledger = require('../models/Ledger');
const PayoutTransaction = require('../models/PayoutTransaction');
const ledgerService = require('../services/ledgerService');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const userIdArg = (() => {
  const idx = args.indexOf('--user');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : null;
})();

async function run() {
  console.log(`\n=== backfillPayoutRefunds ===`);
  console.log(`Mode : ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLYING'}`);
  console.log(`Scope: ${userIdArg ? `user ${userIdArg}` : 'all users'}\n`);

  // Find all failed payout transactions
  const where = { status: 'FAILED' };
  if (userIdArg) where.merchant_id = userIdArg;

  const failedPayouts = await PayoutTransaction.findAll({
    where,
    order: [['createdAt', 'ASC']]
  });

  console.log(`Found ${failedPayouts.length} FAILED PayoutTransactions\n`);

  let backfillCount = 0;
  let skipCount = 0;

  for (const payout of failedPayouts) {
    // Check if a payout_refund credit already exists for this payout
    const existingRefund = await Ledger.findOne({
      where: {
        user_id: payout.merchant_id,
        transaction_type: 'payout_refund',
        reference_id: payout.id,
        reference_table: 'PayoutTransactions'
      }
    });

    if (existingRefund) {
      skipCount++;
      continue;
    }

    // Check there's a payout debit entry at all (user has ledger enabled)
    const payoutDebit = await Ledger.findOne({
      where: {
        user_id: payout.merchant_id,
        transaction_type: 'payout',
        reference_id: payout.id,
        reference_table: 'PayoutTransactions'
      }
    });

    if (!payoutDebit) {
      // No ledger entry for this payout at all — user may not have had start_ledger enabled
      skipCount++;
      continue;
    }

    const refundAmount = parseFloat(payout.amount || 0) + parseFloat(payout.service_charge || 0);
    if (refundAmount <= 0) {
      skipCount++;
      continue;
    }

    console.log(`  BACKFILL payout #${payout.id} merchant=${payout.merchant_id} ref=${payout.reference_id} amount=₹${refundAmount}`);
    backfillCount++;

    if (!DRY_RUN) {
      await ledgerService.createLedgerEntry({
        userId: payout.merchant_id,
        transactionType: 'payout_refund',
        referenceId: payout.id,
        referenceTable: 'PayoutTransactions',
        description: `[BACKFILL] Payout refund for historical failed payout #${payout.id}`,
        credit: refundAmount,
        metadata: {
          backfill: true,
          payout_reference: payout.reference_id,
          original_debit_ledger_id: payoutDebit.id
        }
      });
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Backfilled : ${backfillCount}`);
  console.log(`Skipped    : ${skipCount} (refund already exists or no ledger debit)`);
  console.log(DRY_RUN ? '\nRun with --apply to write to DB.' : '\nDone.');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
