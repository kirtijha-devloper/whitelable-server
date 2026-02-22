'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;

    // Add columns with IF NOT EXISTS so this is safe to re-run on environments
    // where some or all columns were already created by an earlier migration.
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS mid VARCHAR(100)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS tid VARCHAR(100)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS amount BIGINT`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(50)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS payment_card_type VARCHAR(50)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS payment_card_brand VARCHAR(50)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS rr_number VARCHAR(100)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS device_serial VARCHAR(100)`);
    await q.query(`ALTER TABLE razorpay_notifications ADD COLUMN IF NOT EXISTS posting_date TIMESTAMPTZ`);

    // Indexes — all idempotent
    await q.query(`CREATE INDEX IF NOT EXISTS idx_razorpay_notifications_mid ON razorpay_notifications (mid)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_razorpay_notifications_tid ON razorpay_notifications (tid)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_razorpay_notifications_payment_mode ON razorpay_notifications (payment_mode)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_razorpay_notifications_posting_date ON razorpay_notifications (posting_date)`);

    // populate newly added columns using existing JSON payloads
    // note: this is Postgres-specific syntax using ->> operator
    await queryInterface.sequelize.query(`
      UPDATE razorpay_notifications
      SET
        mid = (event_json->>'mid'),
        tid = (event_json->>'tid'),
        amount = CASE WHEN (event_json->>'amount') IS NOT NULL AND (event_json->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN ((event_json->>'amount')::numeric::bigint) ELSE NULL END,
        currency_code = (event_json->>'currencyCode'),
        payment_mode = (event_json->>'paymentMode'),
        payment_card_type = (event_json->>'paymentCardType'),
        payment_card_brand = (event_json->>'paymentCardBrand'),
        rr_number = (event_json->>'rrNumber'),
        device_serial = (event_json->>'deviceSerial'),
        posting_date = CASE
                          WHEN (event_json->>'postingDate') IS NOT NULL THEN 
                            ((event_json->>'postingDate')::timestamptz)
                          ELSE NULL
                        END
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_posting_date');
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_payment_mode');
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_tid');
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_mid');

    await queryInterface.removeColumn('razorpay_notifications', 'posting_date');
    await queryInterface.removeColumn('razorpay_notifications', 'device_serial');
    await queryInterface.removeColumn('razorpay_notifications', 'rr_number');
    await queryInterface.removeColumn('razorpay_notifications', 'payment_card_brand');
    await queryInterface.removeColumn('razorpay_notifications', 'payment_card_type');
    await queryInterface.removeColumn('razorpay_notifications', 'payment_mode');
    await queryInterface.removeColumn('razorpay_notifications', 'currency_code');
    await queryInterface.removeColumn('razorpay_notifications', 'amount');
    await queryInterface.removeColumn('razorpay_notifications', 'tid');
    await queryInterface.removeColumn('razorpay_notifications', 'mid');
  }
};