'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('CcBillPayments').catch(() => null);
    if (tableDesc && !tableDesc.charge_amount) {
      await queryInterface.addColumn('CcBillPayments', 'charge_amount', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const tableDesc = await queryInterface.describeTable('CcBillPayments').catch(() => null);
    if (tableDesc && tableDesc.charge_amount) {
      await queryInterface.removeColumn('CcBillPayments', 'charge_amount');
    }
  },
};
