'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableDesc = await queryInterface.describeTable('BbpsCcChargeRules').catch(() => null);
    if (tableDesc) {
      if (!tableDesc.user_id) {
        await queryInterface.addColumn('BbpsCcChargeRules', 'user_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: null,
          comment: 'Target admin user ID for admin-specific override; null for platform defaults',
        });
      }
      if (!tableDesc.company_id) {
        await queryInterface.addColumn('BbpsCcChargeRules', 'company_id', {
          type: Sequelize.STRING(255),
          allowNull: true,
          defaultValue: null,
          comment: 'Company / tenant identifier',
        });
      }
    }
  },

  down: async (queryInterface) => {
    const tableDesc = await queryInterface.describeTable('BbpsCcChargeRules').catch(() => null);
    if (tableDesc) {
      if (tableDesc.company_id) {
        await queryInterface.removeColumn('BbpsCcChargeRules', 'company_id');
      }
      if (tableDesc.user_id) {
        await queryInterface.removeColumn('BbpsCcChargeRules', 'user_id');
      }
    }
  }
};

