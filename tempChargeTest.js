const ChargeService = require('./services/chargeService');
(async()=>{
  await require('./config/database').authenticate();
  const rule = await ChargeService.getTransactionChargeRule({
    userId: 7,
    franchiseId: 5,
    paymentMode: 'CARD',
    cardType: 'CREDIT',
    cardBrand: 'VISA',
    classification: 'PLATINUM',
    settlement: 'TODAY',
    amount: 100
  });
  console.log('rule', rule);
})();