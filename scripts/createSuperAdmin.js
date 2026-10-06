const bcrypt = require('bcrypt');
const User = require('../models/User');
const db = require('../config/database');

async function createSuperAdmin() {
  try {
    const mobile_number = '9953192528';
    const rawPassword = '1234';
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const existingUser = await User.findOne({
      where: { mobile_number }
    });

    if (existingUser) {
      existingUser.role = 'super_admin';
      existingUser.password = hashedPassword;
      existingUser.status = 'active';
      existingUser.is_approved = true;
      existingUser.is_payout_enabled = true;
      await existingUser.save();

      console.log(`✅ Updated existing user (${mobile_number}) to Super Admin successfully.`);
      console.log(`User ID: ${existingUser.id}, Email: ${existingUser.email}, Role: ${existingUser.role}`);
    } else {
      const newUser = await User.create({
        name: 'Super Admin',
        email: 'superadmin@abheepay.com',
        mobile_number: mobile_number,
        mobile_number_country_code: '+91',
        password: hashedPassword,
        role: 'super_admin',
        username: 'SUPERADMIN99',
        abheepay_id: 'ABHEESUPER01',
        status: 'active',
        is_approved: true,
        is_payout_enabled: true,
        wallet: 0,
      });

      console.log(`🎉 Created new Super Admin (${mobile_number}) successfully.`);
      console.log(`User ID: ${newUser.id}, Email: ${newUser.email}, Role: ${newUser.role}`);
    }
  } catch (err) {
    console.error('❌ Error creating Super Admin:', err);
  } finally {
    await db.close();
  }
}

createSuperAdmin();
