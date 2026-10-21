const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';
const SECRET = process.env.ACCESS_TOKEN_SECRET;

const adminRoutes = require('../routes/adminRoutes');
const userRoutes = require('../routes/userRoutes');
const merchantRoutes = require('../routes/merchantRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const User = require('../models/User');
const Company = require('../models/Company');

const app = express();
app.use(bodyParser.json());
app.use((req, res, next) => {
  req.headers['x-forwarded-host'] = 'test.domain.com';
  next();
});
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/dashboard', dashboardRoutes);

describe('Super Franchise Settlement Hierarchy & Merchant Filtering Tests', function () {
  this.timeout(20000);
  let superFranchiseRam;
  let franchiseKaran;
  let merchantUnderKaran;
  let otherFranchise;
  let otherMerchant;

  let ramToken;
  let karanToken;

  before(async () => {
    const { Op } = require('sequelize');
    const matchedCompany = await Company.findOne({
      where: {
        [Op.or]: [
          { domain_name: { [Op.like]: '%localhost%' } },
          { domain_name: { [Op.like]: '%127.0.0.1%' } }
        ]
      }
    }) || await Company.findOne();
    const companyId = matchedCompany ? matchedCompany.company_id : null;

    // Clean up test users if any
    await User.destroy({
      where: {
        username: ['TEST_APSF_RAM', 'TEST_APF_KARAN', 'TEST_APM_KARAN_M', 'TEST_APF_OTHER', 'TEST_APM_OTHER']
      }
    });

    // 1. Create Super Franchise Ram
    superFranchiseRam = await User.create({
      username: 'TEST_APSF_RAM',
      name: 'Ram Super Franchise',
      email: 'ram.sf@test.com',
      password: 'password123',
      mobile_number: '9888800001',
      role: 'super_franchise',
      status: 'active',
      company_id: companyId,
      t0_daily_limit: 1000000,
      settlement_type: 'T0'
    });

    // 2. Create Downstream Franchise Karan under Ram
    franchiseKaran = await User.create({
      username: 'TEST_APF_KARAN',
      name: 'Karan Franchise',
      email: 'karan.f@test.com',
      password: 'password123',
      mobile_number: '9888800002',
      role: 'franchaise',
      status: 'active',
      company_id: companyId,
      super_franchise_id: superFranchiseRam.id,
      t0_daily_limit: 500000,
      settlement_type: 'T0'
    });

    // 3. Create Merchant under Karan (franchaise_id = Karan, super_franchise_id = null initially to test relational resolution)
    merchantUnderKaran = await User.create({
      username: 'TEST_APM_KARAN_M',
      name: 'Karan Franchise Merchant',
      email: 'merchant.karan@test.com',
      password: 'password123',
      mobile_number: '9888800003',
      role: 'merchant',
      status: 'active',
      company_id: companyId,
      franchaise_id: franchiseKaran.id,
      super_franchise_id: null,
      t0_daily_limit: 50000,
      settlement_type: 'today_settlement'
    });

    // 4. Create Unrelated Standalone Franchise (not under Ram)
    otherFranchise = await User.create({
      username: 'TEST_APF_OTHER',
      name: 'Other Franchise',
      email: 'other.f@test.com',
      password: 'password123',
      mobile_number: '9888800004',
      role: 'franchaise',
      status: 'active',
      company_id: companyId,
      super_franchise_id: null,
      t0_daily_limit: 300000,
      settlement_type: 'T0'
    });

    // 5. Create Merchant under Other Franchise
    otherMerchant = await User.create({
      username: 'TEST_APM_OTHER',
      name: 'Other Merchant',
      email: 'other.m@test.com',
      password: 'password123',
      mobile_number: '9888800005',
      role: 'merchant',
      status: 'active',
      company_id: companyId,
      franchaise_id: otherFranchise.id,
      super_franchise_id: null,
      t0_daily_limit: 20000,
      settlement_type: 'today_settlement'
    });

    ramToken = jwt.sign({
      user: {
        id: superFranchiseRam.id,
        role: 'super_franchise',
        email: superFranchiseRam.email,
        super_franchise_id: null,
        company_id: companyId
      }
    }, SECRET);

    karanToken = jwt.sign({
      user: {
        id: franchiseKaran.id,
        role: 'franchaise',
        email: franchiseKaran.email,
        super_franchise_id: superFranchiseRam.id,
        company_id: companyId
      }
    }, SECRET);
  });

  after(async () => {
    await User.destroy({
      where: {
        username: ['TEST_APSF_RAM', 'TEST_APF_KARAN', 'TEST_APM_KARAN_M', 'TEST_APF_OTHER', 'TEST_APM_OTHER']
      }
    });
  });

  it('1. GET /api/admin/pos-setting as Super Franchise Ram returns Karan and Karan Franchise Merchant, excluding other merchants', async () => {
    const res = await request(app)
      .get('/api/admin/pos-setting')
      .set('Authorization', `Bearer ${ramToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;

    const customers = res.body.data.customers;
    const customerIds = customers.map((c) => c.id);

    // Must include downstream franchise Karan
    expect(customerIds).to.include(franchiseKaran.id);

    // Must include merchant created under Karan
    expect(customerIds).to.include(merchantUnderKaran.id);
    const mItem = customers.find((c) => c.id === merchantUnderKaran.id);
    expect(mItem.name).to.equal('Karan Franchise Merchant');
    expect(mItem.role).to.equal('merchant');
    expect(mItem.franchaise_id).to.equal(franchiseKaran.id);

    // Must NOT include unrelated franchise or unrelated merchant
    expect(customerIds).to.not.include(otherFranchise.id);
    expect(customerIds).to.not.include(otherMerchant.id);
  });

  it('2. GET /api/admin/pos-setting as Franchise Karan returns only Karan Franchise Merchant', async () => {
    const res = await request(app)
      .get('/api/admin/pos-setting')
      .set('Authorization', `Bearer ${karanToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;

    const customers = res.body.data.customers;
    const customerIds = customers.map((c) => c.id);

    // Must include own merchant
    expect(customerIds).to.include(merchantUnderKaran.id);

    // Must NOT include unrelated merchant or super franchise
    expect(customerIds).to.not.include(otherMerchant.id);
    expect(customerIds).to.not.include(superFranchiseRam.id);
    expect(customerIds).to.not.include(otherFranchise.id);
  });

  it('3. POST /api/admin/pos-setting/update-t0-limit allows Super Franchise Ram to update limit of merchant under Karan', async () => {
    const res = await request(app)
      .post('/api/admin/pos-setting/update-t0-limit')
      .set('Authorization', `Bearer ${ramToken}`)
      .send({
        id: merchantUnderKaran.id,
        t0_daily_limit: 75000
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;

    const updated = await User.findByPk(merchantUnderKaran.id);
    expect(Number(updated.t0_daily_limit)).to.equal(75000);
  });

  it('4. POST /api/admin/pos-setting/update-t0-limit forbids Super Franchise Ram from updating unrelated merchant', async () => {
    const res = await request(app)
      .post('/api/admin/pos-setting/update-t0-limit')
      .set('Authorization', `Bearer ${ramToken}`)
      .send({
        id: otherMerchant.id,
        t0_daily_limit: 80000
      });

    expect(res.status).to.equal(403);
  });

  it('5. GET /api/user as Super Franchise Ram returns Karan and merchant under Karan, excluding unrelated merchants', async () => {
    const res = await request(app)
      .get('/api/user?limit=100')
      .set('Authorization', `Bearer ${ramToken}`);

    expect(res.status).to.equal(200);
    const users = res.body.data;
    const userIds = users.map((u) => u.id);

    expect(userIds).to.include(franchiseKaran.id);
    expect(userIds).to.include(merchantUnderKaran.id);
    expect(userIds).to.not.include(otherMerchant.id);
    expect(userIds).to.not.include(otherFranchise.id);
  });

  it('6. GET /api/merchant as Super Franchise Ram returns merchants under Karan', async () => {
    const res = await request(app)
      .get('/api/merchant?limit=100')
      .set('Authorization', `Bearer ${ramToken}`);

    expect(res.status).to.equal(200);
    const merchants = res.body.data;
    const merchantIds = merchants.map((m) => m.id);

    expect(merchantIds).to.include(merchantUnderKaran.id);
    expect(merchantIds).to.not.include(otherMerchant.id);
  });

  it('7. GET /dashboard as Super Franchise Ram returns real dashboard metrics including Karan and downstream merchant', async () => {
    const res = await request(app)
      .get('/dashboard')
      .set('Authorization', `Bearer ${ramToken}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('data');
    const { data } = res.body;

    expect(data).to.have.property('franchaises');
    expect(data.franchaises.count).to.be.at.least(1);

    expect(data).to.have.property('merchants');
    expect(data.merchants.count).to.be.at.least(1);

    expect(data).to.have.property('pos_machines');
    expect(data.pos_machines).to.have.property('total');
    expect(data.pos_machines).to.have.property('active');
    expect(data.pos_machines).to.have.property('inactive');

    expect(data).to.have.property('pos_transactions');
    expect(data.pos_transactions).to.have.property('total');
    expect(data.pos_transactions).to.have.property('success');
    expect(data.pos_transactions).to.have.property('t0_amount');
    expect(data.pos_transactions).to.have.property('t1_amount');

    expect(data).to.have.property('today_total_payout');
    expect(data).to.have.property('ccBillPaymentTXN');
    expect(data).to.have.property('ccBillPaymentSuccess');
    expect(data).to.have.property('ccBillPaymentFailed');
  });
});
