'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add columns needed for reporting and faster filtering
    await queryInterface.addColumn('razorpay_notifications', 'mid', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Merchant ID (mid) from the webhook event'
    });

    await queryInterface.addColumn('razorpay_notifications', 'tid', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Terminal ID (tid) from the webhook event'
    });

    await queryInterface.addColumn('razorpay_notifications', 'amount', {
      type: Sequelize.BIGINT,
      allowNull: true,
      comment: 'Transaction amount as received in event_json.amount or amountOriginal'
    });

    await queryInterface.addColumn('razorpay_notifications', 'currency_code', {
      type: Sequelize.STRING(10),
      allowNull: true,
      comment: 'Currency code from event_json, e.g. INR'
    });

    await queryInterface.addColumn('razorpay_notifications', 'payment_mode', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'Payment mode (CARD, UPI, etc)'
    });

    await queryInterface.addColumn('razorpay_notifications', 'payment_card_type', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });

    await queryInterface.addColumn('razorpay_notifications', 'payment_card_brand', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });

    await queryInterface.addColumn('razorpay_notifications', 'rr_number', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addColumn('razorpay_notifications', 'device_serial', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addColumn('razorpay_notifications', 'posting_date', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // add indexes for the new columns which are commonly used in reports
    await queryInterface.addIndex('razorpay_notifications', ['mid'], { name: 'idx_razorpay_notifications_mid' });
    await queryInterface.addIndex('razorpay_notifications', ['tid'], { name: 'idx_razorpay_notifications_tid' });
    await queryInterface.addIndex('razorpay_notifications', ['payment_mode'], { name: 'idx_razorpay_notifications_payment_mode' });
    await queryInterface.addIndex('razorpay_notifications', ['posting_date'], { name: 'idx_razorpay_notifications_posting_date' });

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