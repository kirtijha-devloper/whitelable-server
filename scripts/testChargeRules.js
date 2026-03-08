const PosChargeRule = require('../models/PosChargeRule');
const db = require('../config/database');

(async () => {
  await db.authenticate();
  // clear existing for this test
  await PosChargeRule.destroy({ where: {}, truncate: true });
  await PosChargeRule.bulkCreate([
    {
      user_id: null,
      franchaise_id: null,
      payment_mode: 'CARD',
      card_type: 'CREDIT',
      card_brand: 'VISA',
      card_classification: 'PLATINUM',
      settlement_type: 'TODAY',
      min_amount: 0,
      max_amount: null,
      charge_percent: 3,
      charge_flat: 0,
      gst_required: false,
      gst_percent: 0,
      is_active: true,
    },
    {
      user_id: null,
      franchaise_id: 5,
      payment_mode: 'CARD',
      card_type: 'CREDIT',
      card_brand: 'VISA',
      card_classification: 'PLATINUM',
      settlement_type: 'TODAY',
      min_amount: 0,
      max_amount: null,
      charge_percent: 3,
      charge_flat: 0,
      gst_required: false,
      gst_percent: 0,
      is_active: true,
    },
    {
      user_id: 7,
      franchaise_id: 5,
      payment_mode: 'CARD',
      card_type: 'CREDIT',
      card_brand: 'VISA',
      card_classification: 'PLATINUM',
      settlement_type: 'TODAY',
      min_amount: 0,
      max_amount: null,
      charge_percent: 5,
      charge_flat: 0,
      gst_required: false,
      gst_percent: 0,
      is_active: true,
    }
  ]);
  console.log('rules seeded');
  process.exit(0);
})();