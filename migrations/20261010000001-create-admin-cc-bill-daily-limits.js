'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('admin_cc_bill_daily_limits', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      admin_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      company_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      business_date: {
        type: Sequelize.STRING(10),
        allowNull: false,
      },
      daily_limit: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      consumed_amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      reserved_amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex('admin_cc_bill_daily_limits', ['admin_id', 'business_date'], {
      unique: true,
      name: 'admin_cc_bill_daily_limits_admin_date_unique',
    });

    await queryInterface.addIndex('admin_cc_bill_daily_limits', ['company_id'], {
      name: 'admin_cc_bill_daily_limits_company_id_idx',
    });

    await queryInterface.createTable('cc_bill_limit_reservations', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      admin_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      business_date: {
        type: Sequelize.STRING(10),
        allowNull: false,
      },
      flow: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      reference_id: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'RESERVED',
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex('cc_bill_limit_reservations', ['flow', 'reference_id'], {
      unique: true,
      name: 'cc_bill_limit_reservations_flow_ref_unique',
    });

    await queryInterface.addIndex('cc_bill_limit_reservations', ['admin_id', 'business_date'], {
      name: 'cc_bill_limit_reservations_admin_date_idx',
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('cc_bill_limit_reservations');
    await queryInterface.dropTable('admin_cc_bill_daily_limits');
  },
};

