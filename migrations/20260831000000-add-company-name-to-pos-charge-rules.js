'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('pos_charge_rules');
    if (!tableInfo.company_name) {
      await queryInterface.addColumn('pos_charge_rules', 'company_name', {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'POS provider/company name (e.g. paytm, telering, pinelab)'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('pos_charge_rules');
    if (tableInfo.company_name) {
      await queryInterface.removeColumn('pos_charge_rules', 'company_name');
    }
  }
};
