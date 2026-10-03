'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('PosRentalBillings');
    if (!tableInfo.super_franchise_id) {
      await queryInterface.addColumn('PosRentalBillings', 'super_franchise_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Parent Super Franchise user ID (if applicable)'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('PosRentalBillings');
    if (tableInfo.super_franchise_id) {
      await queryInterface.removeColumn('PosRentalBillings', 'super_franchise_id');
    }
  }
};
