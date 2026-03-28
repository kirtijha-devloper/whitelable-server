'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SettlementHolds', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      ledger_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Ledgers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      hold_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      release_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      released: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
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

    await queryInterface.addIndex('SettlementHolds', ['user_id']);
    await queryInterface.addIndex('SettlementHolds', ['released']);
    await queryInterface.addIndex('SettlementHolds', ['release_at']);
    await queryInterface.addIndex('SettlementHolds', ['user_id', 'released']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('SettlementHolds');
  }
};
