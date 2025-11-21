'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // return queryInterface.addColumn('PosMachines', 'razorpay_id', {
    //   type: Sequelize.STRING
    // });
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeColumn('PosMachines', 'razorpay_id');
  }
};
