const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const branchxRoutes = require('../routes/payments/branchxRoutes');
const branchxService = require('../services/payments/branchxService');
const User = require('../models/User');
const Beneficiary = require('../models/Beneficiary');
const Tpin = require('../models/Tpin');
const ServiceFee = require('../models/ServiceFee');
const PayoutCharge = require('../models/PayoutCharge');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const Ledger = require('../models/Ledger');
const bcrypt = require('bcrypt');
const ledgerService = require('../services/ledgerService');

// setup mini app
const app = express();
app.use(express.json());
app.use('/api/payment/v2', branchxRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
     .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const merchantToken = jwt.sign({ user: { id: 9, role: 'merchant' } }, SECRET);

let stubs;
let userFindByPkOrig;
let beneficiaryFindByPkOrig;
let tpinFindOneOrig;
let bcryptCompareOrig;

beforeEach(() => {
  stubs = {
    branchx: { bankValidation: branchxService.bankValidation, payout: branchxService.payout },
    userFindByPk: User.findByPk,
    beneficiaryFindByPk: Beneficiary.findByPk,
    tpinFindOne: Tpin.findOne,
    bcryptCompare: bcrypt.compare,
    serviceFeeFindOne: ServiceFee.findOne,
    payoutChargeFindOne: PayoutCharge.findOne,
    payoutTransactionCreate: PayoutTransaction.create,
    ledgerEntry: ledgerService.createLedgerEntry,
    payoutEntry: ledgerService.createPayoutEntry,
    availableBalance: ledgerService.getAvailableBalance
  };

  userFindByPkOrig = User.findByPk;
  beneficiaryFindByPkOrig = Beneficiary.findByPk;
  tpinFindOneOrig = Tpin.findOne;
  bcryptCompareOrig = bcrypt.compare;

  User.findByPk = async (id) => ({ id, is_payout_enabled: true, wallet: 100000, role: 'merchant', name: 'TestMerchant' });
  Beneficiary.findByPk = async (id) => ({ id, mobile_number: '9999999999', account_number: '1234567890', ifsc_code: 'IFSC0001', beneficiary_name: 'Test', bank_name: 'Test Bank', status: 'active' });
  Tpin.findOne = async () => ({ user_id: 9, tpin: '$2b$10$saltsaltsaltsalt0000000000000000000000', expires_at: new Date(Date.now() + 3600000).toISOString() });
  bcrypt.compare = async () => true;
  ledgerService.getAvailableBalance = async () => 100000;
  PayoutTransaction.create = async (payload) => ({ id: 1, ...payload });
});
afterEach(() => {
  branchxService.bankValidation = stubs.branchx.bankValidation;
  branchxService.payout = stubs.branchx.payout;
  User.findByPk = stubs.userFindByPk;
  Beneficiary.findByPk = stubs.beneficiaryFindByPk;
  Tpin.findOne = stubs.tpinFindOne;
  bcrypt.compare = stubs.bcryptCompare;
  ServiceFee.findOne = stubs.serviceFeeFindOne;
  PayoutCharge.findOne = stubs.payoutChargeFindOne;
  PayoutTransaction.create = stubs.payoutTransactionCreate;
  ledgerService.createLedgerEntry = stubs.ledgerEntry;
  ledgerService.createPayoutEntry = stubs.payoutEntry;
  ledgerService.getAvailableBalance = stubs.availableBalance;
});

describe('POST /api/payment/v2/bank/validation', () => {
  it('returns 400 when params missing', async () => {
    const res = await request(app)
      .post('/api/payment/v2/bank/validation')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({});
    expect(res.status).to.equal(400);
  });

  it('passes through BranchX failure', async () => {
    branchxService.bankValidation = async () => ({ status: 'FAILED', message: 'oops', statuscode: 402 });
    const res = await request(app)
      .post('/api/payment/v2/bank/validation')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ accountNumber: '123', ifscCode: 'IFSC' });
    expect(res.status).to.equal(402);
    expect(res.body.success).to.be.false;
  });

  it('deducts fee when validation succeeds and fee configured', async () => {
    branchxService.bankValidation = async () => ({ status: 'SUCCESS', message: 'ok', utr: 'U1' });
    ServiceFee.findOne = async () => ({ flat_fee: '5.00', percent_fee: '0', is_active: true });
    let ledgerArgs = null;
    ledgerService.createLedgerEntry = async (args) => { ledgerArgs = args; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/bank/validation')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ accountNumber: '123', ifscCode: 'IFSC' });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(ledgerArgs).to.not.be.null;
    expect(ledgerArgs.userId).to.equal(9);
    expect(ledgerArgs.debit).to.equal(5);
    expect(ledgerArgs.transactionType).to.equal('service_fee');
  });

  it('skips ledger if no fee record', async () => {
    branchxService.bankValidation = async () => ({ status: 'SUCCESS', message: 'ok' });
    ServiceFee.findOne = async () => null;
    let called = false;
    ledgerService.createLedgerEntry = async () => { called = true; };
    const res = await request(app)
      .post('/api/payment/v2/bank/validation')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ accountNumber: '123', ifscCode: 'IFSC' });
    expect(res.status).to.equal(200);
    expect(called).to.be.false;
  });
});

