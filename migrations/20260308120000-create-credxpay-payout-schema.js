'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // payout_beneficiaries
    await queryInterface.createTable('payout_beneficiaries', {
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
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      account_number: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      ifsc_code: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      bank_name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      branch_name: {
        type: Sequelize.STRING(255)
      },
      mobile: {
        type: Sequelize.STRING(15)
      },
      email: {
        type: Sequelize.STRING(255)
      },
      is_verified: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });
    await queryInterface.addIndex('payout_beneficiaries', ['user_id'], {
      name: 'idx_user_benef'
    });

    // payout_requests
    await queryInterface.createTable('payout_requests', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      request_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false
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
      amount: {
        type: Sequelize.NUMERIC(14, 2),
        allowNull: false
      },
      charge: {
        type: Sequelize.NUMERIC(14, 2),
        allowNull: false,
        defaultValue: 0
      },
      mobile_number: {
        type: Sequelize.STRING(15)
      },
      account_number: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      ifsc_code: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      beneficiary_name: {
        type: Sequelize.STRING(255)
      },
      bank_name: {
        type: Sequelize.STRING(255)
      },
      transfer_mode: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'IMPS'
      },
      opening_balance: {
        type: Sequelize.NUMERIC(14, 2)
      },
      closing_balance: {
        type: Sequelize.NUMERIC(14, 2)
      },
      response_status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'PROCESSING'
      },
      response_message: {
        type: Sequelize.TEXT
      },
      response_status_code: {
        type: Sequelize.STRING(50)
      },
      utr: {
        type: Sequelize.STRING(100)
      },
      api_txn_id: {
        type: Sequelize.STRING(100)
      },
      op_ref_id: {
        type: Sequelize.STRING(100)
      },
      response: {
        type: Sequelize.JSONB
      },
      service_provider: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'CredXPay'
      },
      refunded: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      latitude: {
        type: Sequelize.STRING(30)
      },
      longitude: {
        type: Sequelize.STRING(30)
      },
      email_id: {
        type: Sequelize.STRING(255)
      },
      purpose: {
        type: Sequelize.STRING(255)
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });
    await queryInterface.addIndex('payout_requests', ['user_id'], { name: 'idx_user_req' });
    await queryInterface.addIndex('payout_requests', ['response_status'], { name: 'idx_status' });
    await queryInterface.addIndex('payout_requests', ['response_status', 'created_at'], { name: 'idx_pending' });

    // payout_audit_logs
    await queryInterface.createTable('payout_audit_logs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      payout_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      action: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      details: {
        type: Sequelize.JSONB
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });
    await queryInterface.addIndex('payout_audit_logs', ['payout_id'], { name: 'idx_payout_log' });

    // payout_webhook_logs
    await queryInterface.createTable('payout_webhook_logs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      source_ip: {
        type: Sequelize.STRING(45)
      },
      processed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    // service_charge_slabs
    await queryInterface.createTable('service_charge_slabs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      service_name: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'payout'
      },
      min_amount: {
        type: Sequelize.NUMERIC(14, 2),
        allowNull: false
      },
      max_amount: {
        type: Sequelize.NUMERIC(14, 2),
        allowNull: false
      },
      service_charge: {
        type: Sequelize.NUMERIC(10, 2),
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    // ref_sequences
    await queryInterface.createTable('ref_sequences', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      service: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true
      },
      current_number: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 1
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()')
      }
    });

    // seed default sequence for payout
    await queryInterface.bulkInsert('ref_sequences', [
      { service: 'payout', current_number: 1 }
    ]);

    // seed service_charge_slabs example
    await queryInterface.bulkInsert('service_charge_slabs', [
      { service_name: 'payout', min_amount: 100, max_amount: 1000, service_charge: 5.00 },
      { service_name: 'payout', min_amount: 1001, max_amount: 25000, service_charge: 20.00 },
      { service_name: 'payout', min_amount: 25001, max_amount: 100000, service_charge: 30.00 }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('ref_sequences');
    await queryInterface.dropTable('service_charge_slabs');
    await queryInterface.dropTable('payout_webhook_logs');
    await queryInterface.dropTable('payout_audit_logs');
    await queryInterface.dropTable('payout_requests');
    await queryInterface.dropTable('payout_beneficiaries');
  }
};