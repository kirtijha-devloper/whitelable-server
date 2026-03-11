'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // add a source column with default 'razorpay'
    await queryInterface.addColumn('razorpay_notifications', 'source', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'razorpay',
      comment: "Origin of the webhook – 'razorpay' or 'everlife'"
    });

    // index so that lookups/filters by source are fast
    await queryInterface.addIndex('razorpay_notifications', ['source'], {
      name: 'idx_razorpay_notifications_source'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_source');
    await queryInterface.removeColumn('razorpay_notifications', 'source');
  }
};
