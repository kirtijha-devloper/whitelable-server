const PosChargeRule = require('./models/PosChargeRule');
(async()=>{
  await require('./config/database').authenticate();
  const rules = await PosChargeRule.findAll({order:[['id','ASC']]});
  console.log(rules.map(r=>r.toJSON()));
})();