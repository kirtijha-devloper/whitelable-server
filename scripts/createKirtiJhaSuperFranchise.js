require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../config/database');
const User = require('../models/User');
const UsernameSequence = require('../models/UsernameSequence');
const { Op } = require('sequelize');

async function createKirtiJhaAndMapFranchises() {
  console.log('--- Creating Kirti Jha Super Franchise & Mapping Existing Franchises ---');
  
  const email = 'kjha0141@gmail.com';
  const mobile = '9953192528';
  const name = 'Kirti Jha';

  // 1. Check if user already exists by email or mobile
  let superFranchise = await User.findOne({
    where: {
      [Op.or]: [{ email }, { mobile_number: mobile }]
    }
  });

  if (!superFranchise) {
    const hashPassword = await bcrypt.hash('KirtiJha@123', 10);

    // Allocate username APSF...
    const [seq] = await UsernameSequence.findOrCreate({
      where: { prefix: 'APSF' },
      defaults: { current_value: 0 }
    });
    const nextVal = (Number(seq.current_value) || 0) + 1;
    const username = `APSF${String(nextVal).padStart(5, '0')}`;
    seq.current_value = nextVal;
    await seq.save();

    superFranchise = await User.create({
      name,
      email,
      mobile_number: mobile,
      mobile_number_country_code: '+91',
      password: hashPassword,
      role: 'super_franchise',
      username,
      abheepay_id: username,
      is_approved: true,
      status: 'active',
      settlement_type: 'today_settlement',
      permissions: []
    });

    console.log(`✅ Created Super Franchise: ${name} (${username}) | ID: ${superFranchise.id}`);
  } else {
    // Ensure role is super_franchise
    superFranchise.role = 'super_franchise';
    superFranchise.is_approved = true;
    superFranchise.status = 'active';
    await superFranchise.save();
    console.log(`✅ Existing user updated to Super Franchise: ${name} (${superFranchise.username}) | ID: ${superFranchise.id}`);
  }

  // 2. Map all existing Franchises to this Super Franchise
  const [franchiseCount] = await User.update(
    { super_franchise_id: superFranchise.id },
    {
      where: {
        role: { [Op.in]: ['franchise', 'franchaise'] },
        id: { [Op.ne]: superFranchise.id }
      }
    }
  );
  console.log(`✅ Mapped ${franchiseCount} existing Franchise(s) to Super Franchise ID ${superFranchise.id}`);

  // 3. Map all Merchants under those Franchises to this Super Franchise ID
  const [merchantCount] = await User.update(
    { super_franchise_id: superFranchise.id },
    {
      where: {
        role: 'merchant',
        franchaise_id: { [Op.not]: null }
      }
    }
  );
  console.log(`✅ Mapped ${merchantCount} Merchant(s) under Franchises to Super Franchise ID ${superFranchise.id}`);

  console.log('--- Migration & Assignment Completed Successfully ---');
  process.exit(0);
}

createKirtiJhaAndMapFranchises().catch((err) => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
