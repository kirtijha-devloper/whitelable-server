'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Nullable FK to Users — null when the POS machine that received the
    // notification has no assigned user at the time of processing.
    await queryInterface.addColumn('razorpay_notifications', 'user_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: 'FK → Users.id — assigned merchant at the time of the webhook. NULL when POS machine is unlinked.'
    });

    await queryInterface.addColumn('razorpay_notifications', 'company_id', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
      references: {
        model: 'Companies',
        key: 'company_id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Company / white-label tenant identifier'
    });

    // Nullable FK to posMachines — stamped as soon as we resolve mid/tid,
    // even when the machine has no assigned user.
    await queryInterface.addColumn('razorpay_notifications', 'pos_machine_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: 'FK → posMachines.id — resolved from mid/tid in the webhook payload.'
    });

    // Indexes for user-wise and machine-wise report queries
    await queryInterface.addIndex('razorpay_notifications', ['user_id'], {
      name: 'idx_razorpay_notifications_user_id'
    });
    await queryInterface.addIndex('razorpay_notifications', ['company_id'], {
      name: 'idx_razorpay_notifications_company_id'
    });
    await queryInterface.addIndex('razorpay_notifications', ['pos_machine_id'], {
      name: 'idx_razorpay_notifications_pos_machine_id'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_pos_machine_id');
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_company_id');
    await queryInterface.removeIndex('razorpay_notifications', 'idx_razorpay_notifications_user_id');
    await queryInterface.removeColumn('razorpay_notifications', 'pos_machine_id');
    await queryInterface.removeColumn('razorpay_notifications', 'company_id');
    await queryInterface.removeColumn('razorpay_notifications', 'user_id');
  }
};
