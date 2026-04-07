'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Users', 'bank_account_number', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Merchant bank account number captured during InstantPay KYC'
    });

    await queryInterface.addColumn('Users', 'bank_ifsc', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Merchant bank IFSC code captured during InstantPay KYC'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('Users', 'bank_account_number');
    await queryInterface.removeColumn('Users', 'bank_ifsc');
  }
};
