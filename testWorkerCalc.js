const { Op } = require('sequelize');
const User = require('./models/User');
const ChargeService = require('./services/chargeService');

(async()=>{
  await require('./config/database').authenticate();
  const merchant = await User.findByPk(7);
  const amount = 100;
  const params = {
    userId: merchant.id,
    franchiseId: merchant.franchaise_id,
    paymentMode: 'CARD',
    cardType: 'CREDIT',
    cardBrand: 'VISA',
    classification: 'PLATINUM',
    settlement: 'TODAY',
    amount,
  };
  const rule1 = await ChargeService.getTransactionChargeRule(params);
  console.log('merchant rule percent', rule1.charge_percent);
  const charge1 = ChargeService.calculateCharge(amount, rule1);
  console.log('merchant charge', charge1.charge);

  const rule2 = await ChargeService.getTransactionChargeRule({
    userId: null,
    franchiseId: merchant.franchaise_id,
    paymentMode: 'CARD',
    cardType: 'CREDIT',
    cardBrand: 'VISA',
    classification: 'PLATINUM',
    settlement: 'TODAY',
    amount,
  });
  console.log('franchise rule percent', rule2.charge_percent);
  console.log('franchise charge', ChargeService.calculateCharge(amount, rule2).charge);
})();