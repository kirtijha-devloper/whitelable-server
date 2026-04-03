'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('BillAvenueBillers').catch(() => null);
    if (!tableDesc) {
      await queryInterface.createTable('BillAvenueBillers', {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        biller_id: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true,
        },
        biller_name: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        category: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        service_type: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        circle: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        state: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        metadata: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      });
    }
  },

  async down(queryInterface) {
    const tableDesc = await queryInterface.describeTable('BillAvenueBillers').catch(() => null);
    if (tableDesc) {
      await queryInterface.dropTable('BillAvenueBillers');
    }
  },
};
