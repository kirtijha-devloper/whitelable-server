'use strict';

module.exports = {
  // NOTE: this migration was originally written to add `razorpay_id`.
  // The up() block was intentionally commented out in 692f5ecc when the
  // column was added by other means or the change was reverted.  A later
  // migration (20260305123000-add-razorpay-and-createdby-posmachine.js)
  // performs the actual alteration.  We keep this file for historical
  // record but it is effectively a no-op.
  up: async (queryInterface, Sequelize) => {
    // no-op
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.removeColumn('PosMachines', 'razorpay_id');
  }
};
