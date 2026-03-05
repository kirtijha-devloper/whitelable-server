'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add columns only if they do not already exist; this makes the migration
    // safe to run multiple times or on databases where someone manually
    // created the columns earlier.
    const table = 'PosMachines';

    // older versions of sequelize-cli don't expose hasColumn, so use
    // describeTable which returns the column definitions.
    const tableDesc = await queryInterface.describeTable(table);

    if (!tableDesc.razorpay_id) {
      await queryInterface.addColumn(table, 'razorpay_id', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }

    if (!tableDesc.created_by_user_id) {
      await queryInterface.addColumn(table, 'created_by_user_id', {
        type: Sequelize.INTEGER,
        allowNull: true
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    // down() can safely attempt removal even if columns are missing
    await queryInterface.removeColumn('PosMachines', 'razorpay_id').catch(() => {});
    await queryInterface.removeColumn('PosMachines', 'created_by_user_id').catch(() => {});
  }
};
