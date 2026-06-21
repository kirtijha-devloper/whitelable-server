const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const User = require('../models/User');
const EmployeeAccessRole = require('../models/EmployeeAccessRole');
const PayoutTransaction = require('../models/PayoutTransaction');
const Beneficiary = require('../models/Beneficiary');
const vimoController = require('../controllers/vimoController');

describe('Vimo Integration & Payout Limit Routes', () => {
  let app;
  let originalUserFindByPk;
  let originalEmployeeAccessRoleFindByPk;
  let originalCreatePayout;
  let originalCheckPayoutStatus;
  let originalGetWalletBalance;
  const token = jwt.sign({ user: { id: 123 } }, process.env.ACCESS_TOKEN_SECRET);

  beforeEach(() => {
    originalUserFindByPk = User.findByPk;
    originalEmployeeAccessRoleFindByPk = EmployeeAccessRole.findByPk;
    originalCreatePayout = vimoController.createPayout;
    originalCheckPayoutStatus = vimoController.checkPayoutStatus;
    originalGetWalletBalance = vimoController.getWalletBalance;

    // Clear require cache for router so it picks up the overridden controller methods
    delete require.cache[require.resolve('../routes/vimoRoutes')];
    const vimoRoutes = require('../routes/vimoRoutes');

    app = express();
    app.use(express.json());
    app.use('/api/vimo', vimoRoutes);
    app.use((err, req, res, _next) => {
      res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500).json({ message: err.message });
    });
  });

  afterEach(() => {
    User.findByPk = originalUserFindByPk;
    EmployeeAccessRole.findByPk = originalEmployeeAccessRoleFindByPk;
    vimoController.createPayout = originalCreatePayout;
    vimoController.checkPayoutStatus = originalCheckPayoutStatus;
    vimoController.getWalletBalance = originalGetWalletBalance;
  });

  it('rejects request if authorization token is missing', async () => {
    const res = await request(app)
      .post('/api/vimo/payout')
      .send({ amount: 500 });

    expect(res.status).to.equal(401);
    expect(res.body.message).to.match(/No token provided/i);
  });

  it('allows access and processes payout request when valid JWT token is provided', async () => {
    User.findByPk = async (id) => {
      expect(id).to.equal(123);
      return {
        id: 123,
        name: 'Test Partner Customer',
        role: 'merchant',
        status: 'active',
        permissions: [],
        employee_access_role_id: null,
        toJSON() { return this; }
      };
    };

    vimoController.createPayout = (req, res) => {
      expect(req.user.id).to.equal(123);
      res.json({
        success: true,
        message: 'Mock payout processed successfully',
        data: {
          utr: 'MOCKUTR12345',
          status: 'PENDING'
        }
      });
    };

    // Re-require to bind the overridden createPayout handler
    delete require.cache[require.resolve('../routes/vimoRoutes')];
    const freshVimoRoutes = require('../routes/vimoRoutes');
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use('/api/vimo', freshVimoRoutes);

    const res = await request(freshApp)
      .post('/api/vimo/payout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: 123,
        amount: 500,
        merchantRefId: 'AP0000000001',
        beneficiaryAccountNumber: '9182736450',
        beneficiaryIFSC: 'UTIB0001234'
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.message).to.equal('Mock payout processed successfully');
    expect(res.body.data.utr).to.equal('MOCKUTR12345');
  });

  it('allows checking status when correct Bearer token is supplied', async () => {
    User.findByPk = async (id) => {
      return {
        id: 123,
        name: 'Test Partner Customer',
        role: 'merchant',
        status: 'active',
        permissions: [],
        employee_access_role_id: null,
        toJSON() { return this; }
      };
    };

    vimoController.checkPayoutStatus = (req, res) => {
      res.json({
        success: true,
        data: {
          status: 'SUCCESS',
          txnStatus: 'TRANSFERRED'
        }
      });
    };

    // Re-require to bind the overridden checkPayoutStatus handler
    delete require.cache[require.resolve('../routes/vimoRoutes')];
    const freshVimoRoutes = require('../routes/vimoRoutes');
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use('/api/vimo', freshVimoRoutes);

    const res = await request(freshApp)
      .post('/api/vimo/payout/status')
      .set('Authorization', `Bearer ${token}`)
      .send({
        user_id: 123,
        merchantRefId: 'AP0000000001'
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.status).to.equal('SUCCESS');
  });

  it('returns beneficiary limit info successfully via POST /payout/limit-check', async () => {
    User.findByPk = async (id) => {
      return {
        id: 123,
        role: 'merchant',
        status: 'active',
        permissions: [],
        employee_access_role_id: null,
        toJSON() { return this; }
      };
    };

    const originalSum = PayoutTransaction.sum;
    PayoutTransaction.sum = async (field, options) => {
      expect(options.where.payout_provider).to.equal('Vimo');
      expect(options.where.data[Op.iLike]).to.contain('10078018221');
      return 150000;
    };

    const res = await request(app)
      .post('/api/vimo/payout/limit-check')
      .set('Authorization', `Bearer ${token}`)
      .send({
        accountNumber: '10078018221',
        bankIfsc: 'IDFB0040111',
        provider: 'Vimo'
      });

    PayoutTransaction.sum = originalSum;

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.provider).to.equal('Vimo');
    expect(res.body.accountNumber).to.equal('10078018221');
    expect(res.body.monthlyTotal).to.equal(150000);
    expect(res.body.limit).to.equal(500000);
    expect(res.body.remainingLimit).to.equal(350000);
  });

  it('allows fetching wallet balance when any authenticated user token is provided', async () => {
    User.findByPk = async (id) => {
      return {
        id: 123,
        role: 'merchant',
        status: 'active',
        permissions: [],
        employee_access_role_id: null,
        toJSON() { return this; }
      };
    };

    vimoController.getWalletBalance = (req, res) => {
      res.json({
        success: true,
        message: 'Wallet detail fetched successfully',
        merchantRefId: 'APV0000030664',
        data: {
          availableBalance: 60397.35
        }
      });
    };

    // Re-require to bind the overridden getWalletBalance handler
    delete require.cache[require.resolve('../routes/vimoRoutes')];
    const freshVimoRoutes = require('../routes/vimoRoutes');
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use('/api/vimo', freshVimoRoutes);

    const res = await request(freshApp)
      .get('/api/vimo/balance')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.availableBalance).to.equal(60397.35);
  });
});
