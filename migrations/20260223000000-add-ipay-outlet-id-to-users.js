'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'ipay_outlet_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'InstantPay outlet ID assigned to this merchant (PHP: intval(session("outlet")))',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'ipay_outlet_id');
  },
};
