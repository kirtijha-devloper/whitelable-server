'use strict';

const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const Tpin = require('../models/Tpin');
const Beneficiary = require('../models/Beneficiary');
const ChargeSlab = require('../models/ChargeSlab');
const bcrypt = require('bcrypt');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const merchantRoutes = require('../routes/merchantRoutes');
const branchxRoutes = require('../routes/payments/branchxRoutes');
const User = require('../models/User');
const ledgerService = require('../services/ledgerService');

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
  let origBeneficiaryFindByPk;
  let origTpinFindOne;
  let origBcryptCompare;
  let origChargeSlabFindOne;
  let origAvailableBalance;

  beforeEach(() => {
    origUserFindByPk = User.findByPk;
    origBeneficiaryFindByPk = Beneficiary.findByPk;
    origTpinFindOne = Tpin.findOne;
    origBcryptCompare = bcrypt.compare;
    origChargeSlabFindOne = ChargeSlab.findOne;
    origAvailableBalance = ledgerService.getAvailableBalance;

    // default stub for tpin and bcrypt so route reaches wallet checks
    Tpin.findOne = async () => ({ expires_at: new Date(Date.now() + 60000), tpin: '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    Beneficiary.findByPk = async () => ({
      id: 1,
      status: 'active',
      mobile_number: '9999999999',
      account_number: '1234567890',
      ifsc_code: 'TEST0001234',
      beneficiary_name: 'Test Beneficiary',
      bank_name: 'Test Bank',
      email: 'test@example.com',
    });
    bcrypt.compare = async () => true;
    ChargeSlab.findOne = async () => null;
    ledgerService.getAvailableBalance = async () => 1000;
  });

  afterEach(() => {
    User.findByPk = origUserFindByPk;
    Beneficiary.findByPk = origBeneficiaryFindByPk;
    Tpin.findOne = origTpinFindOne;
    bcrypt.compare = origBcryptCompare;
    ChargeSlab.findOne = origChargeSlabFindOne;
    ledgerService.getAvailableBalance = origAvailableBalance;
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
    ledgerService.getAvailableBalance = async () => 50;

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 2, amount: 100, tpin: '1234', beneficiary_id: 1 });

    expect(res.status).to.equal(400);
    expect(res.body.message).to.equal('Insufficient wallet balance');
  });
});
