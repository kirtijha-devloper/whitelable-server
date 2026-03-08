const controller = require('./controllers/posChargeRuleController');
const User = require('./models/User');

(async () => {
  const user = await User.findByPk(5);
  console.log('user role is', user.role);
  const req = { user, query: {} };
  const res = {
    status(code) { this.code = code; return this; },
    json(o) { console.log('ids', o.data.map(d => d.id)); }
  };
  await controller.listPosChargeRules(req, res);
})();