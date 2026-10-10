const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');

const CcBillPayment = require('../models/CcBillPayment');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const ledgerService = require('../services/ledgerService');
const { resolvePendingCcBillPayment } = require('../cron/resolvePendingCcBillPayment');

describe('cron/resolvePendingCcBillPayment', () => {
  let findAllStub;
  let userFindByPkStub;
  let ledgerFindOneStub;
  let ledgerCreateStub;
  let axiosPostStub;

  beforeEach(() => {
    findAllStub = sinon.stub(CcBillPayment, 'findAll');
    userFindByPkStub = sinon.stub(User, 'findByPk');
    ledgerFindOneStub = sinon.stub(Ledger, 'findOne');
    ledgerCreateStub = sinon.stub(ledgerService, 'createLedgerEntry');
    axiosPostStub = sinon.stub(axios, 'post');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('creates a refund ledger entry when pending payment resolves to FAILED', async () => {
    const pendingRow = {
      id: 1,
      external_ref: 'EXT123',
      user_id: 9,
      transaction_amount: '100.00',
      createdAt: new Date().toISOString(),
      status: 'pending',
      statuscode: 'TUP',
      update: sinon.stub().resolvesThis(),
    };

    findAllStub.resolves([pendingRow]);
    userFindByPkStub.resolves({ ipay_outlet_id: 456 });
    ledgerFindOneStub.resolves(null);
    ledgerCreateStub.resolves({ id: 101 });
    axiosPostStub.resolves({ data: { transactionStatusCode: 'FAILED', status: 'FAILED' } });

    await resolvePendingCcBillPayment();

    expect(axiosPostStub.calledOnce).to.be.true;
    expect(ledgerCreateStub.calledOnce).to.be.true;
    expect(ledgerCreateStub.firstCall.args[0]).to.include({
      userId: 9,
      transactionType: 'bbps_payment_reversal',
      referenceId: 1,
      referenceTable: 'CcBillPayments',
      description: 'Reversed — BBPS CC payment failed (FAILED) — Principal: ₹100.00',
      credit: 100,
    });
    expect(pendingRow.update.calledOnce).to.be.true;
    expect(pendingRow.update.firstCall.args[0]).to.include({
      statuscode: 'FAILED',
      status: 'FAILED',
    });
  });

  it('preserves pending status and does not refund on invalid outlet response', async () => {
    const pendingRow = {
      id: 2,
      external_ref: 'EXT999',
      user_id: 9,
      transaction_amount: '150.00',
      createdAt: new Date().toISOString(),
      status: 'pending',
      statuscode: 'TUP',
      update: sinon.stub().resolvesThis(),
    };

    findAllStub.resolves([pendingRow]);
    userFindByPkStub.resolves({ ipay_outlet_id: 123 });
    ledgerFindOneStub.resolves(null);
    ledgerCreateStub.resolves({ id: 202 });
    axiosPostStub.resolves({ data: { transactionStatusCode: 'OUI', status: 'OUTLET_INVALID' } });

    await resolvePendingCcBillPayment();

    expect(axiosPostStub.calledOnce).to.be.true;
    expect(ledgerCreateStub.notCalled).to.be.true;
    expect(pendingRow.update.calledOnce).to.be.true;
    expect(pendingRow.update.firstCall.args[0]).to.include({
      statuscode: 'TUP',
      status: 'pending',
    });
  });
});
