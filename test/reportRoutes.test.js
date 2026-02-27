'use strict';
/**
 * Test suite for GET /api/report/* endpoints.
 *
 * Strategy: mount only the reportRoutes on an isolated Express app and
 * monkey-patch model static methods so no real DB is needed.
 */

const { expect } = require('chai');
const request    = require('supertest');
const express    = require('express');
const jwt        = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

// ── subject under test ────────────────────────────────────────────────────────
const reportRoutes = require('../routes/reportRoutes');

// ── models we'll stub ─────────────────────────────────────────────────────────
const Transaction          = require('../models/Transaction');
const User                 = require('../models/User');
const WalletTransaction    = require('../models/WalletTransaction');
const RazorpayNotification = require('../models/RazorpayNotification');
const Ledger               = require('../models/Ledger');
const PayoutTransaction    = require('../models/PayoutTransaction');

// ── minimal Express app ───────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/api/report', reportRoutes);

// ── JWT helpers ───────────────────────────────────────────────────────────────
const makeToken = (id, role) =>
  jwt.sign({ user: { id, role, name: `${role} user` } }, process.env.ACCESS_TOKEN_SECRET);

const adminToken      = makeToken(1, 'admin');
const merchantToken   = makeToken(2, 'merchant');
const franchiseToken  = makeToken(3, 'franchaise');

// ── shared no-op stubs ────────────────────────────────────────────────────────
const emptyFindAll         = async () => [];
const emptyFindAndCountAll = async () => ({ count: 0, rows: [] });

// ============================================================================
// 1. GET /report/pos-txn
// ============================================================================
describe('GET /api/report/pos-txn', () => {
  let origFindAll;

  beforeEach(() => { origFindAll = Transaction.findAll; });
  afterEach(()  => { Transaction.findAll = origFindAll; });

  it('returns 200 with count and data array (default today)', async () => {
    Transaction.findAll = async () => [
      { Date: new Date(), Status: 'CAPTURED', Consumer: 'Test User', Invoice: 'INV-001', DeviceSerial: 'SN001' }
    ];

    const res = await request(app)
      .get('/api/report/pos-txn')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.message).to.equal('Transaction Report Fetched Successfully');
    expect(res.body.count).to.equal(1);
    expect(res.body.data).to.be.an('array').with.lengthOf(1);
    expect(res.body.date_range).to.have.keys('from', 'to');
  });

  it('returns 200 with explicit date range', async () => {
    Transaction.findAll = async () => [];

    const res = await request(app)
      .get('/api/report/pos-txn?from_date=2026-01-01&to_date=2026-01-31')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.count).to.equal(0);
    // from must be midnight of 2026-01-01 local time (may shift in UTC)
    const from = new Date(res.body.date_range.from);
    const to   = new Date(res.body.date_range.to);
    expect(from.getFullYear()).to.be.oneOf([2025, 2026]);  // midnight local may be prior UTC day
    expect(to.getMonth() + 1).to.be.oneOf([1, 2]);         // Jan 31 local may appear Feb 1 UTC
    expect(from < to).to.be.true;
  });

  it('returns 400 for an invalid date format', async () => {
    const res = await request(app)
      .get('/api/report/pos-txn?from_date=not-a-date')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/invalid date/i);
  });

  it('accepts status, cardHolderName, posTxnNo and deviceNo filters', async () => {
    let capturedWhere;
    Transaction.findAll = async ({ where }) => { capturedWhere = where; return []; };

    await request(app)
      .get('/api/report/pos-txn?status=CAPTURED&cardHolderName=John&posTxnNo=INV-99&deviceNo=SN999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedWhere.Status).to.equal('CAPTURED');
    expect(capturedWhere.Invoice).to.equal('INV-99');
    expect(capturedWhere.DeviceSerial).to.equal('SN999');
    expect(capturedWhere.Consumer[require('sequelize').Op.like]).to.equal('%John%');
  });

  it('returns 401 when no token supplied', async () => {
    const res = await request(app).get('/api/report/pos-txn');
    expect(res.status).to.equal(401);
  });
});

