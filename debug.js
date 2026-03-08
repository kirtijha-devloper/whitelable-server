const { Op } = require('sequelize');
const db = require('./config/database');
(async function(){
  const User=require('./models/User');
  const PosChargeRule=require('./models/PosChargeRule');
  const user = await User.findByPk(5);
  const merchantRows = await User.findAll({ where: { role:'merchant', franchaise_id: user.id }, attributes:['id'] });
  const merchantIds = merchantRows.map(m=>m.id);
  const userIdCondition = merchantIds.length>0 ? { user_id: { [Op.in]: [user.id, ...merchantIds] } } : { user_id: user.id };
  const where={};
  where[Op.or]=[
    { franchaise_id:null, user_id:null },
    { franchaise_id: user.id },
    userIdCondition
  ];
  console.log('merchants under franchise', merchantIds);
  console.log('userIdCondition', JSON.stringify(userIdCondition));
  console.log('where', JSON.stringify(where, null,2));
  const results = await PosChargeRule.findAndCountAll({ where });
  console.log('count', results.count);
  console.log(results.rows.map(r=>({id:r.id,user_id:r.user_id,franchaise_id:r.franchaise_id})));
  process.exit(0);
})();
