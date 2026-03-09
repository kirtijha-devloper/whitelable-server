"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // add composite index to speed up rule lookups and overlap checks
    await queryInterface.addIndex('pos_charge_rules', [
      'user_id',
      'franchaise_id',
      'payment_mode',
      'card_type',
      'card_brand',
      'card_classification',
      'settlement_type',
      'min_amount',
      'max_amount'
    ], {
      name: 'pos_charge_rules_composite_lookup_idx'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('pos_charge_rules', 'pos_charge_rules_composite_lookup_idx');
  }
};