// ============================================================================
// 2. GET /report/wallet
// ============================================================================
describe('GET /api/report/wallet', () => {
  let origUserFindByPk, origWalletFindAll;

  beforeEach(() => {
    origUserFindByPk   = User.findByPk;
    origWalletFindAll  = WalletTransaction.findAll;
  });
  afterEach(() => {
    User.findByPk            = origUserFindByPk;
    WalletTransaction.findAll = origWalletFindAll;
  });

  it('returns 400 when userId is missing', async () => {
    const res = await request(app)
      .get('/api/report/wallet')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/userId is required/i);
  });

  it('returns 404 when user does not exist', async () => {
    User.findByPk = async () => null;

    const res = await request(app)
      .get('/api/report/wallet?userId=999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(404);
    expect(res.body.message).to.match(/user not found/i);
  });

  it('returns 200 with running balance (credit transaction)', async () => {
    User.findByPk = async () => ({ id: 2, role: 'merchant', wallet: '1000.00' });
    WalletTransaction.findAll = async () => [
      { id: 1, createdAt: new Date(), reference_id: 'UTR001', reason: 'top-up', type: 'request', amount: '500.00', status: 'completed' }
    ];

    const res = await request(app)
      .get('/api/report/wallet?userId=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.message).to.equal('Wallet transaction report fetched successfully');
    expect(res.body.wallet_balance).to.equal('1000.00');
    expect(res.body.count).to.equal(1);
    expect(res.body.data[0]).to.have.keys(
      'id', 'date_and_time', 'utr_no', 'description', 'debit', 'credit', 'balance', 'status'
    );
    expect(res.body.data[0].credit).to.equal('500.00');
    expect(res.body.data[0].debit).to.equal('-');
  });

  it('returns 200 with running balance (debit transaction)', async () => {
    User.findByPk = async () => ({ id: 2, role: 'merchant', wallet: '700.00' });
    WalletTransaction.findAll = async () => [
      { id: 2, createdAt: new Date(), reference_id: null, reason: 'charge', type: 'debit', amount: '300.00', status: 'completed' }
    ];

    const res = await request(app)
      .get('/api/report/wallet?userId=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data[0].debit).to.equal('300.00');
    expect(res.body.data[0].credit).to.equal('-');
    expect(res.body.data[0].utr_no).to.equal('-');
  });

  it('returns 400 for invalid date format', async () => {
    User.findByPk = async () => ({ id: 2, role: 'merchant', wallet: '0.00' });

    const res = await request(app)
      .get('/api/report/wallet?userId=2&from_date=bad')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
  });
});

// ============================================================================
// 3. GET /report/razorpay
// ============================================================================
describe('GET /api/report/razorpay', () => {
  let origFindAndCountAll, origLogFindAll, origUserFindAll;

  beforeEach(() => {
    origFindAndCountAll = RazorpayNotification.findAndCountAll;
    origLogFindAll      = Ledger.findAll;
    origUserFindAll     = User.findAll;
  });
  afterEach(() => {
    RazorpayNotification.findAndCountAll = origFindAndCountAll;
    Ledger.findAll                       = origLogFindAll;
    User.findAll                         = origUserFindAll;
  });

  const sampleRow = () => ({
    id: 55, txn_id: 'TXN_abc123', mid: 'MID001', tid: 'TID001',
    amount: '1000.00', currency_code: 'INR', payment_mode: 'CARD',
    payment_card_type: 'DEBIT', payment_card_brand: 'VISA',
    rr_number: 'RR123', device_serial: 'SN123', posting_date: new Date(),
    status: 'CAPTURED', user_id: 2, pos_machine_id: 7,
    user: { id: 2, name: 'Merch', email: 'm@m.com', mobile_number: '9999', abheepay_id: 'AP1', organization_name: 'Org' },
    posMachine: { id: 7, mid_number: 'MID001', tid_number: 'TID001', device_serial_number: 'SN123' },
    createdAt: new Date()
  });

  it('admin gets all records with balance fields (200)', async () => {
    RazorpayNotification.findAndCountAll = async () => ({ count: 1, rows: [sampleRow()] });
    Ledger.findAll = async () => [
      { transaction_id: 'TXN_abc123', balance_before: '500.00', balance: '1000.00', debit: '0.00' }
    ];

    const res = await request(app)
      .get('/api/report/razorpay?from_date=2026-02-27&to_date=2026-02-27')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.count).to.equal(1);
    expect(res.body.pagination).to.have.keys('total', 'page', 'limit', 'totalPages');
    expect(res.body.data[0].balance_before).to.equal(500);
    expect(res.body.data[0].balance_after).to.equal(1000);
  });

  it('merchant is scoped to their own user_id', async () => {
    let capturedWhere;
    RazorpayNotification.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };
    Ledger.findAll = emptyFindAll;

    await request(app)
      .get('/api/report/razorpay')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(capturedWhere.user_id).to.equal(2);
  });

  it('franchise is scoped to self + merchants (no user_id param)', async () => {
    User.findAll = async () => [{ id: 10 }, { id: 11 }];
    let capturedWhere;
    RazorpayNotification.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };
    Ledger.findAll = emptyFindAll;

    await request(app)
      .get('/api/report/razorpay')
      .set('Authorization', `Bearer ${franchiseToken}`);

    const inClause = capturedWhere.user_id[require('sequelize').Op.in];
    expect(inClause).to.include(3);   // franchise own id
    expect(inClause).to.include(10);
    expect(inClause).to.include(11);
  });

  it('franchise is denied when user_id does not belong to them', async () => {
    User.findOne = async () => null;  // target not found under franchise

    const origFindOne = User.findOne;
    User.findOne = async () => null;

    const res = await request(app)
      .get('/api/report/razorpay?user_id=999')
      .set('Authorization', `Bearer ${franchiseToken}`);

    User.findOne = origFindOne;
    expect(res.status).to.equal(403);
  });

  it('returns 400 when from_date is invalid', async () => {
    const res = await request(app)
      .get('/api/report/razorpay?from_date=invalid')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
  });

  it('returns 400 when from_date > to_date', async () => {
    const res = await request(app)
      .get('/api/report/razorpay?from_date=2026-03-01&to_date=2026-02-01')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/from_date must not be after/i);
  });

  it('pagination defaults: page=1, limit=50', async () => {
    let capturedOpts;
    RazorpayNotification.findAndCountAll = async (opts) => {
      capturedOpts = opts;
      return { count: 0, rows: [] };
    };
    Ledger.findAll = emptyFindAll;

    await request(app)
      .get('/api/report/razorpay')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(50);
    expect(capturedOpts.offset).to.equal(0);
  });

  it('custom pagination: page=2, limit=10', async () => {
    let capturedOpts;
    RazorpayNotification.findAndCountAll = async (opts) => {
      capturedOpts = opts;
      return { count: 0, rows: [] };
    };
    Ledger.findAll = emptyFindAll;

    await request(app)
      .get('/api/report/razorpay?page=2&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(10);
    expect(capturedOpts.offset).to.equal(10);
  });

  it('rows with no ledger entry get null balance fields', async () => {
    RazorpayNotification.findAndCountAll = async () => ({ count: 1, rows: [sampleRow()] });
    Ledger.findAll = emptyFindAll;  // no matching ledger rows

    const res = await request(app)
      .get('/api/report/razorpay')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data[0].balance_before).to.be.null;
    expect(res.body.data[0].balance_after).to.be.null;
  });
});

