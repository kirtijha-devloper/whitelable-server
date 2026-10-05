'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('razorpay_notifications', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT
      },
      txn_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true, // Prevent duplicate notifications
        comment: 'Razorpay transaction ID'
      },
      event_json: {
        type: Sequelize.JSON,
        allowNull: false,
        comment: 'Complete Razorpay webhook event data'
      },
      status: {
        type: Sequelize.STRING(30),
        allowNull: true,
        comment: 'Transaction status: SUCCESS, FAILED, VOIDED, etc.'
      },
      company_id: {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'company_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Company / white-label tenant identifier'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add index on txn_id for faster lookups (already unique, but explicit index helps)
    await queryInterface.addIndex('razorpay_notifications', ['txn_id'], {
      name: 'idx_razorpay_notifications_txn_id'
    });

    // Add index on status for filtering
    await queryInterface.addIndex('razorpay_notifications', ['status'], {
      name: 'idx_razorpay_notifications_status'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('razorpay_notifications');
  }
};