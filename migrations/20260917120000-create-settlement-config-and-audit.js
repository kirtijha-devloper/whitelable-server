'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Create system_settlement_configs table
    const systemConfigsExists = await queryInterface.showAllTables()
      .then(tables => tables.includes('system_settlement_configs'));
    if (!systemConfigsExists) {
      await queryInterface.createTable('system_settlement_configs', {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        global_cutoff_enabled: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        global_default_cutoff_time: {
          type: Sequelize.STRING(5),
          defaultValue: '10:00',
        },
        auto_settlement_time: {
          type: Sequelize.STRING(5),
          defaultValue: '10:00',
        },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW'),
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW'),
        },
      });

      // Insert default global config row (ID 1)
      await queryInterface.bulkInsert('system_settlement_configs', [{
        id: 1,
        global_cutoff_enabled: true,
        global_default_cutoff_time: '10:00',
        auto_settlement_time: '10:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      }]);
    }

    // 2. Add cutoff_timestamp, t1_balance, prev_day_settled_balance to users table
    let usersTableName = 'users';
    let tableDescription;
    try {
      tableDescription = await queryInterface.describeTable('users');
    } catch (e) {
      usersTableName = 'Users';
      tableDescription = await queryInterface.describeTable('Users');
    }

    if (!tableDescription.cutoff_timestamp) {
      await queryInterface.addColumn(usersTableName, 'cutoff_timestamp', {
        type: Sequelize.STRING(5),
        allowNull: true,
        defaultValue: null,
        comment: 'User custom cutoff time (HH:mm). NULL inherits global_default_cutoff_time.',
      });
    }

    if (!tableDescription.t1_balance) {
      await queryInterface.addColumn(usersTableName, 't1_balance', {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
        comment: 'Pending T1 funds (from card/POS transactions).',
      });
    }

    if (!tableDescription.prev_day_settled_balance) {
      await queryInterface.addColumn(usersTableName, 'prev_day_settled_balance', {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00,
        comment: 'Settled usable funds before cutoff.',
      });
    }

    // 3. Create settlement_audit_logs table
    const auditLogsExists = await queryInterface.showAllTables()
      .then(tables => tables.includes('settlement_audit_logs'));
    if (!auditLogsExists) {
      await queryInterface.createTable('settlement_audit_logs', {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        performing_user_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: {
            model: usersTableName,
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        affected_user_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: {
            model: usersTableName,
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        action: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        previous_state: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        new_state: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW'),
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW'),
        },
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('settlement_audit_logs').catch(() => {});
    
    let usersTableName = 'users';
    try {
      await queryInterface.describeTable('users');
    } catch (e) {
      usersTableName = 'Users';
    }
    
    await queryInterface.removeColumn(usersTableName, 'cutoff_timestamp').catch(() => {});
    await queryInterface.removeColumn(usersTableName, 't1_balance').catch(() => {});
    await queryInterface.removeColumn(usersTableName, 'prev_day_settled_balance').catch(() => {});
    await queryInterface.dropTable('system_settlement_configs').catch(() => {});
  },
};
