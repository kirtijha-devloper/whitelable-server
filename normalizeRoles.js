const User = require('./models/User');

(async()=>{
  const [count] = await User.update({ role: 'franchaise' }, { where:{ role:'franchise' } });
  console.log('updated', count, 'users to role=franchaise');
  process.exit(0);
})();