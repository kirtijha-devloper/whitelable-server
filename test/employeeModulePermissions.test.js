const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const posMachineRoutes = require('../routes/posMachineRoutes');
const complaintRoutes = require('../routes/complaintRoutes');
const ledgerRoutes = require('../routes/ledgerRoutes');
const adminRoutes = require('../routes/adminRoutes');
const dashboardRoutes = require('../routes/dashboardRoutes');
const PosMachine = require('../models/posMachine');
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const WalletTransaction = require('../models/WalletTransaction');
const db = require('../config/database');
const ledgerService = require('../services/ledgerService');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');

const app = express();
app.use(express.json());
app.use('/api/pos-machine', posMachineRoutes);
app.use('/api/complaint', complaintRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const makeToken = (user) => jwt.sign({ user }, SECRET);
const makeEmployeeToken = (id, name, permissions) => makeToken({
  id,
  role: 'employee',
  name,
  employee_access_role_id: id,
  employee_access_role: {
    id,
    name: `${name} Role`,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-role`,
    status: 'active',
    permissions,
  },
});

const stockPosEmployeeToken = makeEmployeeToken(41, 'Stock Employee', [EMPLOYEE_PERMISSIONS.STOCK_POS_READ]);

const complaintEmployeeToken = makeEmployeeToken(42, 'Complaint Employee', [EMPLOYEE_PERMISSIONS.COMPLAINTS_READ]);

const ledgerEmployeeToken = makeEmployeeToken(43, 'Ledger Employee', [EMPLOYEE_PERMISSIONS.LEDGER_READ]);
const walletEmployeeToken = makeEmployeeToken(44, 'Wallet Employee', [EMPLOYEE_PERMISSIONS.WALLET_CREDIT]);
const walletDebitEmployeeToken = makeEmployeeToken(46, 'Wallet Debit Employee', [EMPLOYEE_PERMISSIONS.WALLET_DEBIT]);
const payoutEmployeeToken = makeEmployeeToken(45, 'Payout Employee', [EMPLOYEE_PERMISSIONS.PAYOUT_READ]);

let stubs = {};

beforeEach(() => {
  stubs = {
    posMachineFindAndCountAll: PosMachine.findAndCountAll,
    userFindByPk: User.findByPk,
    complaintFindAll: Complaint.findAll,
    ledgerGetLedgerEntries: ledgerService.getLedgerEntries,
    ledgerGetLatestBalance: ledgerService.getLatestBalance,
    ledgerGetAvailableBalance: ledgerService.getAvailableBalance,
    dbTransaction: db.transaction,
    ledgerCreate: Ledger.create,
    walletFindAll: WalletTransaction.findAll,
  };
});

afterEach(() => {
  PosMachine.findAndCountAll = stubs.posMachineFindAndCountAll;
  User.findByPk = stubs.userFindByPk;
  Complaint.findAll = stubs.complaintFindAll;
  ledgerService.getLedgerEntries = stubs.ledgerGetLedgerEntries;
  ledgerService.getLatestBalance = stubs.ledgerGetLatestBalance;
  ledgerService.getAvailableBalance = stubs.ledgerGetAvailableBalance;
  db.transaction = stubs.dbTransaction;
  Ledger.create = stubs.ledgerCreate;
  WalletTransaction.findAll = stubs.walletFindAll;
});

describe('Employee access across additional admin modules', () => {
  it('allows an employee with stock.pos.read to load the stock POS list', async () => {
    PosMachine.findAndCountAll = async () => ({
      count: 1,
      rows: [{
        id: 1,
        tid_number: 'TID001',
        mid_number: 'MID001',
        device_serial_number: 'SER001',
        razorpay_id: 'RZP001',
        status: 'active',
        remarks: 'added',
        company_name: 'Acme',
        bank_name: 'Test Bank',
        assigned_to: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
    });

    const res = await request(app)
      .get('/api/pos-machine')
      .set('Authorization', `Bearer ${stockPosEmployeeToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.list).to.have.length(1);
  });

  it('allows an employee with complaints.read to view complaint list as admin', async () => {
    Complaint.findAll = async () => [];

    const res = await request(app)
      .get('/api/complaint')
      .set('Authorization', `Bearer ${complaintEmployeeToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data).to.deep.equal([]);
  });

  it('allows an employee with ledger.read to view another user ledger via admin-style scope', async () => {
    ledgerService.getLedgerEntries = async () => ({
      entries: [{
        id: 11,
        transaction_type: 'admin_credit',
        transaction_id: 'TXN1',
        reference_id: 101,
        reference_table: 'Ledgers',
        description: 'Admin credit',
        balance_before: '100.00',
        debit: '0.00',
        credit: '50.00',
        balance: '150.00',
        status: 'completed',
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
    });
    ledgerService.getLatestBalance = async () => 150;
    ledgerService.getAvailableBalance = async () => 150;
    User.findByPk = async () => ({
      id: 33,
      name: 'Merchant User',
      email: 'merchant@example.com',
      mobile_number: '9999999999',
      abheepay_id: 'APM00033',
      organization_name: 'Merchant Org',
    });

    const res = await request(app)
      .get('/api/ledger/entries?user_id=33')
      .set('Authorization', `Bearer ${ledgerEmployeeToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.user.id).to.equal(33);
    expect(res.body.data).to.have.length(1);
  });

  it('allows an employee with wallet.credit to credit a user wallet through admin routes', async () => {
    db.transaction = async () => ({
      commit: async () => {},
      rollback: async () => {},
    });
    User.findByPk = async () => ({
      id: 51,
      name: 'Wallet Target',
      wallet: 100,
      update: async function (data) {
        Object.assign(this, data);
        return this;
      },
    });
    Ledger.create = async (data) => ({ id: 91, ...data });

    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${walletEmployeeToken}`)
      .send({ user_id: 51, amount: 25, reason: 'Adjustment' });

    expect(res.status).to.equal(201);
    expect(res.body.success).to.equal(true);
  });

  it('rejects wallet debit when the employee only has wallet.credit', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${walletEmployeeToken}`)
      .send({ user_id: 51, amount: 25, reason: 'Adjustment' });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to debit wallet balances/i);
  });

  it('allows an employee with wallet.debit to debit a user wallet through admin routes', async () => {
    db.transaction = async () => ({
      commit: async () => {},
      rollback: async () => {},
    });
    User.findByPk = async () => ({
      id: 51,
      name: 'Wallet Target',
      wallet: 100,
      update: async function (data) {
        Object.assign(this, data);
        return this;
      },
    });
    Ledger.create = async (data) => ({ id: 92, ...data });

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${walletDebitEmployeeToken}`)
      .send({ user_id: 51, amount: 25, reason: 'Adjustment' });

    expect(res.status).to.equal(201);
    expect(res.body.success).to.equal(true);
  });

  it('allows an employee with payout.read to view today payouts', async () => {
    WalletTransaction.findAll = async () => [];

    const res = await request(app)
      .get('/api/dashboard/today-payouts')
      .set('Authorization', `Bearer ${payoutEmployeeToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.message).to.equal('Payout list fetched successfully.');
  });
});