// ============================================================================
// 4. GET /report/razorpay/all  (admin-only)
// ============================================================================
describe('GET /api/report/razorpay/all', () => {
  let origFindAndCountAll;

  beforeEach(() => { origFindAndCountAll = RazorpayNotification.findAndCountAll; });
  afterEach(()  => { RazorpayNotification.findAndCountAll = origFindAndCountAll; });

  it('returns 200 with pagination for admin', async () => {
    RazorpayNotification.findAndCountAll = async () => ({
      count: 2,
      rows: [
        { id: 1, user: { id: 2, name: 'M', email: 'm@m.com', mobile_number: '9' }, posMachine: null },
        { id: 2, user: null, posMachine: null }
      ]
    });

    const res = await request(app)
      .get('/api/report/razorpay/all')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.count).to.equal(2);
    expect(res.body.pagination.totalPages).to.equal(1);
  });

  it('returns 403 for non-admin (merchant)', async () => {
    const res = await request(app)
      .get('/api/report/razorpay/all')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(403);
  });

  it('returns 403 for franchise role', async () => {
    const res = await request(app)
      .get('/api/report/razorpay/all')
      .set('Authorization', `Bearer ${franchiseToken}`);

    expect(res.status).to.equal(403);
  });

  it('honours page and limit query params', async () => {
    let capturedOpts;
    RazorpayNotification.findAndCountAll = async (opts) => {
      capturedOpts = opts;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/razorpay/all?page=3&limit=20')
      .set('Authorization', `Bearer ${adminToken}`);

    // limit is capped at 50 — 20 < 50 so stays 20
    expect(capturedOpts.limit).to.equal(20);
    expect(capturedOpts.offset).to.equal(40);   // (3-1)*20
  });

  it('caps limit at 50', async () => {
    let capturedOpts;
    RazorpayNotification.findAndCountAll = async (opts) => {
      capturedOpts = opts;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/razorpay/all?limit=200')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(50);
  });
});

// ============================================================================
// 5. GET /report/ledger
// ============================================================================
describe('GET /api/report/ledger', () => {
  let origFindAll;

  beforeEach(() => { origFindAll = Ledger.findAll; });
  afterEach(()  => { Ledger.findAll = origFindAll; });

  const ledgerEntry = () => ({
    id: 301, createdAt: new Date(), user_id: 2,
    user: { id: 2, name: 'Merch', mobile_number: '9', abheepay_id: 'AP1', organization_name: 'Org' },
    transaction_type: 'razorpay_charge',
    description: 'charge deducted',
    debit: '30.00', credit: '0',
    balance_before: '1000.00', balance: '970.00',
    transaction_id: 'TXN_abc', reference_id: 55,
    reference_table: 'MerchantTransactionCharges',
    status: 'completed', metadata: '{"charge_amount":30}'
  });

  it('admin gets all ledger entries (200)', async () => {
    Ledger.findAll = async () => [ledgerEntry()];

    const res = await request(app)
      .get('/api/report/ledger')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.count).to.equal(1);
    expect(res.body.data[0]).to.include({
      transaction_type: 'razorpay_charge',
      debit: 30,
      credit: 0,
      amount: 30,
      balance_before: 1000,
      balance_after: 970
    });
    expect(res.body.data[0].metadata).to.deep.equal({ charge_amount: 30 });
  });

  it('merchant ledger is scoped to their own user_id in WHERE', async () => {
    let capturedWhere;
    Ledger.findAll = async ({ where }) => { capturedWhere = where; return []; };

    await request(app)
      .get('/api/report/ledger')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(capturedWhere.user_id).to.equal(2);
  });

  it('returns 400 for invalid date', async () => {
    const res = await request(app)
      .get('/api/report/ledger?from_date=2026-13-01')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
  });

  it('returns 400 when from_date > to_date', async () => {
    const res = await request(app)
      .get('/api/report/ledger?from_date=2026-05-01&to_date=2026-04-01')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/from_date must not be after/i);
  });

  it('admin with user_id filter scopes WHERE correctly', async () => {
    let capturedWhere;
    Ledger.findAll = async ({ where }) => { capturedWhere = where; return []; };

    await request(app)
      .get('/api/report/ledger?user_id=42')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedWhere.user_id).to.equal(42);
  });

  it('metadata null is handled gracefully', async () => {
    Ledger.findAll = async () => [{ ...ledgerEntry(), metadata: null }];

    const res = await request(app)
      .get('/api/report/ledger')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data[0].metadata).to.be.null;
  });
});

