const cron = require('node-cron');
const { Op } = require('sequelize');
const PosRentalBilling = require('../models/PosRentalBilling');
const Rental = require('../models/Rental');
const db = require('../config/database');
const {
  createRentalChargeEntry,
  createRentalCreditEntry,
} = require('../services/ledgerService');

/**
 * Charge Rental Fees – runs daily at 01:00 AM IST (07:30 PM UTC previous day).
 *
 * Rate lookup rules:
 *   adminFranchiseRate  → franchaise_id IS NULL, target_user_type = 'franchise'
 *   adminMerchantRate   → franchaise_id IS NULL, target_user_type = 'merchant'
 *   franchiseOwnRate(X) → franchaise_id = X,    target_user_type = 'merchant'
 *
 * Charge flow for each due billing record:
 *
 * Case A – Merchant under a franchise
 *   1. Debit merchant     by franchiseOwnRate (fallback: adminMerchantRate)
 *   2. Credit franchise   by the same amount
 *   3. Debit franchise    by adminFranchiseRate
 *
 * Case B – Standalone merchant (no franchise)
 *   1. Debit merchant     by adminMerchantRate
 *
 * Case C – Franchise directly holds the machine
 *   1. Debit franchise    by adminFranchiseRate
 *
 * After charging: next_charge_date advances by +30 days.
 */
async function chargeRentals() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch all active billing records whose next charge date has arrived
  const dueBillings = await PosRentalBilling.findAll({
    where: {
      status: 'active',
      next_charge_date: { [Op.lte]: today.toISOString().slice(0, 10) }
    }
  });

  if (dueBillings.length === 0) {
    console.log('[cron] chargeRentals: no billing records due today');
    return;
  }

  console.log(`[cron] chargeRentals: ${dueBillings.length} billing record(s) due`);

  // Load admin rates (one for franchises, one for standalone merchants)
  const adminFranchiseRate = await Rental.findOne({
    where: { franchaise_id: null, target_user_type: 'franchise', status: 'active' }
  });
  const adminMerchantRate = await Rental.findOne({
    where: { franchaise_id: null, target_user_type: 'merchant', status: 'active' }
  });

  // Cache per-franchise rates to avoid redundant DB queries
  const franchiseRateCache = new Map();

  const getFranchiseOwnRate = async (franchiseId) => {
    if (franchiseRateCache.has(franchiseId)) {
      return franchiseRateCache.get(franchiseId);
    }
    const rate = await Rental.findOne({
      where: { franchaise_id: franchiseId, target_user_type: 'merchant', status: 'active' }
    });
    franchiseRateCache.set(franchiseId, rate || null);
    return rate || null;
  };

  for (const billing of dueBillings) {
    const { id: billingId, assigned_to, assigned_to_role, franchise_id, pos_machine_id } = billing;
    const transaction = await db.transaction();

    try {
      const billingRow = await PosRentalBilling.findOne({
        where: { id: billingId, status: 'active' },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!billingRow) {
        await transaction.rollback();
        continue;
      }

      const todayIso = today.toISOString().slice(0, 10);
      if (billingRow.next_charge_date > todayIso) {
        await transaction.rollback();
        continue;
      }

      if (assigned_to_role === 'merchant' && franchise_id) {
        // ── Case A: merchant under a franchise ──────────────────────────────

        // franchise's own merchant rate, falling back to admin's merchant rate
        const effectiveMerchantRate = (await getFranchiseOwnRate(franchise_id)) || adminMerchantRate;

        if (effectiveMerchantRate) {
          const merchantAmount = parseFloat(effectiveMerchantRate.amount);

          // Step 1: debit merchant
          await createRentalChargeEntry({
            userId:      assigned_to,
            billingId,
            amount:      merchantAmount,
            description: `POS rental charge: ₹${merchantAmount}`,
            metadata:    { billing_id: billingId, pos_machine_id, charged_by: 'franchise', franchise_id }
          }, { transaction });

          // Step 2: credit franchise (rental income from merchant)
          await createRentalCreditEntry({
            userId:      franchise_id,
            billingId,
            amount:      merchantAmount,
            description: `POS rental income from merchant #${assigned_to}: ₹${merchantAmount}`,
            metadata:    { billing_id: billingId, pos_machine_id, merchant_id: assigned_to }
          }, { transaction });
        }

        // Step 3: debit franchise by admin's franchise rate
        if (adminFranchiseRate) {
          const platformAmount = parseFloat(adminFranchiseRate.amount);
          await createRentalChargeEntry({
            userId:      franchise_id,
            billingId,
            amount:      platformAmount,
            description: `POS rental platform fee: ₹${platformAmount}`,
            metadata:    { billing_id: billingId, pos_machine_id, charged_by: 'admin' }
          }, { transaction });
        }

      } else if (assigned_to_role === 'merchant' && !franchise_id) {
        // ── Case B: standalone merchant (no franchise) ──────────────────────
        if (adminMerchantRate) {
          const amount = parseFloat(adminMerchantRate.amount);
          await createRentalChargeEntry({
            userId:      assigned_to,
            billingId,
            amount,
            description: `POS rental charge: ₹${amount}`,
            metadata:    { billing_id: billingId, pos_machine_id }
          }, { transaction });
        }

      } else if (assigned_to_role === 'franchaise') {
        // ── Case C: franchise holds the machine directly ────────────────────
        if (adminFranchiseRate) {
          const amount = parseFloat(adminFranchiseRate.amount);
          await createRentalChargeEntry({
            userId:      assigned_to,
            billingId,
            amount,
            description: `POS rental charge: ₹${amount}`,
            metadata:    { billing_id: billingId, pos_machine_id }
          }, { transaction });
        }
      }

      // Advance the billing cycle by 30 days
      const nextCharge = new Date(today);
      nextCharge.setDate(nextCharge.getDate() + 30);
      await billingRow.update({
        last_charged_at: new Date(),
        next_charge_date: nextCharge.toISOString().slice(0, 10)
      }, { transaction });

      await transaction.commit();
      console.log(`[cron] chargeRentals: charged billing #${billingId} (machine ${pos_machine_id}, user ${assigned_to})`);

    } catch (err) {
      await transaction.rollback();
      console.error(`[cron] chargeRentals: error for billing #${billingId}:`, err.message || err);
    }
  }
}

// Run every day at 01:00 AM IST (19:30 UTC)
cron.schedule('30 19 * * *', () => {
  chargeRentals().catch((err) =>
    console.error('[cron] chargeRentals fatal error:', err)
  );
});

module.exports = { chargeRentals };
