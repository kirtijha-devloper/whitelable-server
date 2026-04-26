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
const adminToken = jwt.sign({ user: { id: 1, role: 'admin' } }, SECRET);

let stubs;
let userFindByPkOrig;
let beneficiaryFindByPkOrig;
let tpinFindOneOrig;
let bcryptCompareOrig;
let payoutFindByPkOrig;
let payoutAuditCreateOrig;
let payoutAuditFindAllOrig;

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
    payoutFindByPk: PayoutTransaction.findByPk,
    payoutAuditCreate: PayoutAuditLog.create,
    payoutAuditFindAll: PayoutAuditLog.findAll,
    ledgerEntry: ledgerService.createLedgerEntry,
    payoutEntry: ledgerService.createPayoutEntry,
    availableBalance: ledgerService.getAvailableBalance
  };

  userFindByPkOrig = User.findByPk;
  beneficiaryFindByPkOrig = Beneficiary.findByPk;
  tpinFindOneOrig = Tpin.findOne;
  bcryptCompareOrig = bcrypt.compare;
  payoutFindByPkOrig = PayoutTransaction.findByPk;
  payoutAuditCreateOrig = PayoutAuditLog.create;
  payoutAuditFindAllOrig = PayoutAuditLog.findAll;

  User.findByPk = async (id) => ({ id, is_payout_enabled: true, wallet: 100000, role: 'merchant', name: 'TestMerchant' });
  Beneficiary.findByPk = async (id) => ({ id, mobile_number: '9999999999', account_number: '1234567890', ifsc_code: 'IFSC0001', beneficiary_name: 'Test', bank_name: 'Test Bank', status: 'active' });
  Tpin.findOne = async () => ({ user_id: 9, tpin: '$2b$10$saltsaltsaltsalt0000000000000000000000', expires_at: new Date(Date.now() + 3600000).toISOString() });
  bcrypt.compare = async () => true;
  ledgerService.getAvailableBalance = async () => 100000;
  PayoutTransaction.create = async (payload) => ({ id: 1, ...payload });
  PayoutAuditLog.create = async () => ({});
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
  PayoutTransaction.findByPk = stubs.payoutFindByPk;
  PayoutAuditLog.create = payoutAuditCreateOrig;
  PayoutAuditLog.findAll = payoutAuditFindAllOrig;
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
    expect(res.body.message).to.equal('Callback received successfully');
    expect(res.body.branchxStatusCode).to.equal(null);
    expect(payoutTx.status).to.equal('FAILED');
    expect(payoutTx.callback_status).to.equal('FAILED');
    expect(user.wallet).to.equal(49100); // 100 + 49000 refund
  });

  it('returns 119 Pending for BranchX PENDING callback status', async () => {
    const payoutTx = {
      id: 2,
      merchant_id: 9,
      amount: 1000.0,
      service_charge: 0,
      reference_id: 'AP0000013226',
      status: 'PENDING',
      data: JSON.stringify({ initial: 'x' }),
      update: async function(fields) { Object.assign(this, fields); return this; }
    };

    PayoutTransaction.findOne = async () => payoutTx;
    PayoutTransaction.findByPk = async () => payoutTx;
    Ledger.findOne = async () => null;
    PayoutAuditLog.create = async () => ({});
    ledgerService.createLedgerEntry = async () => ({ id: 100 });

    const res = await request(app)
      .post('/api/payment/v2/payout/callback')
      .send({
        status: 'PENDING',
        message: 'Transaction still in progress',
        requestId: 'AP0000013226',
        amount: '1000.0'
      });

    expect(res.status).to.equal(119);
    expect(res.body.success).to.be.true;
    expect(res.body.message).to.equal('Pending');
    expect(res.body.status).to.equal('PENDING');
    expect(res.body.payoutTransactionFound).to.be.true;
  });

  it('returns the full callback payload and BranchX status code when present', async () => {
    const payoutTx = {
      id: 1,
      merchant_id: 9,
      amount: 1000.0,
      service_charge: 0,
      reference_id: 'AP0000013225',
      status: 'PENDING',
      data: JSON.stringify({ initial: 'x' }),
      update: async function(fields) { Object.assign(this, fields); return this; }
    };

    PayoutTransaction.findOne = async () => payoutTx;
    PayoutTransaction.findByPk = async () => payoutTx;
    Ledger.findOne = async () => null;
    PayoutAuditLog.create = async () => ({});
    ledgerService.createLedgerEntry = async () => ({ id: 99 });

    const callbackPayload = {
      status: 'SUCCESS',
      statuscode: '200',
      message: 'Transaction Completed',
      requestId: 'AP0000013225',
      amount: '1000.0'
    };

    const res = await request(app)
      .post('/api/payment/v2/payout/callback')
      .send(callbackPayload);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.branchxStatusCode).to.equal('200');
    expect(res.body.callbackPayload).to.deep.equal(callbackPayload);
    expect(res.body.payoutTransactionId).to.equal(1);
    expect(res.body.status).to.equal('SUCCESS');
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

  it('blocks duplicate payout within 3 minutes for the same merchant/beneficiary/amount', async () => {
    PayoutTransaction.findOne = async () => ({ id: 99 });

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 9, beneficiary_id: 1, amount: 100, service_charge: 7, requestId: 'APTEST0005', tpin: '0000' });

    expect(res.status).to.equal(409);
    expect(res.body.success).to.be.false;
    expect(res.body.message).to.include('Duplicate payout detected');
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

describe('POST /api/payment/v2/payout/status-check', () => {
  it('admin updates payout from pending to success and logs the check', async () => {
    branchxService.statusCheck = async () => ({
      data: { status: 'SUCCESS', message: 'Txn successful', opRefId: 'OP1', apiTxnId: 'ATX1', mobileNumber: '9999999999', amount: 100 },
      statuscode: '200',
      status: 'SUCCESS',
      message: 'Txn Found'
    });

    let auditArgs = null;
    PayoutAuditLog.create = async (args) => { auditArgs = args; return {}; };
    PayoutTransaction.findByPk = async () => ({
      id: 1,
      merchant_id: 9,
      status: 'PENDING',
      amount: '100',
      service_charge: '10',
      reference_id: 'REQ123',
      update: async function (updates) { Object.assign(this, updates); }
    });
    ledgerService.createLedgerEntry = async () => { throw new Error('No refund expected'); };

    const res = await request(app)
      .post('/api/payment/v2/payout/status-check')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payout_transaction_id: 1 });

    expect(res.status).to.equal(200);
    expect(res.body.action).to.equal('status_updated');
    expect(res.body.status).to.equal('SUCCESS');
    expect(auditArgs).to.not.be.null;
    expect(auditArgs.action).to.equal('BRANCHX_STATUS_CHECK');
  });

  it('admin ignores explicit failed status and does not refund', async () => {
    branchxService.statusCheck = async () => ({
      data: { status: 'FAILED', message: 'failure', opRefId: '-', apiTxnId: 'ATX2', mobileNumber: '9999999999', amount: 100 },
      statuscode: '200',
      status: 'SUCCESS',
      message: 'Txn Found'
    });

    let refundCalled = false;
    PayoutAuditLog.create = async () => ({});
    PayoutTransaction.findByPk = async () => ({
      id: 2,
      merchant_id: 9,
      status: 'PENDING',
      amount: '100',
      service_charge: '10',
      reference_id: 'REQ124',
      update: async function (updates) { Object.assign(this, updates); }
    });
    ledgerService.createLedgerEntry = async () => { refundCalled = true; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/payout/status-check')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payout_transaction_id: 2 });

    expect(res.status).to.equal(200);
    expect(res.body.action).to.equal('admin_failed_ignored');
    expect(refundCalled).to.be.false;
  });

  it('creator updates explicit failed status, refunds once, and logs audit', async () => {
    branchxService.statusCheck = async () => ({
      data: { status: 'FAILED', message: 'failure', opRefId: '-', apiTxnId: 'ATX3', mobileNumber: '9999999999', amount: 100 },
      statuscode: '200',
      status: 'SUCCESS',
      message: 'Txn Found'
    });

    let refundArgs = null;
    let auditArgs = null;
    PayoutAuditLog.create = async (args) => { auditArgs = args; return {}; };
    PayoutTransaction.findByPk = async () => ({
      id: 3,
      merchant_id: 9,
      status: 'PENDING',
      amount: '100',
      service_charge: '10',
      reference_id: 'REQ125',
      update: async function (updates) { Object.assign(this, updates); }
    });
    Ledger.findOne = async () => null;
    ledgerService.createLedgerEntry = async (args) => { refundArgs = args; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/payout/status-check')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ payout_transaction_id: 3 });

    expect(res.status).to.equal(200);
    expect(res.body.action).to.equal('creator_failed_refunded');
    expect(refundArgs).to.not.be.null;
    expect(refundArgs.credit).to.equal(110);
    expect(auditArgs.action).to.equal('BRANCHX_STATUS_CHECK_FAILED');
  });

  it('creator keeps pending on unknown/null branchx response without refund', async () => {
    branchxService.statusCheck = async () => ({
      statuscode: '5000',
      status: 'FAILED',
      message: 'Record not found'
    });

    let refundCalled = false;
    PayoutAuditLog.create = async () => ({});
    PayoutTransaction.findByPk = async () => ({
      id: 4,
      merchant_id: 9,
      status: 'PENDING',
      amount: '100',
      service_charge: '10',
      reference_id: 'REQ126',
      update: async function (updates) { Object.assign(this, updates); }
    });
    ledgerService.createLedgerEntry = async () => { refundCalled = true; return {}; };

    const res = await request(app)
      .post('/api/payment/v2/payout/status-check')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ payout_transaction_id: 4 });

    expect(res.status).to.equal(200);
    expect(res.body.action).to.equal('unknown_status_no_action');
    expect(refundCalled).to.be.false;
  });
});

