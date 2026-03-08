const ChargeService = require('./services/chargeService');
const User = require('./models/User');

(async () => {
  await require('./config/database').authenticate();
  const merchant = await User.findByPk(7); // sample merchant under franchise
  console.log('merchant', merchant.id, 'franchise', merchant.franchaise_id);
  const amount = 100;
  const params = {
    userId: merchant.id,
    franchiseId: merchant.franchaise_id,
    paymentMode: 'CARD',
    cardType: null,
    cardBrand: null,
    classification: null,
    settlement: null,
    amount,
  };
  const rule1 = await ChargeService.getTransactionChargeRule(params);
  const charge1 = ChargeService.calculateCharge(amount, rule1);
  console.log('merchant rule', rule1 && rule1.charge_percent, 'charge', charge1);

  const params2 = { ...params, userId: null, franchiseId: merchant.franchaise_id };
  const rule2 = await ChargeService.getTransactionChargeRule(params2);
  const charge2 = ChargeService.calculateCharge(amount, rule2);
  console.log('franchise rule', rule2 && rule2.charge_percent, 'charge', charge2);
})();