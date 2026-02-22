'use strict';

/**
 * Composite indexes to optimise the date-range report query pattern:
 *   WHERE user_id = ? AND posting_date BETWEEN ? AND ?
 *   WHERE user_id IN (?) AND posting_date BETWEEN ? AND ?   ← franchise/admin
 *
 * A composite index on (user_id, posting_date) lets the DB satisfy both the
 * equality/IN filter on user_id and the range scan on posting_date in a single
 * index seek, which is far faster than intersecting two single-column indexes.
 *
 * We also add (status, posting_date) for status-filtered admin reports.
 *
 * NOTE: This migration must run AFTER 20260222120000 which adds the posting_date column.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Use raw SQL with IF NOT EXISTS so this is safe to run on environments
    // where the old 20260222000003 migration already created these indexes.

    // Primary report index: user + date range
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_razorpay_user_posting_date ON razorpay_notifications (user_id, posting_date)'
    );

    // Admin / unlinked reports filtered by status + date
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_razorpay_status_posting_date ON razorpay_notifications (status, posting_date)'
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_razorpay_status_posting_date');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_razorpay_user_posting_date');
  }
};
