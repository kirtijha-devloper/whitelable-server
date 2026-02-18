const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

// route under test
const commissionRoutes = require('../routes/commissionRoutes');

// models (we'll stub specific model methods during tests)
const CommissionDefault = require('../models/CommissionDefault');
const UserCommission = require('../models/UserCommission');
const User = require('../models/User');

const app = express();
app.use(express.json());
app.use('/api/commission', commissionRoutes);

const adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin' } }, process.env.ACCESS_TOKEN_SECRET);
const userToken = jwt.sign({ user: { id: 2, role: 'merchant', name: 'Merchant' } }, process.env.ACCESS_TOKEN_SECRET);

describe('commissionRoutes (integration - controller + routes)', () => {
  let origCommissionFindAll, origCommissionCreate, origCommissionFindByPk;
  let origUserCommissionFindAll, origUserCommissionCreate;
  let origUserFindByPk;

  beforeEach(() => {
    // backup
    origCommissionFindAll = CommissionDefault.findAll;
    origCommissionCreate = CommissionDefault.create;
    origCommissionFindByPk = CommissionDefault.findByPk;

    origUserCommissionFindAll = UserCommission.findAll;
    origUserCommissionCreate = UserCommission.create;

    origUserFindByPk = User.findByPk;
  });

  afterEach(() => {
    // restore
    CommissionDefault.findAll = origCommissionFindAll;
    CommissionDefault.create = origCommissionCreate;
    CommissionDefault.findByPk = origCommissionFindByPk;

    UserCommission.findAll = origUserCommissionFindAll;
    UserCommission.create = origUserCommissionCreate;

    User.findByPk = origUserFindByPk;
  });

  it('POST /api/commission/default - rejects when both flat & percent provided', async () => {
    const res = await request(app)
      .post('/api/commission/default')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD', min_amount: 0, max_amount: 100, flat_fee: 2, percent_fee: 0.5 });

    expect(res.status).to.equal(400);
  });

  it('POST /api/commission/default - creates slab (admin)', async () => {
    CommissionDefault.findAll = async () => [];
    CommissionDefault.create = async (data) => ({ id: 101, ...data });

    const res = await request(app)
      .post('/api/commission/default')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD', min_amount: 0, max_amount: 100, flat_fee: 2, percent_fee: 0 });

    expect(res.status).to.equal(201);
    expect(res.body.record).to.exist;
    expect(res.body.record.id).to.equal(101);
  });

  it('POST /api/commission/calculate - prefers user-linked commission when present', async () => {
    // stub user link that includes defaultCommission
    UserCommission.findAll = async () => [
      { defaultCommission: { payment_card_brand: 'RUPAY', payment_card_type: 'CREDIT', payment_mode: 'CARD', percent_fee: 1.0, flat_fee: 0, min_amount: 0, max_amount: 99999, is_active: true } }
    ];

    const res = await request(app)
      .post('/api/commission/calculate')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ user_id: 2, paymentCardBrand: 'RUPAY', paymentCardType: 'CREDIT', paymentMode: 'CARD', amount: 200 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('user');
    expect(res.body.fee).to.exist;
  });

  it('POST /api/commission/calculate - falls back to default when no user link', async () => {
    UserCommission.findAll = async () => [];
    CommissionDefault.findAll = async () => [
      { payment_card_brand: null, payment_card_type: null, payment_mode: 'CARD', percent_fee: 0.5, flat_fee: 0, min_amount: 0, max_amount: 100000, is_active: true }
    ];

    const res = await request(app)
      .post('/api/commission/calculate')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ paymentCardBrand: 'VISA', paymentCardType: 'DEBIT', paymentMode: 'CARD', amount: 1000 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('default');
    expect(res.body.fee).to.exist;
  });
});