// ============================================================================
// 6. GET /report/payout
// ============================================================================
describe('GET /api/report/payout', () => {
  let origFindAndCountAll, origLedgerFindAll;

  beforeEach(() => {
    origFindAndCountAll = PayoutTransaction.findAndCountAll;
    origLedgerFindAll   = Ledger.findAll;
  });
  afterEach(() => {
    PayoutTransaction.findAndCountAll = origFindAndCountAll;
    Ledger.findAll                    = origLedgerFindAll;
  });

  const payoutRow = () => ({
    id: 12, createdAt: new Date(), merchant_id: 2,
    beneficiary_id: 9, reference_id: 'UUID-001',
    amount: '5000.00', service_charge: '25.00',
    purpose: 'Vendor payment', status: 'SUCCESS'
  });

  it('returns 200 with correct total_deducted and balance fields (admin)', async () => {
    PayoutTransaction.findAndCountAll = async () => ({ count: 1, rows: [payoutRow()] });
    Ledger.findAll = async () => [
      { reference_id: 12, balance_before: '10000.00', balance: '4975.00', debit: '5025.00' }
    ];

    const res = await request(app)
      .get('/api/report/payout')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data[0].total_deducted).to.equal(5025);
    expect(res.body.data[0].balance_before).to.equal(10000);
    expect(res.body.data[0].balance_after).to.equal(4975);
  });

  it('rows with no matching ledger entry get null balance fields', async () => {
    PayoutTransaction.findAndCountAll = async () => ({ count: 1, rows: [payoutRow()] });
    Ledger.findAll = emptyFindAll;

    const res = await request(app)
      .get('/api/report/payout')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data[0].balance_before).to.be.null;
    expect(res.body.data[0].balance_after).to.be.null;
  });

  it('status filter is passed to WHERE', async () => {
    let capturedWhere;
    PayoutTransaction.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };
    Ledger.findAll = emptyFindAll;

    await request(app)
      .get('/api/report/payout?status=failed')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedWhere.status).to.equal('FAILED');
  });

  it('merchant is scoped to their own merchant_id in WHERE', async () => {
    let capturedWhere;
    PayoutTransaction.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };
    Ledger.findAll = emptyFindAll;

    await request(app)
      .get('/api/report/payout')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(capturedWhere.merchant_id).to.equal(2);
  });

  it('pagination works correctly', async () => {
    let capturedOpts;
    PayoutTransaction.findAndCountAll = async (opts) => {
      capturedOpts = opts;
      return { count: 0, rows: [] };
    };
    Ledger.findAll = emptyFindAll;

    await request(app)
      .get('/api/report/payout?page=2&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(5);
    expect(capturedOpts.offset).to.equal(5);
  });
});

