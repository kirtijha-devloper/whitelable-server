'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('razorpay_notifications', 'settlement_type', {
      type: Sequelize.STRING(30),
      allowNull: true,
      defaultValue: null,
      comment: "Snapshot of merchant's settlement_type ('today_settlement' or 'next_day_settlement') at transaction processing time"
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('razorpay_notifications', 'settlement_type');
  }
};
