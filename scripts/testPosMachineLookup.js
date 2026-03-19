require('dotenv').config();
const db = require('../config/database');
const PosMachine = require('../models/posMachine');

(async () => {
  await db.authenticate();
  console.log('DB connected');

  const mids = ['037135032060252', '37135032060252'];
  const tid = '77971893';

  for (const mid of mids) {
    const pm = await PosMachine.findOne({ where: { mid_number: mid, tid_number: tid } });
    console.log('mid:', mid, 'found?', !!pm);
    if (pm) console.log(pm.get({ plain: true }));
  }

  process.exit(0);
})();
