'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ServiceToggleAuditLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      affected_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      service_key: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      previous_state: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
      },
      new_state: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
      },
      action: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      ip_address: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.STRING(500),
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

    await queryInterface.addIndex('ServiceToggleAuditLogs', ['user_id'], {
      name: 'service_toggle_audit_logs_user_id_idx',
    });

    await queryInterface.addIndex('ServiceToggleAuditLogs', ['affected_user_id'], {
      name: 'service_toggle_audit_logs_affected_user_id_idx',
    });

    await queryInterface.addIndex('ServiceToggleAuditLogs', ['service_key'], {
      name: 'service_toggle_audit_logs_service_key_idx',
    });

    await queryInterface.addIndex('ServiceToggleAuditLogs', ['createdAt'], {
      name: 'service_toggle_audit_logs_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ServiceToggleAuditLogs');
  },
};