// ============================================================================
// 7. GET /report/bbps
// ============================================================================
describe('GET /api/report/bbps', () => {
  let origLedgerFindAndCountAll;

  beforeEach(() => { origLedgerFindAndCountAll = Ledger.findAndCountAll; });
  afterEach(()  => { Ledger.findAndCountAll = origLedgerFindAndCountAll; });

  const bbpsEntry = () => ({
    id: 88, createdAt: new Date(), user_id: 2,
    user: { id: 2, name: 'Merch', mobile_number: '9', abheepay_id: 'AP1', organization_name: 'Org' },
    transaction_id: 'APBBPS001',
    description: 'BBPS CC bill payment',
    debit: '2500.00', balance_before: '7500.00', balance: '5000.00',
    status: 'completed',
    metadata: JSON.stringify({
      biller_id: 'HDFC_CC_001', customer_mobile: '9876543210',
      payment_mode: 'Cash', statuscode: 'TXN'
    })
  });

  it('returns 200 with bbps-specific fields (admin)', async () => {
    Ledger.findAndCountAll = async () => ({ count: 1, rows: [bbpsEntry()] });

    const res = await request(app)
      .get('/api/report/bbps')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data[0].biller_id).to.equal('HDFC_CC_001');
    expect(res.body.data[0].customer_mobile).to.equal('9876543210');
    expect(res.body.data[0].statuscode).to.equal('TXN');
    expect(res.body.data[0].amount).to.equal(2500);
    expect(res.body.data[0].balance_before).to.equal(7500);
    expect(res.body.data[0].balance_after).to.equal(5000);
    expect(res.body.data[0].external_ref).to.equal('APBBPS001');
  });

  it('WHERE always includes transaction_type = bbps_payment', async () => {
    let capturedWhere;
    Ledger.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/bbps')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedWhere.transaction_type).to.equal('bbps_payment');
  });

  it('merchant is scoped by user_id', async () => {
    let capturedWhere;
    Ledger.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/bbps')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(capturedWhere.user_id).to.equal(2);
  });

  it('handles missing metadata gracefully', async () => {
    Ledger.findAndCountAll = async () => ({
      count: 1,
      rows: [{ ...bbpsEntry(), metadata: null }]
    });

    const res = await request(app)
      .get('/api/report/bbps')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data[0].biller_id).to.be.null;
    expect(res.body.data[0].customer_mobile).to.be.null;
  });

  it('pagination in response', async () => {
    Ledger.findAndCountAll = async () => ({ count: 5, rows: [] });

    const res = await request(app)
      .get('/api/report/bbps?page=1&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.pagination.total).to.equal(5);
    expect(res.body.pagination.totalPages).to.equal(1);
  });
});

