const { expect } = require('chai');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const posChargeRuleRoutes = require('../routes/posChargeRuleRoutes');
const serviceChargeRoutes = require('../routes/serviceChargeRoutes');
const rentalRoutes = require('../routes/rentalRoutes');
const bbpsCCBillRoutes = require('../routes/cc/bbps/bbpsCCBillRoutes');
const payoutChargeRoutes = require('../routes/payoutChargeRoutes');
const userPayoutChargeRoutes = require('../routes/userPayoutChargeRoutes');

const PosChargeRule = require('../models/PosChargeRule');
const Rental = require('../models/Rental');
const BbpsCcChargeRule = require('../models/BbpsCcChargeRule');
const PayoutCharge = require('../models/PayoutCharge');
const UserPayoutCharge = require('../models/UserPayoutCharge');
const User = require('../models/User');

const SECRET = process.env.ACCESS_TOKEN_SECRET || 'testsecret';

describe('Complete Rate Management Hierarchy End-to-End Tests', () => {
  let app;
  let superAdminToken;
  let admin1Token;
  let admin2Token;
  let superFranchiseToken;
  let franchiseToken;
  let merchantToken;

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = SECRET;
    process.env.NODE_ENV = 'test';

    app = express();
    app.use(express.json());
    // Attach dummy company middleware for test runner
    app.use((req, res, next) => {
      req.company = 'COMP_TEST_01';
      next();
    });

    app.use('/api/pos-charge-rules', posChargeRuleRoutes);
    app.use('/api/service-charge', serviceChargeRoutes);
    app.use('/api/rentals', rentalRoutes);
    app.use('/api/bbps/cc-bill', bbpsCCBillRoutes);
    app.use('/api/payout-charges', payoutChargeRoutes);
    app.use('/api/user-payout-charges', userPayoutChargeRoutes);

    superAdminToken = jwt.sign({ user: { id: 1, role: 'super_admin', company_id: null } }, SECRET);
    admin1Token = jwt.sign({ user: { id: 2, role: 'admin', company_id: 'COMP_TEST_01' } }, SECRET);
    admin2Token = jwt.sign({ user: { id: 3, role: 'admin', company_id: 'COMP_TEST_02' } }, SECRET);
    superFranchiseToken = jwt.sign({ user: { id: 10, role: 'super_franchise', company_id: 'COMP_TEST_01' } }, SECRET);
    franchiseToken = jwt.sign({ user: { id: 20, role: 'franchaise', company_id: 'COMP_TEST_01', super_franchise_id: 10 } }, SECRET);
    merchantToken = jwt.sign({ user: { id: 30, role: 'merchant', company_id: 'COMP_TEST_01', franchaise_id: 20, super_franchise_id: 10 } }, SECRET);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('1. Super Admin Global Default and Admin Override Protection', () => {
    it('Admins cannot update Super Admin global default rules (403 Forbidden)', async () => {
      const globalRule = {
        id: 101,
        scope: 'super_admin_default',
        company_id: null,
        created_by: 1,
        update: async () => {},
      };
      sinon.stub(PosChargeRule, 'findByPk').resolves(globalRule);

      const res = await request(app)
        .put('/api/pos-charge-rules/101')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ charge_percent: 1.5 });

      expect(res.status).to.equal(403);
      expect(res.body.message).to.include('Super Admin rules or global defaults');
    });

    it('Admins cannot delete Super Admin global default rules (403 Forbidden)', async () => {
      const globalRule = {
        id: 101,
        scope: 'super_admin_default',
        company_id: null,
        created_by: 1,
        destroy: async () => {},
      };
      sinon.stub(PosChargeRule, 'findByPk').resolves(globalRule);

      const res = await request(app)
        .delete('/api/pos-charge-rules/101')
        .set('Authorization', `Bearer ${admin1Token}`);

      expect(res.status).to.equal(403);
      expect(res.body.message).to.include('Super Admin rules or global defaults');
    });

    it('Admins cannot modify rules belonging to another company (Tenant Isolation 403)', async () => {
      const foreignRule = {
        id: 202,
        scope: 'admin_franchise',
        company_id: 'COMP_TEST_02',
        created_by: 3,
        update: async () => {},
      };
      sinon.stub(PosChargeRule, 'findByPk').resolves(foreignRule);

      const res = await request(app)
        .put('/api/pos-charge-rules/202')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ charge_percent: 2.0 });

      expect(res.status).to.equal(403);
      expect(res.body.message).to.include('another company');
    });
  });

  describe('2. Admin Downstream Rate Assignment Validation', () => {
    it('Admin can create permitted Super Franchise rate rule with scope admin_super_franchise', async () => {
      sinon.stub(User, 'findByPk').resolves({ id: 10, role: 'super_franchise', company_id: 'COMP_TEST_01' });
      sinon.stub(PosChargeRule, 'findOne').resolves(null);
      sinon.stub(PosChargeRule, 'findAll').resolves([]);
      const createdRule = {
        id: 301,
        super_franchise_id: 10,
        scope: 'admin_super_franchise',
        payment_mode: 'CARD',
        card_type: 'CREDIT',
        charge_percent: 1.8,
      };
      sinon.stub(PosChargeRule, 'create').resolves(createdRule);

      const res = await request(app)
        .post('/api/pos-charge-rules')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({
          super_franchise_id: 10,
          payment_mode: 'CARD',
          card_type: 'CREDIT',
          charge_percent: 1.8,
        });

      expect(res.status).to.equal(201);
      expect(res.body.success).to.be.true;
    });

    it('Rejects invalid amount ranges (min_amount > max_amount)', async () => {
      const res = await request(app)
        .post('/api/pos-charge-rules')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({
          payment_mode: 'CARD',
          min_amount: 1000,
          max_amount: 500,
          charge_percent: 1.8,
        });

      expect(res.status).to.equal(400);
      expect(res.body.errors).to.be.an('array');
      expect(res.body.errors.some((e) => e.includes('min_amount cannot be greater than max_amount'))).to.be.true;
    });
  });

  describe('3. Effective Charges Hierarchy & Source Label Resolution', () => {
    it('Admin gets Super Admin Override label when override rule exists for that Admin', async () => {
      sinon.stub(User, 'findByPk').resolves({
        id: 2,
        role: 'admin',
        company_id: 'COMP_TEST_01',
      });

      const overrideRule = {
        id: 401,
        user_id: 2,
        scope: 'super_admin_admin',
        payment_mode: 'CARD',
        card_brand: 'VISA',
        card_type: 'CREDIT',
        card_classification: 'PLATINUM',
        settlement_type: 'today_settlement',
        charge_percent: 1.5,
        charge_flat: 0,
        gst_required: true,
        gst_percent: 18,
        is_active: true,
      };

      sinon.stub(PosChargeRule, 'findAll').resolves([overrideRule]);
      sinon.stub(PayoutCharge, 'findAll').resolves([]);
      sinon.stub(UserPayoutCharge, 'findAll').resolves([]);
      sinon.stub(BbpsCcChargeRule, 'findAll').resolves([]);
      sinon.stub(Rental, 'findOne').resolves({
        id: 501,
        amount: 500,
        target_user_type: 'admin',
        status: 'active',
      });

      const res = await request(app)
        .get('/api/service-charge/my-applicable-charges')
        .set('Authorization', `Bearer ${admin1Token}`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.data.pos).to.be.an('array');
      expect(res.body.data.pos[0].source_label).to.equal('Super Admin Override');
      expect(res.body.data.pos[0].is_override).to.be.true;
      expect(res.body.data.rental).to.be.an('array');
      expect(res.body.data.rental[0].source_label).to.equal('Inherited Default');
    });

    it('Super Franchise receives Admin Override label when Admin configured specific rate', async () => {
      sinon.stub(User, 'findByPk').resolves({
        id: 10,
        role: 'super_franchise',
        company_id: 'COMP_TEST_01',
      });
      sinon.stub(User, 'findOne').resolves({ id: 2 });

      const sfRule = {
        id: 402,
        super_franchise_id: 10,
        scope: 'admin_super_franchise',
        payment_mode: 'CARD',
        card_brand: 'VISA',
        card_type: 'CREDIT',
        card_classification: 'PLATINUM',
        settlement_type: 'today_settlement',
        charge_percent: 1.7,
        charge_flat: 0,
        gst_required: true,
        gst_percent: 18,
        is_active: true,
      };

      sinon.stub(PosChargeRule, 'findAll').resolves([sfRule]);
      sinon.stub(PayoutCharge, 'findAll').resolves([]);
      sinon.stub(UserPayoutCharge, 'findAll').resolves([]);
      sinon.stub(BbpsCcChargeRule, 'findAll').resolves([]);
      sinon.stub(Rental, 'findOne').resolves(null);

      const res = await request(app)
        .get('/api/service-charge/my-applicable-charges')
        .set('Authorization', `Bearer ${superFranchiseToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.pos[0].source_label).to.equal('Admin Override');
      expect(res.body.data.pos[0].is_override).to.be.true;
    });

    it('Franchise resolves nearest Super Franchise override (3.00%) over Admin default (2.00%)', async () => {
      sinon.stub(User, 'findByPk').resolves({
        id: 20,
        role: 'franchaise',
        company_id: 'COMP_TEST_01',
        super_franchise_id: 10,
      });
      sinon.stub(User, 'findOne').resolves({ id: 2 });

      const adminDefaultRule = {
        id: 101,
        scope: 'admin_default',
        payment_mode: 'CARD',
        card_brand: 'VISA',
        card_type: 'CREDIT',
        card_classification: 'PLATINUM',
        settlement_type: 'today_settlement',
        charge_percent: 2.0,
        charge_flat: 0,
        gst_required: false,
        gst_percent: 0,
        is_active: true,
      };

      const sfFranchiseOverride = {
        id: 201,
        super_franchise_id: 10,
        franchaise_id: 20,
        scope: 'super_franchise_franchise',
        payment_mode: 'CARD',
        card_brand: 'VISA',
        card_type: 'CREDIT',
        card_classification: 'PLATINUM',
        settlement_type: 'today_settlement',
        charge_percent: 3.0,
        charge_flat: 0,
        gst_required: false,
        gst_percent: 0,
        is_active: true,
      };

      sinon.stub(PosChargeRule, 'findAll').resolves([adminDefaultRule, sfFranchiseOverride]);
      sinon.stub(PayoutCharge, 'findAll').resolves([]);
      sinon.stub(UserPayoutCharge, 'findAll').resolves([]);
      sinon.stub(BbpsCcChargeRule, 'findAll').resolves([]);
      sinon.stub(Rental, 'findOne').resolves(null);

      const res = await request(app)
        .get('/api/service-charge/my-applicable-charges')
        .set('Authorization', `Bearer ${franchiseToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.pos).to.be.an('array');
      // Must pick the nearest upline rate (3.00% from Super Franchise override)
      expect(parseFloat(res.body.data.pos[0].charge_percent)).to.equal(3.0);
      expect(res.body.data.pos[0].source_label).to.equal('Super Franchise Rate');
      expect(res.body.data.pos[0].is_override).to.be.true;
    });

    it('Merchant resolves nearest Franchise override over Super Franchise and Admin', async () => {
      sinon.stub(User, 'findByPk').resolves({
        id: 30,
        role: 'merchant',
        company_id: 'COMP_TEST_01',
        franchaise_id: 20,
        super_franchise_id: 10,
      });
      sinon.stub(User, 'findOne').resolves({ id: 2 });

      const adminDefaultRule = {
        id: 101,
        scope: 'admin_default',
        payment_mode: 'CARD',
        card_brand: 'VISA',
        card_type: 'CREDIT',
        card_classification: 'PLATINUM',
        settlement_type: 'today_settlement',
        charge_percent: 2.0,
        charge_flat: 0,
        is_active: true,
      };

      const sfDefaultRule = {
        id: 201,
        super_franchise_id: 10,
        scope: 'super_franchise_default',
        payment_mode: 'CARD',
        card_brand: 'VISA',
        card_type: 'CREDIT',
        card_classification: 'PLATINUM',
        settlement_type: 'today_settlement',
        charge_percent: 2.5,
        charge_flat: 0,
        is_active: true,
      };

      const franchiseMerchantRule = {
        id: 301,
        user_id: 30,
        franchaise_id: 20,
        scope: 'franchise_merchant',
        payment_mode: 'CARD',
        card_brand: 'VISA',
        card_type: 'CREDIT',
        card_classification: 'PLATINUM',
        settlement_type: 'today_settlement',
        charge_percent: 3.2,
        charge_flat: 0,
        is_active: true,
      };

      sinon.stub(PosChargeRule, 'findAll').resolves([adminDefaultRule, sfDefaultRule, franchiseMerchantRule]);
      sinon.stub(PayoutCharge, 'findAll').resolves([]);
      sinon.stub(UserPayoutCharge, 'findAll').resolves([]);
      sinon.stub(BbpsCcChargeRule, 'findAll').resolves([]);
      sinon.stub(Rental, 'findOne').resolves(null);

      const res = await request(app)
        .get('/api/service-charge/my-applicable-charges')
        .set('Authorization', `Bearer ${merchantToken}`);

      expect(res.status).to.equal(200);
      expect(parseFloat(res.body.data.pos[0].charge_percent)).to.equal(3.2);
      expect(res.body.data.pos[0].source_label).to.equal('Franchise Rate');
      expect(res.body.data.pos[0].is_override).to.be.true;
    });
  });

  describe('4. Protection of POS Rental, CC Bill, and Payout Rates', () => {
    it('Admin cannot update or delete platform-level Admin Rental (403 Forbidden)', async () => {
      const adminRental = {
        id: 601,
        target_user_type: 'admin',
        amount: 500,
        update: async () => {},
        destroy: async () => {},
      };
      sinon.stub(Rental, 'findByPk').resolves(adminRental);

      const updateRes = await request(app)
        .put('/api/rentals/601')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ amount: 600 });
      expect(updateRes.status).to.equal(403);
      expect(updateRes.body.message).to.include('Super Admin');

      const delRes = await request(app)
        .delete('/api/rentals/601')
        .set('Authorization', `Bearer ${admin1Token}`);
      expect(delRes.status).to.equal(403);
    });

    it('Admin cannot create, update, or delete global default CC Bill rules (403 Forbidden)', async () => {
      const createRes = await request(app)
        .post('/api/bbps/cc-bill/charge-rules')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ user_id: null, from_amount: 1, to_amount: 1000, rate: 10, rate_type: 'percentage' });
      expect(createRes.status).to.equal(403);

      const globalCcRule = {
        id: 701,
        user_id: null,
        update: async () => {},
        destroy: async () => {},
      };
      sinon.stub(BbpsCcChargeRule, 'findByPk').resolves(globalCcRule);

      const updateRes = await request(app)
        .put('/api/bbps/cc-bill/charge-rules/701')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ rate: 12 });
      expect(updateRes.status).to.equal(403);

      const delRes = await request(app)
        .delete('/api/bbps/cc-bill/charge-rules/701')
        .set('Authorization', `Bearer ${admin1Token}`);
      expect(delRes.status).to.equal(403);
    });

    it('Admin cannot create or modify global payout charge slabs (403 Forbidden)', async () => {
      const createRes = await request(app)
        .post('/api/payout-charges')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ from_amount: 1, to_amount: 1000, rate: 15, rate_type: 'percentage' });
      expect(createRes.status).to.equal(403);
      expect(createRes.body.message).to.include('user-payout-charges');

      const updateRes = await request(app)
        .put('/api/payout-charges/801')
        .set('Authorization', `Bearer ${admin1Token}`)
        .send({ rate: 20 });
      expect(updateRes.status).to.equal(403);

      const delRes = await request(app)
        .delete('/api/payout-charges/801')
        .set('Authorization', `Bearer ${admin1Token}`);
      expect(delRes.status).to.equal(403);
    });
  });

  describe('5. listFranchiseAdminRules queries Super Franchise rules for Franchise', () => {
    it('returns super_franchise_franchise and super_franchise_default rules for target franchise', async () => {
      sinon.stub(User, 'findByPk').resolves({
        id: 20,
        super_franchise_id: 10,
        role: 'franchaise'
      });
      sinon.stub(User, 'findOne').resolves({ id: 2 });

      const findStub = sinon.stub(PosChargeRule, 'findAndCountAll').resolves({
        count: 2,
        rows: [
          { id: 1, scope: 'admin_default', charge_percent: 2.0 },
          { id: 2, scope: 'super_franchise_franchise', super_franchise_id: 10, franchaise_id: 20, charge_percent: 3.0 }
        ]
      });

      const res = await request(app)
        .get('/api/pos-charge-rules/list/admin?franchaise_id=20')
        .set('Authorization', `Bearer ${franchiseToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.data).to.be.an('array');
      expect(res.body.data.length).to.equal(2);

      // Verify findAndCountAll where condition included super_franchise scopes
      const whereCondition = findStub.firstCall.args[0].where;
      const orClauses = whereCondition[Object.getOwnPropertySymbols(whereCondition)[0]];
      expect(orClauses.some(c => c.scope === 'super_franchise_franchise' && c.franchaise_id === 20)).to.be.true;
      expect(orClauses.some(c => c.scope === 'super_franchise_default' && c.super_franchise_id === 10)).to.be.true;
    });
  });
});