describe('GET /api/payment/v2/payout/audit-logs', () => {
  it('allows admin to fetch payout audit logs grouped by payout_id', async () => {
    const auditLogs = [
      {
        id: 1,
        payout_id: 123,
        action: 'BRANCHX_STATUS_CHECK',
        details: { requestId: 'REQ-123' },
        created_at: new Date('2026-04-25T10:00:00Z'),
        updated_at: new Date('2026-04-25T10:00:00Z')
      },
      {
        id: 2,
        payout_id: 123,
        action: 'BRANCHX_STATUS_CHECK_FAILED',
        details: { requestId: 'REQ-123' },
        created_at: new Date('2026-04-25T10:05:00Z'),
        updated_at: new Date('2026-04-25T10:05:00Z')
      },
      {
        id: 3,
        payout_id: 456,
        action: 'BRANCHX_STATUS_CHECK',
        details: { requestId: 'REQ-456' },
        created_at: new Date('2026-04-25T11:00:00Z'),
        updated_at: new Date('2026-04-25T11:00:00Z')
      }
    ];

    PayoutAuditLog.findAll = async () => auditLogs;

    const res = await request(app)
      .get('/api/payment/v2/payout/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data).to.be.an('array');
    expect(res.body.data.length).to.equal(2);
    expect(res.body.data[0].payout_id).to.equal(123);
    expect(res.body.data[0].logs[0].request_id).to.equal('REQ-123');
    expect(res.body.data[1].payout_id).to.equal(456);
  });

  it('rejects non-admin users', async () => {
    const res = await request(app)
      .get('/api/payment/v2/payout/audit-logs')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.success).to.be.false;
  });
});
