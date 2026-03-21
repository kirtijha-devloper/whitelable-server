'use strict';

const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const Tpin = require('../models/Tpin');
const ChargeSlab = require('../models/ChargeSlab');
const bcrypt = require('bcrypt');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const merchantRoutes = require('../routes/merchantRoutes');
const branchxRoutes = require('../routes/payments/branchxRoutes');
const User = require('../models/User');

const app = express();
app.use(express.json());
app.use('/api/merchant', merchantRoutes);
app.use('/api/payment/v2', branchxRoutes);

const makeToken = (id, role) =>
  jwt.sign({ user: { id, role, name: `${role} user` } }, process.env.ACCESS_TOKEN_SECRET);

const adminToken = makeToken(1, 'admin');
const merchantToken = makeToken(2, 'merchant');

describe('Payout enable/disable + branchx payout access', () => {
  let origUserFindByPk;
  let origTpinFindOne;
  let origBcryptCompare;
  let origChargeSlabFindOne;

  beforeEach(() => {
    origUserFindByPk = User.findByPk;
    origTpinFindOne = Tpin.findOne;
    origBcryptCompare = bcrypt.compare;
    origChargeSlabFindOne = ChargeSlab.findOne;

    // default stub for tpin and bcrypt so route reaches wallet checks
    Tpin.findOne = async () => ({ expires_at: new Date(Date.now() + 60000), tpin: '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    bcrypt.compare = async () => true;
    ChargeSlab.findOne = async () => null;
  });

  afterEach(() => {
    User.findByPk = origUserFindByPk;
    Tpin.findOne = origTpinFindOne;
    bcrypt.compare = origBcryptCompare;
    ChargeSlab.findOne = origChargeSlabFindOne;
  });

  it('disables payout via merchant status update', async () => {
    const fakeUser = { id: 2, status: 'active', is_payout_enabled: true, save: async function () { this.is_payout_enabled = false; } };
    User.findByPk = async () => fakeUser;

    const res = await request(app)
      .put('/api/merchant/2/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_payout_enabled: false });

    expect(res.status).to.equal(200);
    expect(res.body.is_payout_enabled).to.be.false;
  });

  it('blocks branchx payout when user payout is disabled', async () => {
    User.findByPk = async () => ({ id: 2, is_payout_enabled: false, wallet: 1000, save: async function () {} });

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 2, amount: 100, tpin: '1234', beneficiary_id: 1 });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.equal('Payout service is disabled for this user');
  });

  it('blocks branchx payout when insufficient wallet balance', async () => {
    User.findByPk = async () => ({ id: 2, is_payout_enabled: true, wallet: 50, save: async function () {} });

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 2, amount: 100, tpin: '1234', beneficiary_id: 1 });

    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal('Insufficient wallet balance');
  });
});
