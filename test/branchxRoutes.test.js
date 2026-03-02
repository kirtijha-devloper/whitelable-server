const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const branchxRoutes = require('../routes/payments/branchxRoutes');
const branchxService = require('../services/payments/branchxService');
const ServiceFee = require('../models/ServiceFee');
const ChargeSlab = require('../models/ChargeSlab');
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
beforeEach(() => {
  stubs = {
    branchx: { bankValidation: branchxService.bankValidation, payout: branchxService.payout },
    serviceFeeFindOne: ServiceFee.findOne,
    slabFindOne: ChargeSlab.findOne,
    ledgerEntry: ledgerService.createLedgerEntry
  };
});
afterEach(() => {
  branchxService.bankValidation = stubs.branchx.bankValidation;
  ServiceFee.findOne = stubs.serviceFeeFindOne;
  ledgerService.createLedgerEntry = stubs.ledgerEntry;
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

// ───────────────────────────────────────────────────────────────────────────
// PAYOUT CHARGES
// ───────────────────────────────────────────────────────────────────────────
describe('POST /api/payment/v2/payout', () => {
  beforeEach(() => {
    // stub payout service to avoid real HTTP call
    branchxService.payout = async () => ({ status: 'SUCCESS', api_ref: 'R1' });
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
    ledgerService.createLedgerEntry = async (args) => { ledgerArgs = args; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 9, beneficiary_id: 1, amount: 100, service_charge: 7, tpin: '0000' });

    expect(res.status).to.not.equal(400);
    expect(ledgerArgs.debit).to.equal(107);
  });

  it('calculates service_charge from slab when none provided', async () => {
    let ledgerArgs;
    // slab returns 10 flat fee for amount range
    ChargeSlab.findOne = async () => ({ flat_fee: '10.00', percent_fee: '0' });
    ledgerService.createLedgerEntry = async (args) => { ledgerArgs = args; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 9, beneficiary_id: 1, amount: 200, tpin: '0000' });

    expect(res.status).to.not.equal(400);
    expect(ledgerArgs.debit).to.equal(210);
  });
});
