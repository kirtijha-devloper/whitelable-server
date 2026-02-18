/*
  Seed script to create example CommissionDefaults and optional UserCommission links.

  Usage:
    node scripts/seedCommissions.js          # create example slabs
    SEED_USER_ID=123 node scripts/seedCommissions.js   # additionally link created slab to given user id (if user exists)
*/

const db = require('../config/database');
const CommissionDefault = require('../models/CommissionDefault');
const UserCommission = require('../models/UserCommission');
const User = require('../models/User');

async function upsert(model, where, data) {
  const found = await model.findOne({ where });
  if (found) return found;
  return model.create(data);
}

async function seed() {
  try {
    await db.authenticate();

    console.log('Seeding CommissionDefaults...');

    const slabs = [
      // RUPAY card small — flat
      { payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', min_amount: 0, max_amount: 100, flat_fee: 2.00, percent_fee: 0 },
      // RUPAY card large — percent
      { payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', min_amount: 101, max_amount: 100000, flat_fee: 0, percent_fee: 0.5 },
      // Generic card default — percent
      { payment_card_brand: null, payment_card_type: null, payment_mode: 'CARD', min_amount: 0, max_amount: 1000000, flat_fee: 0, percent_fee: 0.7 }
    ];

    for (const s of slabs) {
      await upsert(CommissionDefault, {
        payment_card_brand: s.payment_card_brand || null,
        payment_card_type: s.payment_card_type || null,
        payment_mode: s.payment_mode || null,
        min_amount: s.min_amount || null,
        max_amount: s.max_amount || null
      }, s);
    }

    console.log('CommissionDefaults seeded.');

    const linkUserId = process.env.SEED_USER_ID ? parseInt(process.env.SEED_USER_ID, 10) : null;
    if (linkUserId) {
      const user = await User.findByPk(linkUserId);
      if (!user) {
        console.warn(`User with id=${linkUserId} not found — skipping user-link creation.`);
      } else {
        // link first RUPAY slab to the user
        const rupaySlab = await CommissionDefault.findOne({ where: { payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', min_amount: 0 } });
        if (rupaySlab) {
          const existing = await UserCommission.findOne({ where: { user_id: linkUserId, commission_default_id: rupaySlab.id } });
          if (!existing) {
            await UserCommission.create({ user_id: linkUserId, commission_default_id: rupaySlab.id, is_active: true, created_by: null });
            console.log(`Linked slab id=${rupaySlab.id} to user id=${linkUserId}`);
          } else {
            console.log('User already linked to that slab.');
          }
        }
      }
    }

    console.log('Seeding finished.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
