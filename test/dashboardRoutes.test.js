'use strict';

const { expect } = require('chai');
const request    = require('supertest');
const express    = require('express');
const jwt        = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const dashboardRoutes = require('../routes/dashboardRoutes');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const RazorpayNotification = require('../models/RazorpayNotification');
const WalletTransaction = require('../models/WalletTransaction');

const app = express();
app.use(express.json());
app.use('/api/dashboard', dashboardRoutes);

const makeToken = (id, role) =>
  jwt.sign({ user: { id, role, name: `${role} user` } }, process.env.ACCESS_TOKEN_SECRET);

const adminToken = makeToken(1, 'admin');
const merchantToken = makeToken(2, 'merchant');

describe('GET /api/dashboard', () => {
  let origPosMachineCount, origUserCount, origRazorpayCount, origRazorpaySum, origWalletSum, origPosMachineFindAll;

  beforeEach(() => {
    origPosMachineCount = PosMachine.count;
    origUserCount = User.count;
    origRazorpayCount = RazorpayNotification.count;
    origRazorpaySum = RazorpayNotification.sum;
    origWalletSum = WalletTransaction.sum;
    origPosMachineFindAll = PosMachine.findAll;
  });

  afterEach(() => {
    PosMachine.count = origPosMachineCount;
    User.count = origUserCount;
    RazorpayNotification.count = origRazorpayCount;
    RazorpayNotification.sum = origRazorpaySum;
    WalletTransaction.sum = origWalletSum;
    PosMachine.findAll = origPosMachineFindAll;
  });

  it('should return admin dashboard with razorpay totals', async () => {
    PosMachine.count = async ({ where }) => where.status === 'in_active' ? 2 : 11;
    User.count = async ({ where }) => where.role === 'merchant' ? 50 : 5;

    RazorpayNotification.count = async () => 120;
    RazorpayNotification.sum = async ({ where }) => {
      if (!where.status) return 150000;
      const statusIn = where.status[require('sequelize').Op.in];
      if (statusIn.includes('CAPTURED')) return 140000;
      if (statusIn.includes('FAILED')) return 10000;
      return 0;
    };

    WalletTransaction.sum = async () => 25000;

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('data');
    expect(res.body.data.pos_machines).to.deep.equal({ active: 11, inactive: 2 });
    expect(res.body.data.merchants).to.deep.equal({ count: 50 });
    expect(res.body.data.franchaises).to.deep.equal({ count: 5 });
    expect(res.body.data.pos_transactions).to.include({ total: 150000, success: 140000, fail: 10000 });
    expect(res.body.data.today_total_payout).to.equal(25000);
  });

  it('merchant should aggregate by own user_id and linked mids', async () => {
    PosMachine.findAll = async () => [{ mid_number: 'MID123' }];
    RazorpayNotification.count = async () => 5;
    RazorpayNotification.sum = async ({ where }) => {
      const status = where.status;
      if (!status) return 1200;
      const statusIn = status[require('sequelize').Op.in];
      if (statusIn.includes('CAPTURED')) return 1100;
      if (statusIn.includes('FAILED')) return 100;
      return 0;
    };
    WalletTransaction.sum = async () => 800;

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data.pos_transactions).to.include({ total: 1200, success: 1100, fail: 100 });
    expect(res.body.data.today_total_payout).to.equal(800);
  });
});