describe('BranchX webhook callback', () => {
  let origPayoutFindOne;
  let origPayoutFindByPk;
  let origLedgerFindOne;
  let origPayoutAuditCreate;
  let origLedgerEntry;

  beforeEach(() => {
    origPayoutFindOne = PayoutTransaction.findOne;
    origPayoutFindByPk = PayoutTransaction.findByPk;
    origLedgerFindOne = Ledger.findOne;
    origPayoutAuditCreate = PayoutAuditLog.create;
    origLedgerEntry = ledgerService.createLedgerEntry;
  });

  afterEach(() => {
    PayoutTransaction.findOne = origPayoutFindOne;
    PayoutTransaction.findByPk = origPayoutFindByPk;
    Ledger.findOne = origLedgerFindOne;
    PayoutAuditLog.create = origPayoutAuditCreate;
    ledgerService.createLedgerEntry = origLedgerEntry;
  });

  it('updates payout transaction and refunds wallet when callback status is FAILED', async () => {
    const payoutTx = {
      id: 1,
      merchant_id: 9,
      amount: 49000.0,
      service_charge: 0,
      reference_id: 'AP0000013224',
      status: 'PENDING',
      data: JSON.stringify({ initial: 'x' }),
      update: async function(fields) { Object.assign(this, fields); return this; }
    };

    const user = {
      id: 9,
      wallet: 100,
      save: async function() { return this; }
    };

    PayoutTransaction.findOne = async () => payoutTx;
    PayoutTransaction.findByPk = async () => payoutTx;
    Ledger.findOne = async () => null;
    PayoutAuditLog.create = async () => ({});
    ledgerService.createLedgerEntry = async (args) => {
      user.wallet += parseFloat(args.credit || 0);
      return { id: 77 };
    };

    const res = await request(app)
      .post('/api/payment/v2/payout/callback')
      .send({
        status: 'FAILED',
        message: 'Transaction Failed',
        requestId: 'AP0000013224',
        amount: '49000.0'
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(payoutTx.status).to.equal('FAILED');
    expect(payoutTx.callback_status).to.equal('FAILED');
    expect(user.wallet).to.equal(49100); // 100 + 49000 refund
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PAYOUT CHARGES
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/payment/v2/payout', () => {
  beforeEach(() => {
    // stub payout service to avoid real HTTP call
    branchxService.payout = async () => ({ status: 'SUCCESS', api_ref: 'R1' });
    User.findByPk = async () => ({ id: 9, is_payout_enabled: true, wallet: 1000, name: 'Merchant Test' });
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
    Tpin.findOne = async () => ({
      expires_at: new Date(Date.now() + 60000),
      tpin: '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
    bcrypt.compare = async () => true;
    PayoutTransaction.create = async (payload) => ({ id: 1, ...payload });
    ledgerService.getAvailableBalance = async () => 1000;
  });

  it('requires amount and beneficiary', async () => {
    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({});
    expect(res.status).to.equal(400);
  });

  it('uses provided service_charge when present', async () => {
    let ledgerArgs;
    ledgerService.createPayoutEntry = async (args) => { ledgerArgs = args; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 9, beneficiary_id: 1, amount: 100, service_charge: 7, requestId: 'APTEST0001', tpin: '0000' });

    expect(res.status).to.not.equal(400);
    expect(ledgerArgs.amount).to.equal(107);
  });

  it('calculates service_charge from payout rules when none provided', async () => {
    let ledgerArgs;
    // slab returns 10 flat fee for amount range
    PayoutCharge.findOne = async () => ({ rate_type: 'flat', rate: '10.00', is_active: true });
    ledgerService.createPayoutEntry = async (args) => { ledgerArgs = args; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 9, beneficiary_id: 1, amount: 200, requestId: 'APTEST0002', tpin: '0000' });

    expect(res.status).to.not.equal(400);
    expect(ledgerArgs.amount).to.equal(210);
  });
});
