'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('worldline_notifications', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT
      },
      txn_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
        comment: 'Worldline unique transaction identifier'
      },
      rrn: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Retrieval Reference Number'
      },
      mid: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Merchant ID'
      },
      tid: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Terminal ID'
      },
      amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Transaction amount in INR'
      },
      status: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Transaction status (e.g., SUCCESS, FAILED, APPROVED)'
      },
      card_scheme: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Card Scheme / Network (VISA, MASTERCARD, RUPAY, etc.)'
      },
      txn_date: {
        type: Sequelize.STRING(30),
        allowNull: true
      },
      txn_time: {
        type: Sequelize.STRING(30),
        allowNull: true
      },
      masked_card_number: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      txn_type: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      app_code: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      urn: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      billing_number: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      event_json: {
        type: Sequelize.JSON,
        allowNull: false,
        comment: 'Raw Worldline webhook payload'
      },
      source: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'worldline'
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      company_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Company / white-label tenant identifier'
      },
      pos_machine_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'PosMachines',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      processed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      processing_status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'pending',
        comment: 'pending, completed, needs_admin, failed'
      },
      processing_error: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      processed_at: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Add indexes for efficient lookups and webhook deduplication
    await queryInterface.addIndex('worldline_notifications', ['txn_id'], {
      unique: true,
      name: 'idx_worldline_notifications_txn_id'
    });

    await queryInterface.addIndex('worldline_notifications', ['rrn'], {
      name: 'idx_worldline_notifications_rrn'
    });

    await queryInterface.addIndex('worldline_notifications', ['mid', 'tid'], {
      name: 'idx_worldline_notifications_mid_tid'
    });

    await queryInterface.addIndex('worldline_notifications', ['user_id'], {
      name: 'idx_worldline_notifications_user_id'
    });

    await queryInterface.addIndex('worldline_notifications', ['company_id'], {
      name: 'idx_worldline_notifications_company_id'
    });

    await queryInterface.addIndex('worldline_notifications', ['status'], {
      name: 'idx_worldline_notifications_status'
    });

    await queryInterface.addIndex('worldline_notifications', ['processing_status'], {
      name: 'idx_worldline_notifications_processing_status'
    });

    await queryInterface.addIndex('worldline_notifications', ['createdAt'], {
      name: 'idx_worldline_notifications_created_at'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('worldline_notifications');
  }
};

