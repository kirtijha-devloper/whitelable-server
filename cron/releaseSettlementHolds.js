const cron = require('node-cron');
const { Op } = require('sequelize');
const SettlementHold = require('../models/SettlementHold');

/**
 * Release all settlement holds whose release_at timestamp has passed.
 *
 * Called by cron every minute from 10:28–10:35 AM IST and once every 15 min
 * otherwise, to ensure holds are released promptly at 10:30 AM IST even if
 * the server was temporarily down.
 */
async function releaseSettlementHolds() {
  const now = new Date();

  // Log pending holds before releasing for investigation
  const pendingHolds = await SettlementHold.findAll({
    where: {
      released: false,
      release_at: { [Op.lte]: now }
    },
    attributes: ['id', 'user_id', 'amount', 'hold_date', 'release_at']
  });

  if (pendingHolds.length > 0) {
    console.log(`[cron] releaseSettlementHolds: found ${pendingHolds.length} hold(s) to release at ${now.toISOString()}`);
    pendingHolds.forEach(h => {
      console.log(`[cron]   hold #${h.id} | user_id=${h.user_id} | amount=${h.amount} | hold_date=${h.hold_date} | release_at=${h.release_at}`);
    });
  }

  const [count] = await SettlementHold.update(
    { released: true },
    {
      where: {
        released: false,
        release_at: { [Op.lte]: now }
      }
    }
  );

  if (count > 0) {
    console.log(`[cron] releaseSettlementHolds: released ${count} hold(s)`);
  }

  // Log remaining unreleased holds (future holds still waiting)
  const remainingCount = await SettlementHold.count({
    where: { released: false }
  });
  if (remainingCount > 0) {
    console.log(`[cron] releaseSettlementHolds: ${remainingCount} hold(s) still pending for future release`);
  }
}

// Run every minute to ensure timely release at 10:30 AM IST
cron.schedule('* * * * *', () => {
  releaseSettlementHolds().catch((err) =>
    console.error('[cron] releaseSettlementHolds error:', err)
  );
});

module.exports = { releaseSettlementHolds };
