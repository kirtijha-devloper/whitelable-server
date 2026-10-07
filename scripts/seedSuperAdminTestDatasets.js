const bcrypt = require('bcrypt');
const db = require('../config/database');
const User = require('../models/User');
const Company = require('../models/Company');
const PosInventory = require('../models/PosInventory');
const QrInventory = require('../models/QrInventory');
const PgInventory = require('../models/PgInventory');
const ServiceSetting = require('../models/ServiceSetting');

async function seedTestData() {
  console.log('🚀 Starting Super Admin Test Dataset Seeding...');

  try {
    const defaultPassword = await bcrypt.hash('1234', 10);

    // ── 1. Seed 5 Admin Users & White-Label Tenant Companies ────────────────
    const adminSeedData = [
      {
        name: 'Agro-Axis Fintech',
        email: 'admin.axis@agroaxis.com',
        mobile_number: '9876543210',
        domain_name: 'axis.agrofintech.com',
        company_name: 'Agro Axis India Pvt Ltd',
        username: 'APA00001',
        company_id: 'COMP_AXIS_01',
      },
      {
        name: 'PayNext Solutions',
        email: 'contact@paynext.in',
        mobile_number: '9876543211',
        domain_name: 'portal.paynext.in',
        company_name: 'PayNext Digital Services',
        username: 'APA00002',
        company_id: 'COMP_PAYNEXT_02',
      },
      {
        name: 'BharatPay Merchant Services',
        email: 'support@bharatpay.org',
        mobile_number: '9876543212',
        domain_name: 'merchant.bharatpay.org',
        company_name: 'BharatPay Retail Network',
        username: 'APA00003',
        company_id: 'COMP_BHARAT_03',
      },
      {
        name: 'ZetaPay Rural Banking',
        email: 'info@zetapay.co.in',
        mobile_number: '9876543213',
        domain_name: 'rural.zetapay.co.in',
        company_name: 'ZetaPay Financial Technologies',
        username: 'APA00004',
        company_id: 'COMP_ZETA_04',
      },
      {
        name: 'OmniPayments Global',
        email: 'admin@omnipayments.com',
        mobile_number: '9876543214',
        domain_name: 'app.omnipayments.com',
        company_name: 'OmniPayments Networks',
        username: 'APA00005',
        company_id: 'COMP_OMNI_05',
      },
    ];

    for (const data of adminSeedData) {
      let user = await User.findOne({ where: { email: data.email } });
      if (!user) {
        user = await User.create({
          name: data.name,
          email: data.email,
          mobile_number: data.mobile_number,
          mobile_number_country_code: '+91',
          password: defaultPassword,
          role: 'admin',
          username: data.username,
          company_or_shop_name: data.company_name,
          status: 'active',
          is_approved: true,
          is_payout_enabled: true,
          settlement_type: 'today_settlement',
          wallet: 150000.00,
        });
      }

      let company = await Company.findOne({ where: { domain_name: data.domain_name } });
      if (!company) {
        company = await Company.create({
          user_id: user.id,
          domain_name: data.domain_name,
          company_id: data.company_id,
          company_name: data.company_name,
          payout_limit: 500000.00,
          bill_payment_limit: 1000000.00,
          status: 'active',
        });
      }

      if (!user.company_id) {
        user.company_id = data.company_id;
        await user.save();
      }
    }
    console.log('✅ 5 Admin & Company white-label datasets seeded successfully.');

    // ── 2. Seed 5 POS Inventory Machines ─────────────────────────────────────
    const posSeedData = [
      {
        tid_number: 'TID-AXIS-9901',
        serial_number: 'SN-PAX-A920-801',
        model: 'Pax A920',
        company_name: 'Agro Axis India Pvt Ltd',
        assigned_to: 'Agro-Axis Merchant Hub',
        assigned_user_id: 1,
        status: 'active',
      },
      {
        tid_number: 'TID-PAYNEXT-9902',
        serial_number: 'SN-INGENICO-DX8000-802',
        model: 'Ingenico DX8000',
        company_name: 'PayNext Digital Services',
        assigned_to: 'PayNext Super Outlet',
        assigned_user_id: 2,
        status: 'available',
      },
      {
        tid_number: 'TID-BHARAT-9903',
        serial_number: 'SN-VERIFONE-V200-803',
        model: 'Verifone V200t',
        company_name: 'BharatPay Retail Network',
        assigned_to: 'Unassigned',
        assigned_user_id: null,
        status: 'available',
      },
      {
        tid_number: 'TID-ZETA-9904',
        serial_number: 'SN-PAX-A920-804',
        model: 'Pax A920 Pro',
        company_name: 'ZetaPay Financial Technologies',
        assigned_to: 'ZetaPay Regional Hub',
        assigned_user_id: 4,
        status: 'maintenance',
      },
      {
        tid_number: 'TID-OMNI-9905',
        serial_number: 'SN-SUNMI-P2-805',
        model: 'Sunmi P2 PRO',
        company_name: 'OmniPayments Networks',
        assigned_to: 'Omni Super Franchise',
        assigned_user_id: 5,
        status: 'active',
      },
    ];

    for (const pos of posSeedData) {
      await PosInventory.upsert(pos);
    }
    console.log('✅ 5 POS Inventory datasets seeded successfully.');

    // ── 3. Seed 5 QR Standees & Soundboxes Inventory ──────────────────────────
    const qrSeedData = [
      {
        qr_code: 'QR-ABHEE-1001',
        vpa_id: 'agroaxis@hdfcbank',
        type: '4G Soundbox',
        partner_bank: 'HDFC Bank',
        assigned_to: 'Agro-Axis Store #1',
        status: 'active',
      },
      {
        qr_code: 'QR-ABHEE-1002',
        vpa_id: 'paynext.digital@icici',
        type: 'Acrylic Standee',
        partner_bank: 'ICICI Bank',
        assigned_to: 'PayNext Express',
        status: 'active',
      },
      {
        qr_code: 'QR-ABHEE-1003',
        vpa_id: 'bharatpay@axisbank',
        type: '4G Soundbox with Display',
        partner_bank: 'Axis Bank',
        assigned_to: 'Unassigned',
        status: 'unassigned',
      },
      {
        qr_code: 'QR-ABHEE-1004',
        vpa_id: 'zetapay@sbi',
        type: 'NFC Smart Card',
        partner_bank: 'State Bank of India',
        assigned_to: 'ZetaPay Kiosk',
        status: 'damaged',
      },
      {
        qr_code: 'QR-ABHEE-1005',
        vpa_id: 'omnipayments@yesbank',
        type: 'Acrylic Standee',
        partner_bank: 'Yes Bank',
        assigned_to: 'Omni Merchant Mart',
        status: 'active',
      },
    ];

    for (const qr of qrSeedData) {
      await QrInventory.upsert(qr);
    }
    console.log('✅ 5 QR Inventory datasets seeded successfully.');

    // ── 4. Seed 5 PG MIDs Inventory ──────────────────────────────────────────
    const pgSeedData = [
      {
        mid: 'MID-RZP-998201',
        gateway: 'Razorpay PG',
        title: 'Razorpay Enterprise Corporate PG',
        company_name: 'Agro Axis India Pvt Ltd',
        daily_limit: '₹ 1,00,00,000',
        status: 'active',
      },
      {
        mid: 'MID-CASHFREE-998202',
        gateway: 'Cashfree PG',
        title: 'Cashfree Direct Merchant Gateway',
        company_name: 'PayNext Digital Services',
        daily_limit: '₹ 50,00,000',
        status: 'active',
      },
      {
        mid: 'MID-WORLDLINE-998203',
        gateway: 'Worldline PG',
        title: 'Worldline Multi-card Processing MID',
        company_name: 'BharatPay Retail Network',
        daily_limit: '₹ 75,00,000',
        status: 'unallocated',
      },
      {
        mid: 'MID-PINELABS-998204',
        gateway: 'PineLabs POS Gateway',
        title: 'PineLabs Plutus Smart MID',
        company_name: 'ZetaPay Financial Technologies',
        daily_limit: '₹ 25,00,000',
        status: 'sandbox',
      },
      {
        mid: 'MID-PAYU-998205',
        gateway: 'PayU Biz',
        title: 'PayU Corporate Express Checkout MID',
        company_name: 'OmniPayments Networks',
        daily_limit: '₹ 2,00,00,000',
        status: 'active',
      },
    ];

    for (const pg of pgSeedData) {
      await PgInventory.upsert(pg);
    }
    console.log('✅ 5 PG Inventory datasets seeded successfully.');

    // ── 5. Seed 5 Platform Services ──────────────────────────────────────────
    const servicesSeedData = [
      {
        service_key: 'vimo_payout',
        label: 'Vimo Native Payout',
        category: 'Payout & Banking',
        description: 'Vimo Direct Bank Settlement Gateway',
        is_enabled: true,
        target_roles: ['admin', 'franchise', 'merchant'],
      },
      {
        service_key: 'branchx_payout',
        label: 'BranchX Payout',
        category: 'Payout & Banking',
        description: 'BranchX High-Speed Payout Gateway',
        is_enabled: true,
        target_roles: ['admin', 'franchise', 'merchant'],
      },
      {
        service_key: 'pos_inventory',
        label: 'POS Inventory & Rentals',
        category: 'POS & Hardware',
        description: 'POS Machine Inventory & Terminal Management',
        is_enabled: true,
        target_roles: ['admin', 'franchise', 'merchant', 'super_franchise'],
      },
      {
        service_key: 'aadhaar_pay',
        label: 'Aadhaar Pay AEPS',
        category: 'Payout & Banking',
        description: 'Biometric Aadhaar cash withdrawal service',
        is_enabled: true,
        target_roles: ['admin', 'franchise', 'merchant'],
      },
      {
        service_key: 'qr_payments',
        label: 'QR & Soundbox Payments',
        category: 'POS & Hardware',
        description: '4G Soundbox & Standee QR payments',
        is_enabled: true,
        target_roles: ['admin', 'franchise', 'merchant'],
      },
    ];

    for (const s of servicesSeedData) {
      await ServiceSetting.upsert(s);
    }
    console.log('✅ 5 Platform Services seeded successfully.');

    console.log('🎉 ALL SUPER ADMIN TEST DATASETS SEEDED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Error seeding Super Admin test datasets:', err);
  } finally {
    await db.close();
  }
}

seedTestData();
