const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const sinon = require('sinon');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const db = require('../config/database');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutAuditLog = require('../models/PayoutAuditLog');
const Ledger = require('../models/Ledger');
const payoutRoutes = require('../routes/payoutRoutes');
const ndia5Service = require('../services/ndia5Payout.service');
const ledgerService = require('../services/ledgerService');

const app = express();
app.use(express.json());
app.use('/api/payout', payoutRoutes);
app.use((err, req, res, _next) => {
  res.status(500).json({ success: false, message: err.message });
});

describe('NDIA5 Auto-Refund Callback Tests', () => {
  let transactionStub;
  let findOneTxStub;
  let findByPkTxStub;
  let findOneLedgerStub;
  let createLedgerEntryStub;
  let createAuditLogStub;

  beforeEach(() => {
    // Mock db.transaction
    transactionStub = sinon.stub(db, 'transaction').resolves({
      commit: sinon.stub().resolves(),
      rollback: sinon.stub().resolves(),
      LOCK: { UPDATE: 'UPDATE' }
    });

    // Mock PayoutTransaction.findOne
    findOneTxStub = sinon.stub(PayoutTransaction, 'findOne');
    // Mock PayoutTransaction.findByPk
    findByPkTxStub = sinon.stub(PayoutTransaction, 'findByPk');
    // Mock Ledger.findOne
    findOneLedgerStub = sinon.stub(Ledger, 'findOne');
    // Mock ledgerService.createLedgerEntry
    createLedgerEntryStub = sinon.stub(ledgerService, 'createLedgerEntry');
    // Mock PayoutAuditLog.create
    createAuditLogStub = sinon.stub(PayoutAuditLog, 'create');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should process auto-refund on FAILED callback status when pending', async () => {
    const mockTxInstance = {
      id: 501,
      reference_id: 'REF_FAILED_CB',
      amount: 25000,
      service_charge: 20,
      merchant_id: 99,
      payout_provider: 'Ndia5',
      status: 'PENDING',
      data: JSON.stringify({}),
      save: sinon.stub().resolves()
    };

    findOneTxStub.resolves(mockTxInstance);
    findByPkTxStub.resolves(mockTxInstance);
    findOneLedgerStub.resolves(null); // No prior refund
    createLedgerEntryStub.resolves({ id: 888 });
    createAuditLogStub.resolves();

    const res = await request(app)
      .post('/api/payout/ndia5/callback')
      .send({
        merchant_reference_id: 'REF_FAILED_CB',
        status: 'FAILED',
        transaction_id: 'TXN1001'
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.status).to.equal('FAILED');
    expect(res.body.autoRefunded).to.equal(true);

    // Verify transaction status was updated
    expect(mockTxInstance.status).to.equal('FAILED');
    
    // Verify ledger entry parameters
    expect(createLedgerEntryStub.calledOnce).to.be.true;
    const ledgerArgs = createLedgerEntryStub.firstCall.args[0];
    expect(ledgerArgs.userId).to.equal(99);
    expect(ledgerArgs.transactionType).to.equal('payout_refund');
    expect(ledgerArgs.credit).to.equal(25020); // 25000 + 20

    // Verify Audit log was created
    expect(createAuditLogStub.calledOnce).to.be.true;
    expect(createAuditLogStub.firstCall.args[0].action).to.equal('NDIA5_CALLBACK_AUTO_REFUND');
  });

  it('should only update status to SUCCESS on SUCCESS callback without refund', async () => {
    const mockTxInstance = {
      id: 502,
      reference_id: 'REF_SUCCESS_CB',
      amount: 10000,
      service_charge: 10,
      merchant_id: 99,
      payout_provider: 'Ndia5',
      status: 'PENDING',
      data: JSON.stringify({}),
      save: sinon.stub().resolves()
    };

    findOneTxStub.resolves(mockTxInstance);
    findByPkTxStub.resolves(mockTxInstance);
    createAuditLogStub.resolves();

    const res = await request(app)
      .post('/api/payout/ndia5/callback')
      .send({
        merchant_reference_id: 'REF_SUCCESS_CB',
        status: 'SUCCESS',
        transaction_id: 'TXN1002'
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.status).to.equal('SUCCESS');
    expect(res.body.autoRefunded).to.equal(false);

    expect(mockTxInstance.status).to.equal('SUCCESS');
    expect(createLedgerEntryStub.called).to.be.false;
    expect(createAuditLogStub.calledOnce).to.be.true;
    expect(createAuditLogStub.firstCall.args[0].action).to.equal('NDIA5_CALLBACK_STATUS_UPDATE');
  });

  it('should ignore callback if transaction is already FAILED', async () => {
    const mockTxInstance = {
      id: 503,
      reference_id: 'REF_ALREADY_FAIL',
      amount: 10000,
      service_charge: 10,
      merchant_id: 99,
      payout_provider: 'Ndia5',
      status: 'FAILED',
      data: JSON.stringify({ autoRefundProcessed: true }),
      save: sinon.stub().resolves()
    };

    findOneTxStub.resolves(mockTxInstance);
    findByPkTxStub.resolves(mockTxInstance);

    const res = await request(app)
      .post('/api/payout/ndia5/callback')
      .send({
        merchant_reference_id: 'REF_ALREADY_FAIL',
        status: 'FAILED',
        transaction_id: 'TXN1003'
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.message).to.equal('Transaction already finalized');
    expect(createLedgerEntryStub.called).to.be.false;
  });
});
