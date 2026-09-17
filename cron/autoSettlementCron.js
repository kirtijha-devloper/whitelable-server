const cron = require('node-cron');
const { Op } = require('sequelize');
const db = require('../config/database');
const User = require('../models/User');
const SettlementAuditLog = require('../models/SettlementAuditLog');

/**
 * Runs daily auto-settlement (T1 -> Settled Opening Balance) for users with pending T1 balance
 */
async function runAutoSettlement() {
  console.log(`[cron] Starting daily T1 -> T0 auto-settlement job at ${new Date().toISOString()}`);

  try {
    const usersWithT1 = await User.findAll({
      where: {
        t1_balance: { [Op.gt]: 0 },
      },
    });

    if (usersWithT1.length === 0) {
      console.log('[cron] No users with pending T1 balance found for auto-settlement.');
      return;
    }

    console.log(`[cron] Found ${usersWithT1.length} user(s) with pending T1 balance.`);

    for (const user of usersWithT1) {
      const transaction = await db.transaction();
      try {
        const t1Amt = parseFloat(user.t1_balance) || 0;
        const oldOpening = parseFloat(user.prev_day_settled_balance) || 0;

        if (t1Amt > 0) {
          const newOpening = oldOpening + t1Amt;
          user.prev_day_settled_balance = newOpening;
          user.t1_balance = 0.00;
          await user.save({ transaction });

          await SettlementAuditLog.create({
            performing_user_id: null, // System Automated Action
            affected_user_id: user.id,
            action: 'T1_TO_T0_SETTLEMENT',
            previous_state: `T1: ₹${t1Amt.toFixed(2)}, Opening: ₹${oldOpening.toFixed(2)}`,
            new_state: `T1: ₹0.00, Opening: ₹${newOpening.toFixed(2)}`,
          }, { transaction });

          await transaction.commit();
          console.log(`[cron] Auto-settled ₹${t1Amt.toFixed(2)} for User #${user.id}`);
        } else {
          await transaction.rollback();
        }
      } catch (err) {
        await transaction.rollback();
        console.error(`[cron] Error auto-settling user #${user.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[cron] Error in runAutoSettlement job:', err);
  }
}

// Scheduled daily at 10:00 AM IST (0 10 * * *)
cron.schedule('0 10 * * *', () => {
  runAutoSettlement().catch((err) =>
    console.error('[cron] runAutoSettlement unhandled error:', err)
  );
});

module.exports = { runAutoSettlement };
