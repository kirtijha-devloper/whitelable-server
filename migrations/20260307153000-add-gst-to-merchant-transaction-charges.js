'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('MerchantTransactionCharges', 'gst_amount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00
    });
    await queryInterface.addColumn('MerchantTransactionCharges', 'gst_percent', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('MerchantTransactionCharges', 'gst_amount');
    await queryInterface.removeColumn('MerchantTransactionCharges', 'gst_percent');
  }
};