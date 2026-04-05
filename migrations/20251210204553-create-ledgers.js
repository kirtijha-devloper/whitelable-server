'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Ledgers', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      transaction_type: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Type of transaction: pos_charge, wallet_credit, wallet_debit, payout, transfer, etc.'
      },
      transaction_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Reference to the original transaction (e.g., razorpay_transaction_id, wallet_transaction_id)'
      },
      reference_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Reference to related table ID (e.g., wallet_transaction_id, merchant_transaction_charge_id)'
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Human-readable description of the transaction'
      },
      debit: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
        comment: 'Debit amount (money going out)'
      },
      credit: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
        comment: 'Credit amount (money coming in)'
      },
      balance: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Running balance after this transaction'
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'completed',
        comment: 'Transaction status: completed, pending, failed, cancelled'
      },
      metadata: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON string for additional transaction details'
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

    // Add indexes for better query performance
    await queryInterface.addIndex('Ledgers', ['user_id'], {
      name: 'idx_ledgers_user_id'
    });
    await queryInterface.addIndex('Ledgers', ['transaction_type'], {
      name: 'idx_ledgers_transaction_type'
    });
    await queryInterface.addIndex('Ledgers', ['transaction_id'], {
      name: 'idx_ledgers_transaction_id'
    });
    await queryInterface.addIndex('Ledgers', ['createdAt'], {
      name: 'idx_ledgers_created_at'
    });
    await queryInterface.addIndex('Ledgers', ['status'], {
      name: 'idx_ledgers_status'
    });
    await queryInterface.addIndex('Ledgers', ['user_id', 'createdAt'], {
      name: 'idx_ledgers_user_created'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Ledgers');
  }
};

