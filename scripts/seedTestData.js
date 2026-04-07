/**
 * Seed script: create all DB rows needed to fire testWebhook.js locally.
 *
 * Creates (idempotent — safe to run multiple times):
 *   1. Franchise user
 *   2. Merchant user linked to franchise
 *   3. POS machine  (mid=TESTDUMMY01 / tid=TESTDUMMY01)  assigned to merchant
 *   4. PosTransactionCharge rows for the merchant  (MDR rates)
 *   5. CommissionDefault slabs  (UPI + CARD + RUPAY CREDIT)
 *   6. UserCommission links for both merchant and franchise
 *
 * Usage:
 *   node scripts/seedTestData.js
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../config/database');

const User                 = require('../models/User');
const PosMachine           = require('../models/posMachine');
const PosTransactionCharge = require('../models/PosTransactionCharge');
const CommissionDefault    = require('../models/CommissionDefault');
const UserCommission       = require('../models/UserCommission');

// ── helpers ───────────────────────────────────────────────────────────────────

async function findOrCreateUser(where, defaults) {
  const existing = await User.findOne({ where });
  if (existing) {
    console.log(`  [SKIP] User already exists: ${where.email}  (id=${existing.id})`);
    return existing;
  }
  const created = await User.create({ ...where, ...defaults });
  console.log(`  [NEW]  User created:        ${where.email}  (id=${created.id})`);
  return created;
}

async function findOrCreatePosMachine(where, defaults) {
  const existing = await PosMachine.findOne({ where });
  if (existing) {
    console.log(`  [SKIP] POS machine already exists: mid=${where.mid_number} / tid=${where.tid_number}  (id=${existing.id})`);
    return existing;
  }
  const created = await PosMachine.create({ ...where, ...defaults });
  console.log(`  [NEW]  POS machine created: mid=${where.mid_number} / tid=${where.tid_number}  (id=${created.id})`);
  return created;
}

async function findOrCreateCharge(where, defaults) {
  const existing = await PosTransactionCharge.findOne({ where });
  if (existing) {
    console.log(`  [SKIP] PosTransactionCharge already exists: merchant_id=${where.merchant_id}, method=${where.method}`);
    return existing;
  }
  const created = await PosTransactionCharge.create({ ...where, ...defaults });
  console.log(`  [NEW]  PosTransactionCharge created: merchant_id=${where.merchant_id}, method=${where.method}, rate=${created.rate_percentage}%`);
  return created;
}

async function findOrCreateCommissionDefault(where, defaults) {
  const existing = await CommissionDefault.findOne({ where });
  if (existing) {
    console.log(`  [SKIP] CommissionDefault already exists: mode=${where.payment_mode}, brand=${where.payment_card_brand}, type=${where.payment_card_type}`);
    return existing;
  }
  const created = await CommissionDefault.create({ ...where, ...defaults });
  console.log(`  [NEW]  CommissionDefault created: id=${created.id}, mode=${created.payment_mode}`);
  return created;
}

async function findOrCreateUserCommission(userId, commissionDefaultId) {
  const existing = await UserCommission.findOne({
    where: { user_id: userId, commission_default_id: commissionDefaultId }
  });
  if (existing) {
    console.log(`  [SKIP] UserCommission already linked: user_id=${userId} -> commission_default_id=${commissionDefaultId}`);
    return existing;
  }
  const created = await UserCommission.create({
    user_id: userId,
    commission_default_id: commissionDefaultId,
    is_active: true,
  });
  console.log(`  [NEW]  UserCommission linked: user_id=${userId} -> commission_default_id=${commissionDefaultId}`);
  return created;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function seed() {
  try {
    await db.authenticate();
    console.log('✅ DB connected\n');

    const hashedPassword = await bcrypt.hash('Test@1234', 10);

    // ── 1. Franchise users ─────────────────────────────────────────────────
    console.log('── 1. Franchise users ─────────────────────────────────────────');
    const franchise = await findOrCreateUser(
      { email: 'test.franchise@example.com' },
      {
        name: 'Test Franchise',
        mobile_number: '9000000001',
        password: hashedPassword,
        role: 'franchaise',
        status: 'active',
        is_approved: true,
        wallet: 0,
        settlement_type: 'today_settlement',
      }
    );

    // add a second franchise for variety
    const franchise2 = await findOrCreateUser(
      { email: 'another.franchise@example.com' },
      {
        name: 'Another Franchise',
        mobile_number: '9000000003',
        password: hashedPassword,
        role: 'franchaise',
        status: 'active',
        is_approved: true,
        wallet: 0,
        settlement_type: 'today_settlement',
      }
    );

    // ── 2. Merchant users ──────────────────────────────────────────────────
    console.log('\n── 2. Merchant users ───────────────────────────────────────────');
    const merchant = await findOrCreateUser(
      { email: 'test.merchant@example.com' },
      {
        name: 'Test Merchant',
        mobile_number: '9000000002',
        password: hashedPassword,
        role: 'merchant',
        status: 'active',
        is_approved: true,
        is_pos_asigned: true,
        wallet: 0,
        settlement_type: 'today_settlement',
        franchaise_id: franchise.id,
      }
    );

    // merchant without a franchise (admin-only)
    const merchantNoFr = await findOrCreateUser(
      { email: 'solo.merchant@example.com' },
      {
        name: 'Solo Merchant',
        mobile_number: '9000000004',
        password: hashedPassword,
        role: 'merchant',
        status: 'active',
        is_approved: true,
        is_pos_asigned: false,
        wallet: 0,
        settlement_type: 'today_settlement',
        franchaise_id: null,
      }
    );

    // merchant under second franchise
    const merchantUnder2 = await findOrCreateUser(
      { email: 'fr2.merchant@example.com' },
      {
        name: 'Franchise2 Merchant',
        mobile_number: '9000000005',
        password: hashedPassword,
        role: 'merchant',
        status: 'active',
        is_approved: true,
        is_pos_asigned: true,
        wallet: 0,
        settlement_type: 'today_settlement',
        franchaise_id: franchise2.id,
      }
    );

    // Ensure franchaise_id is set (handles re-run after franchise was already created)
    if (!merchant.franchaise_id || merchant.franchaise_id !== franchise.id) {
      await merchant.update({ franchaise_id: franchise.id });
      console.log(`  [UPD]  Set merchant.franchaise_id = ${franchise.id}`);
    }

    if (!merchantUnder2.franchaise_id || merchantUnder2.franchaise_id !== franchise2.id) {
      await merchantUnder2.update({ franchaise_id: franchise2.id });
      console.log(`  [UPD]  Set merchantUnder2.franchaise_id = ${franchise2.id}`);
    }

    // Ensure franchaise_id is set (handles re-run after franchise was already created)
    if (!merchant.franchaise_id || merchant.franchaise_id !== franchise.id) {
      await merchant.update({ franchaise_id: franchise.id });
      console.log(`  [UPD]  Set merchant.franchaise_id = ${franchise.id}`);
    }

    // ── 3. POS machine ────────────────────────────────────────────────────────
    console.log('\n── 3. POS machine ─────────────────────────────────────────────');
    const posMachine = await findOrCreatePosMachine(
      { mid_number: 'TESTDUMMY01', tid_number: 'TESTDUMMY01' },
      {
        device_serial_number: 'TESTINGSERIALNO',
        company_name: 'Test Company',
        razorpay_id: 'TESTDUMMY01',
        status: 'active',
        remarks: 'Test POS for webhook',
        assigned_to: merchant.id,
        created_by_user_id: merchant.id,
      }
    );

    // Ensure it's assigned to this merchant (handles re-run)
    if (posMachine.assigned_to !== merchant.id || posMachine.status !== 'active') {
      await posMachine.update({ assigned_to: merchant.id, status: 'active' });
      console.log(`  [UPD]  POS machine re-assigned to merchant.id=${merchant.id}`);
    }

    // ── 4. POS Transaction Charges (MDR) ──────────────────────────────────────
    // These are what the merchant PAYS — deducted from the raw transaction amount.
    console.log('\n── 4. POS Transaction Charges (MDR) ───────────────────────────');
    const mdrCharges = [
      // UPI — 0 % MDR (Govt mandate for small UPI)
      { method: 'upi',  network: null, card_type: null, subtype: null, rate_percentage: 0.00, is_default: true  },
      // Generic CARD fallback — 0.5 %
      { method: 'card', network: null, card_type: null, subtype: null, rate_percentage: 0.50, is_default: true  },
      // RUPAY CREDIT — 0.3 %
      { method: 'card', network: 'rupay', card_type: 'credit', subtype: null, rate_percentage: 0.30, is_default: false },
    ];

    for (const c of mdrCharges) {
      await findOrCreateCharge(
        { merchant_id: merchant.id, method: c.method, network: c.network ?? null, card_type: c.card_type ?? null },
        { ...c, merchant_id: merchant.id }
      );
    }

    // ── 5. Commission Defaults ────────────────────────────────────────────────
    // These are what the merchant EARNS per transaction (separate from MDR).
    console.log('\n── 5. Commission Defaults ─────────────────────────────────────');
    const commSlabs = [
      // UPI — 0.1 % commission
      { payment_mode: 'UPI',  payment_card_brand: null, payment_card_type: null, min_amount: null, max_amount: null, flat_fee: 0, percent_fee: 0.10, is_active: true },
      // Generic CARD — 0.2 % commission
      { payment_mode: 'CARD', payment_card_brand: null, payment_card_type: null, min_amount: null, max_amount: null, flat_fee: 0, percent_fee: 0.20, is_active: true },
      // RUPAY CREDIT CARD — 0.15 % commission
      { payment_mode: 'CARD', payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', min_amount: null, max_amount: null, flat_fee: 0, percent_fee: 0.15, is_active: true },
    ];

    const createdSlabs = [];
    for (const s of commSlabs) {
      const slab = await findOrCreateCommissionDefault(
        {
          payment_mode:       s.payment_mode       ?? null,
          payment_card_brand: s.payment_card_brand ?? null,
          payment_card_type:  s.payment_card_type  ?? null,
          min_amount:         s.min_amount         ?? null,
          max_amount:         s.max_amount         ?? null,
        },
        s
      );
      createdSlabs.push(slab);
    }

    // ── 6. UserCommission links ───────────────────────────────────────────────
    // Link all slabs to both merchant and franchise so both earn commissions.
    console.log('\n── 6. UserCommission links ────────────────────────────────────');
    for (const slab of createdSlabs) {
      await findOrCreateUserCommission(merchant.id,  slab.id);
      await findOrCreateUserCommission(franchise.id, slab.id);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log(`
╔══════════════════════════════════════════════════════╗
║                   SEED COMPLETE ✅                   ║
╠══════════════════════════════════════════════════════╣
║  Franchise  id:  ${String(franchise.id).padEnd(35)}║
║  Merchant   id:  ${String(merchant.id).padEnd(35)}║
║  POS Machine id: ${String(posMachine.id).padEnd(35)}║
║  mid/tid :       TESTDUMMY01 / TESTDUMMY01           ║
╠══════════════════════════════════════════════════════╣
║  Now run:  npm run webhook:upi                       ║
║        or  npm run webhook:card                      ║
╚══════════════════════════════════════════════════════╝
`);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Seeding failed:', err);
    process.exit(1);
  }
}

seed();
