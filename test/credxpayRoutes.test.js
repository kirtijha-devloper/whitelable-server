const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

// import our new routers
const payoutRoutes = require('../routes/credxpay/payout');
const beneficiaryRoutes = require('../routes/credxpay/beneficiary');
const webhookRoutes = require('../routes/credxpay/webhook');
const credxpayService = require('../services/credxpayService');
const ServiceChargeSlab = require('../models/ServiceChargeSlab');
const User = require('../models/User');
const ledgerService = require('../services/ledgerService');

const app = express();
app.use(express.json());
app.use('/payout/credxpay', payoutRoutes);
app.use('/payout/credxpay/beneficiaries', beneficiaryRoutes);
app.use('/payout/credxpay/callback', webhookRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
     .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const token = jwt.sign({ user: { id: 1, role: 'merchant' } }, SECRET);

let stubs;
beforeEach(() => {
  stubs = {
    slab: ServiceChargeSlab.findOne,
    payoutEntry: ledgerService.createPayoutEntry,
    user: User.findByPk,
    beneficiary: null,
    payoutCreate: null,
    credx: credxpayService.initiateTransaction,
    auditCreate: null
  };
  // default user stub returns a wallet with enough balance
  User.findByPk = async () => ({
    id: 1,
    wallet: 1000,
    save: async () => {}
  });
  // default beneficiary stub
  const PayoutBeneficiary = require('../models/PayoutBeneficiary');
  stubs.beneficiary = PayoutBeneficiary.findByPk;
  PayoutBeneficiary.findByPk = async () => ({
    id: 1,
    name: 'Test Benef',
    account_number: '123',
    ifsc_code: 'IFSC',
    bank_name: 'Test Bank',
    mobile: '9999999999',
    email: 'a@b.com',
    is_verified: true
  });
  // stub PayoutRequest create so we don't need DB
  const PayoutRequest = require('../models/PayoutRequest');
  stubs.payoutCreate = PayoutRequest.create;
  PayoutRequest.create = async (args) => ({ id: 42, ...args });
  // stub PayoutAuditLog so tests don't hit missing table
  const PayoutAuditLog = require('../models/PayoutAuditLog');
  stubs.auditCreate = PayoutAuditLog.create;
  PayoutAuditLog.create = async () => ({});
  // stub ledger payout entry to avoid DB
  ledgerService.createPayoutEntry = async (args) => {
    stubs.ledgerArgs = args;
    return {};
  };
  // stub credxpay API call
  credxpayService.initiateTransaction = async () => ({ status: 'OK' });
});
afterEach(() => {
  ServiceChargeSlab.findOne = stubs.slab;
  ledgerService.createPayoutEntry = stubs.payoutEntry;
  User.findByPk = stubs.user;
  const PayoutBeneficiary = require('../models/PayoutBeneficiary');
  PayoutBeneficiary.findByPk = stubs.beneficiary;
  const PayoutRequest = require('../models/PayoutRequest');
  PayoutRequest.create = stubs.payoutCreate;
  const PayoutAuditLog = require('../models/PayoutAuditLog');
  PayoutAuditLog.create = stubs.auditCreate;
  credxpayService.initiateTransaction = stubs.credx;
});
afterEach(() => {
  ServiceChargeSlab.findOne = stubs.slab;
  ledgerService.createLedgerEntry = stubs.ledger;
  User.findByPk = stubs.user;
});

describe('POST /payout/credxpay', () => {
  it('requires amount and tpin', async () => {
    const res = await request(app)
      .post('/payout/credxpay')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    // missing user_id triggers 401 unauthorized
    expect(res.status).to.equal(401);
  });

  it('calculates charge from slab', async () => {
    ServiceChargeSlab.findOne = async () => ({ service_charge: '5.00' });
  credxpayService.initiateTransaction = async () => ({ status: 'OK' });
    // ledger stub is set in beforeEach; extra variable not needed
    // stub tpin check by inserting fake record or bypass? to simplify, we can stub Tpin but route will query DB for Tpin and user; easier to bypass check by providing a matching hashed tpin in DB, but we don't have DB in test. Instead we can stub Tpin.findOne.
    const Tpin = require('../models/Tpin');
    stubs.tpin = Tpin.findOne;
    Tpin.findOne = async () => ({ tpIN: 'hash', expires_at: new Date(Date.now()+10000), tpIN: '', tpIN2: '', tpIN3: '' });
    // stub sequence lookup
    const RefSequence = require('../models/RefSequence');
    stubs.seq = RefSequence.findOne;
    RefSequence.findOne = async () => ({
      service: 'payout',
      current_number: 1,
      save: async function () { this.current_number += 1; }
    });
    // we also need bcrypt.compare stub to always return true
    const bcrypt = require('bcrypt');
    stubs.bcryptCompare = bcrypt.compare;
    bcrypt.compare = async () => true;

    const res = await request(app)
      .post('/payout/credxpay')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id:1, beneficiary_id:1, amount: 100, tpin: '0000' });

    expect(res.status).to.equal(200);
    expect(stubs.ledgerArgs).to.not.be.undefined;
    expect(stubs.ledgerArgs.amount).to.equal(105);

    // restore bcrypt, Tpin and sequence stubs
    bcrypt.compare = stubs.bcryptCompare;
    Tpin.findOne = stubs.tpin;
    RefSequence.findOne = stubs.seq;
  });
});
