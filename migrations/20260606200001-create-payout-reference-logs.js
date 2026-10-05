'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('payout_reference_logs', {
      id: {
        type: Sequelize.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      reference: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },
      sequence_number: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      provider: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      company_id: {
        type: Sequelize.STRING,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'company_id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Company / white-label tenant identifier',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('payout_reference_logs', ['reference'], {
      name: 'idx_payout_reference_logs_reference',
    });
    await queryInterface.addIndex('payout_reference_logs', ['user_id'], {
      name: 'idx_payout_reference_logs_user_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payout_reference_logs');
  },
};
