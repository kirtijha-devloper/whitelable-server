'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pos_charge_rules', 'gst_required', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Whether GST should be applied to the transaction charge'
    });

    await queryInterface.addColumn('pos_charge_rules', 'gst_percent', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      comment: 'GST percentage to apply on the charge amount when gst_required is true'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('pos_charge_rules', 'gst_required');
    await queryInterface.removeColumn('pos_charge_rules', 'gst_percent');
  }
};