// ============================================================================
// 8. GET /report/all-transactions
// ============================================================================
describe('GET /api/report/all-transactions', () => {
  let origLedgerFindAndCountAll;

  beforeEach(() => { origLedgerFindAndCountAll = Ledger.findAndCountAll; });
  afterEach(()  => { Ledger.findAndCountAll = origLedgerFindAndCountAll; });

  const txnEntry = (type, debit, credit) => ({
    id: 1, createdAt: new Date(), user_id: 2,
    user: { id: 2, name: 'Merch', mobile_number: '9', abheepay_id: 'AP1', organization_name: 'Org' },
    transaction_type: type,
    description: `${type} entry`,
    debit: String(debit), credit: String(credit),
    balance_before: '10000.00', balance: '9000.00',
    transaction_id: 'TXN_X', reference_id: 10,
    reference_table: 'PayoutTransactions', status: 'completed'
  });

  it('returns 200 with supported_types list (admin)', async () => {
    Ledger.findAndCountAll = async () => ({ count: 1, rows: [txnEntry('payout', 1000, 0)] });

    const res = await request(app)
      .get('/api/report/all-transactions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.supported_types).to.include.members([
      'razorpay_credit', 'razorpay_charge', 'razorpay_commission',
      'payout', 'bbps_payment', 'direct_transfer',
      'wallet_credit', 'wallet_debit'
    ]);
    expect(res.body.data[0].amount).to.equal(1000);
    expect(res.body.data[0].debit).to.equal(1000);
    expect(res.body.data[0].credit).to.equal(0);
  });

  it('credit transaction: amount reflects credit value', async () => {
    Ledger.findAndCountAll = async () => ({ count: 1, rows: [txnEntry('wallet_credit', 0, 500)] });

    const res = await request(app)
      .get('/api/report/all-transactions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data[0].amount).to.equal(500);
    expect(res.body.data[0].credit).to.equal(500);
    expect(res.body.data[0].debit).to.equal(0);
  });

  it('transaction_type filter is passed in WHERE', async () => {
    let capturedWhere;
    Ledger.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/all-transactions?transaction_type=payout')
      .set('Authorization', `Bearer ${adminToken}`);

    const inClause = capturedWhere.transaction_type[require('sequelize').Op.in];
    expect(inClause).to.deep.equal(['payout']);
  });

  it('merchant is scoped to their own user_id', async () => {
    let capturedWhere;
    Ledger.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/all-transactions')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(capturedWhere.user_id).to.equal(2);
  });

  it('pagination is correctly set in query options', async () => {
    let capturedOpts;
    Ledger.findAndCountAll = async (opts) => {
      capturedOpts = opts;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/all-transactions?page=3&limit=20')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(20);
    expect(capturedOpts.offset).to.equal(40);  // (3-1)*20
  });

  it('limit is capped at 200', async () => {
    let capturedOpts;
    Ledger.findAndCountAll = async (opts) => {
      capturedOpts = opts;
      return { count: 0, rows: [] };
    };

    await request(app)
      .get('/api/report/all-transactions?limit=500')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(200);
  });
});

// ============================================================================
// 9. GET /report/users
// ============================================================================
describe('GET /api/report/users', () => {
  let origFindAndCountAll;

  beforeEach(() => { origFindAndCountAll = User.findAndCountAll; });
  afterEach(()  => { User.findAndCountAll = origFindAndCountAll; });

  const userRow = (id, role) => ({
    id, name: `User ${id}`, role, email: `u${id}@test.com`,
    mobile_number: '9999', status: 'active', createdAt: new Date()
  });

  it('admin gets all users (200)', async () => {
    User.findAndCountAll = async () => ({
      count: 3,
      rows: [userRow(1, 'admin'), userRow(2, 'merchant'), userRow(3, 'franchaise')]
    });

    const res = await request(app)
      .get('/api/report/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data).to.have.lengthOf(3);
    expect(res.body.pagination.total).to.equal(3);
  });

  it('admin status filter is passed to WHERE', async () => {
    let capturedWhere;
    User.findAndCountAll = async ({ where }) => { capturedWhere = where; return { count: 0, rows: [] }; };

    await request(app)
      .get('/api/report/users?status=active')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedWhere.status).to.equal('active');
  });

  it('admin role filter is passed to WHERE', async () => {
    let capturedWhere;
    User.findAndCountAll = async ({ where }) => { capturedWhere = where; return { count: 0, rows: [] }; };

    await request(app)
      .get('/api/report/users?role=merchant')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedWhere.role).to.equal('merchant');
  });

  it('franchise is restricted to their own merchants (franchaise_id filter)', async () => {
    let capturedWhere;
    User.findAndCountAll = async ({ where }) => { capturedWhere = where; return { count: 0, rows: [] }; };

    await request(app)
      .get('/api/report/users')
      .set('Authorization', `Bearer ${franchiseToken}`);

    expect(capturedWhere.franchaise_id).to.equal(3);
  });

  it('merchant (non-admin, non-franchise) is restricted to themselves', async () => {
    let capturedWhere;
    User.findAndCountAll = async ({ where }) => { capturedWhere = where; return { count: 0, rows: [] }; };

    await request(app)
      .get('/api/report/users')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(capturedWhere.id).to.equal(2);
  });

  it('pagination respects page and limit query params', async () => {
    let capturedOpts;
    User.findAndCountAll = async (opts) => { capturedOpts = opts; return { count: 0, rows: [] }; };

    await request(app)
      .get('/api/report/users?page=2&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(5);
    expect(capturedOpts.offset).to.equal(5);
  });

  it('default limit is 10', async () => {
    let capturedOpts;
    User.findAndCountAll = async (opts) => { capturedOpts = opts; return { count: 0, rows: [] }; };

    await request(app)
      .get('/api/report/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(capturedOpts.limit).to.equal(10);
  });
});
