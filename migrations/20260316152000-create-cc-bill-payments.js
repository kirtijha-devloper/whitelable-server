'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('CcBillPayments').catch(() => null);
    if (!tableDesc) {
      await queryInterface.createTable('CcBillPayments', {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        user_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: {
            model: 'Users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        biller_id: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        param1: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        param2: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        transaction_amount: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        customer_mobile: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        payment_mode: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        payment_info: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        enquiry_reference_id: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        external_ref: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        statuscode: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        status: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        response: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        geo_code: {
          type: Sequelize.STRING,
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
    const tableDesc = await queryInterface.describeTable('CcBillPayments').catch(() => null);
    if (tableDesc) {
      await queryInterface.dropTable('CcBillPayments');
    }
  },
};
