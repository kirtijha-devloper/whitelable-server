const { expect } = require('chai');
const request    = require('supertest');
const express    = require('express');
const jwt        = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const adminRoutes = require('../routes/adminRoutes');
const db          = require('../config/database');
const User        = require('../models/User');
const Ledger      = require('../models/Ledger');

// SQLite (test env) does not attach Transaction to the sequelize instance.
// Patch it so the controller's `db.Transaction.ISOLATION_LEVELS` reference
// resolves without throwing before our db.transaction stub is invoked.
if (!db.Transaction) {
  db.Transaction = require('sequelize').Transaction;
}

// ── Mini express app ──────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
     .json({ message: err.message });
});

// ── JWT helpers ───────────────────────────────────────────────────────────────
const SECRET       = process.env.ACCESS_TOKEN_SECRET;
const adminToken   = jwt.sign({ user: { id: 1, role: 'admin',    name: 'Admin'   } }, SECRET);
const merchantToken = jwt.sign({ user: { id: 9, role: 'merchant', name: 'Merchant'} }, SECRET);

// ── Reusable fake DB transaction ─────────────────────────────────────────────
function makeFakeTxn() {
  const txn = {
    LOCK:     { UPDATE: 'UPDATE' },
    commit:   async () => {},
    rollback: async () => {},
  };
  return txn;
}

// ── Stub registry ─────────────────────────────────────────────────────────────
let stubs = {};

beforeEach(() => {
  stubs = {
    dbTransaction:   db.transaction,
    userFindByPk:    User.findByPk,
    userFindOne:     User.findOne,
    userUpdate:      User.update,
    ledgerFindOne:   Ledger.findOne,
    ledgerCreate:    Ledger.create,
  };
});

afterEach(() => {
  db.transaction   = stubs.dbTransaction;
  User.findByPk    = stubs.userFindByPk;
  User.findOne     = stubs.userFindOne;
  User.update      = stubs.userUpdate;
  Ledger.findOne   = stubs.ledgerFindOne;
  Ledger.create    = stubs.ledgerCreate;
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared payload
// ─────────────────────────────────────────────────────────────────────────────
const BASE_CREDIT = {
  user_id:         42,
  amount:          500,
  reason:          'Top-up for testing',
  idempotency_key: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

const BASE_DEBIT = {
  user_id:         42,
  amount:          200,
  reason:          'Refund deduction',
  idempotency_key: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers that set up the "happy path" stubs for a credit operation
// ─────────────────────────────────────────────────────────────────────────────
function stubHappyCredit({ balanceBefore = 1000, amount = 500 } = {}) {
  const txn = makeFakeTxn();
  db.transaction = async (_opts) => txn;

  // No duplicate ledger entry
  Ledger.findOne = async () => null;

  // Target user is active merchant with ledger tracking enabled
  User.findOne = async () => ({
    id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore, status: 'active', start_ledger: true,
  });

  // Inside txn: lock user row
  User.findByPk = async (id, opts) => {
    if (opts && opts.lock) {
      return { id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore, start_ledger: true };
    }
    // Re-fetch after commit
    return { id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore + amount, start_ledger: true };
  };

  // No prior ledger row (balance falls back to user.wallet via getBalanceInTxn)
  // findOne inside txn for latest ledger
  const origFindOne = Ledger.findOne;
  Ledger.findOne = async (opts) => {
    if (opts && opts.where && opts.where.user_id && !opts.where.transaction_id) return null; // no latest row
    return null; // no idempotency hit
  };

  Ledger.create = async (data) => ({
    id:              77,
    ...data,
    createdAt:       new Date('2026-02-27T10:00:00Z'),
  });

  User.update = async () => [1];

  return txn;
}

function stubHappyDebit({ balanceBefore = 1000, amount = 200 } = {}) {
  const txn = makeFakeTxn();
  db.transaction = async (_opts) => txn;

  Ledger.findOne = async () => null;

  User.findOne = async () => ({
    id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore, status: 'active', start_ledger: true,
  });

  User.findByPk = async (id, opts) => {
    if (opts && opts.lock) {
      return { id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore, start_ledger: true };
    }
    return { id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore - amount, start_ledger: true };
  };

  Ledger.create = async (data) => ({
    id:        88,
    ...data,
    createdAt: new Date('2026-02-27T10:00:00Z'),
  });

  User.update = async () => [1];

  return txn;
}

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/admin/wallet/credit
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/admin/wallet/credit', () => {

  // ── Auth / role guard ──────────────────────────────────────────────────────
  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send(BASE_CREDIT);
    expect(res.status).to.equal(403);
    expect(res.body.success).to.be.false;
    expect(res.body.message).to.match(/admin/i);
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .send(BASE_CREDIT);
    expect(res.status).to.equal(401);
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  it('returns 400 when user_id is missing', async () => {
    const { user_id: _u, ...body } = BASE_CREDIT;
    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/user_id/i);
  });

  it('returns 400 when amount is zero', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...BASE_CREDIT, amount: 0 });
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/amount/i);
  });

  it('returns 400 when amount is negative', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...BASE_CREDIT, amount: -10 });
    expect(res.status).to.equal(400);
  });

  it('returns 400 when idempotency_key is missing', async () => {
    const { idempotency_key: _k, ...body } = BASE_CREDIT;
    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/idempotency_key/i);
  });

  // ── Business rules ─────────────────────────────────────────────────────────
  it('returns 404 when target user does not exist or is not merchant/franchisee', async () => {
    Ledger.findOne = async () => null;
    User.findOne   = async () => null;

    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_CREDIT);
    expect(res.status).to.equal(404);
    expect(res.body.success).to.be.false;
  });

  it('returns 422 when target user account is inactive', async () => {
    Ledger.findOne = async () => null;
    User.findOne   = async () => ({
      id: 42, name: 'Blocked User', role: 'merchant', wallet: 0, status: 'inactive',
    });

    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_CREDIT);
    expect(res.status).to.equal(422);
    expect(res.body.message).to.match(/inactive/i);
  });

  it('returns 422 when ledger tracking is not enabled for the target user', async () => {
    Ledger.findOne = async () => null;
    User.findOne   = async () => ({
      id: 42, name: 'Merchant A', role: 'merchant', wallet: 0, status: 'active', start_ledger: false,
    });
    User.findByPk  = async () => ({
      id: 42, name: 'Merchant A', role: 'merchant', wallet: 0, start_ledger: false,
    });

    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_CREDIT);
    expect(res.status).to.equal(422);
    expect(res.body.success).to.be.false;
    expect(res.body.message).to.match(/ledger tracking is not enabled/i);
    expect(res.body.message).to.match(/enable ledger tracking/i);
    expect(res.body.data.start_ledger).to.be.false;
  });

  // ── Idempotency ────────────────────────────────────────────────────────────
  it('returns 200 with original result on duplicate idempotency key', async () => {
    const existingLedger = {
      id:               77,
      user_id:          42,
      transaction_id:   BASE_CREDIT.idempotency_key,
      transaction_type: 'admin_credit',
      credit:           500,
      debit:            0,
      balance_before:   1000,
      balance:          1500,
      description:      'Admin credit: Top-up for testing',
      createdAt:        new Date('2026-02-27T09:00:00Z'),
    };

    Ledger.findOne = async () => existingLedger;
    User.findByPk  = async () => ({
      id: 42, name: 'Merchant A', role: 'merchant', wallet: 1500, start_ledger: true,
    });

    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_CREDIT);
    expect(res.status).to.equal(200);
    expect(res.body.message).to.match(/duplicate/i);
    expect(res.body.data.idempotency_key).to.equal(BASE_CREDIT.idempotency_key);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────
  it('credits the wallet and returns 201 with correct data', async () => {
    const balanceBefore = 1000;
    const amount        = 500;
    stubHappyCredit({ balanceBefore, amount });

    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...BASE_CREDIT, amount });

    expect(res.status).to.equal(201);
    expect(res.body.success).to.be.true;
    expect(res.body.data.action).to.equal('credit');
    expect(res.body.data.amount).to.equal(amount);
    expect(res.body.data.balance_before).to.equal(balanceBefore);
    expect(res.body.data.balance_after).to.equal(balanceBefore + amount);
    expect(res.body.data.user_id).to.equal(42);
    expect(res.body.data.idempotency_key).to.equal(BASE_CREDIT.idempotency_key);
  });

  it('applies a credit even when a reason is omitted', async () => {
    stubHappyCredit();
    const { reason: _r, ...body } = BASE_CREDIT;

    const res = await request(app)
      .post('/api/admin/wallet/credit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).to.equal(201);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/admin/wallet/debit
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/admin/wallet/debit', () => {

  // ── Auth / role guard ──────────────────────────────────────────────────────
  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send(BASE_DEBIT);
    expect(res.status).to.equal(403);
    expect(res.body.success).to.be.false;
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .send(BASE_DEBIT);
    expect(res.status).to.equal(401);
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  it('returns 400 when user_id is missing', async () => {
    const { user_id: _u, ...body } = BASE_DEBIT;
    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/user_id/i);
  });

  it('returns 400 when amount is zero', async () => {
    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...BASE_DEBIT, amount: 0 });
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/amount/i);
  });

  it('returns 400 when idempotency_key is missing', async () => {
    const { idempotency_key: _k, ...body } = BASE_DEBIT;
    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/idempotency_key/i);
  });

  // ── Business rules ─────────────────────────────────────────────────────────
  it('returns 404 when target user does not exist or is not merchant/franchisee', async () => {
    Ledger.findOne = async () => null;
    User.findOne   = async () => null;

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_DEBIT);
    expect(res.status).to.equal(404);
  });

  it('returns 422 when target user account is inactive', async () => {
    Ledger.findOne = async () => null;
    User.findOne   = async () => ({
      id: 42, name: 'Blocked User', role: 'merchant', wallet: 500, status: 'suspended',
    });

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_DEBIT);
    expect(res.status).to.equal(422);
    expect(res.body.message).to.match(/suspended/i);
  });

  it('returns 422 when ledger tracking is not enabled for the target user', async () => {
    Ledger.findOne = async () => null;
    User.findOne   = async () => ({
      id: 42, name: 'Merchant A', role: 'merchant', wallet: 500, status: 'active', start_ledger: false,
    });
    User.findByPk  = async () => ({
      id: 42, name: 'Merchant A', role: 'merchant', wallet: 500, start_ledger: false,
    });

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_DEBIT);
    expect(res.status).to.equal(422);
    expect(res.body.success).to.be.false;
    expect(res.body.message).to.match(/ledger tracking is not enabled/i);
    expect(res.body.message).to.match(/enable ledger tracking/i);
    expect(res.body.data.start_ledger).to.be.false;
  });

  it('returns 422 when wallet balance is insufficient', async () => {
    const balanceBefore = 50; // less than debit amount of 200
    const txn = makeFakeTxn();
    db.transaction = async (_opts) => txn;

    Ledger.findOne = async () => null;

    User.findOne = async () => ({
      id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore, status: 'active', start_ledger: true,
    });

    User.findByPk = async (_id, opts) => {
      if (opts && opts.lock) {
        // Lock path: return no ledger row so balance falls back to user.wallet
        return { id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore, start_ledger: true };
      }
      return { id: 42, name: 'Merchant A', role: 'merchant', wallet: balanceBefore, start_ledger: true };
    };

    // Inside txn call sequence: first ledger findOne returns null (latest balance row)
    // We need Ledger.findOne to return null for the "latest ledger" query
    // (Ledger.findOne was already set above as no idempotency hit and no prior balance row)

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...BASE_DEBIT, amount: 200 });

    expect(res.status).to.equal(422);
    expect(res.body.message).to.match(/insufficient/i);
    expect(res.body.data.current_balance).to.equal(balanceBefore);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────
  it('returns 200 with original result on duplicate idempotency key', async () => {
    const existingLedger = {
      id:               88,
      user_id:          42,
      transaction_id:   BASE_DEBIT.idempotency_key,
      transaction_type: 'admin_debit',
      credit:           0,
      debit:            200,
      balance_before:   1000,
      balance:          800,
      description:      'Admin debit: Refund deduction',
      createdAt:        new Date('2026-02-27T09:00:00Z'),
    };

    Ledger.findOne = async () => existingLedger;
    User.findByPk  = async () => ({
      id: 42, name: 'Merchant A', role: 'merchant', wallet: 800, start_ledger: true,
    });

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(BASE_DEBIT);
    expect(res.status).to.equal(200);
    expect(res.body.message).to.match(/duplicate/i);
    expect(res.body.data.idempotency_key).to.equal(BASE_DEBIT.idempotency_key);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────
  it('debits the wallet and returns 201 with correct data', async () => {
    const balanceBefore = 1000;
    const amount        = 200;
    stubHappyDebit({ balanceBefore, amount });

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...BASE_DEBIT, amount });

    expect(res.status).to.equal(201);
    expect(res.body.success).to.be.true;
    expect(res.body.data.action).to.equal('debit');
    expect(res.body.data.amount).to.equal(amount);
    expect(res.body.data.balance_before).to.equal(balanceBefore);
    expect(res.body.data.balance_after).to.equal(balanceBefore - amount);
    expect(res.body.data.user_id).to.equal(42);
    expect(res.body.data.idempotency_key).to.equal(BASE_DEBIT.idempotency_key);
  });

  it('applies a debit even when a reason is omitted', async () => {
    stubHappyDebit();
    const { reason: _r, ...body } = BASE_DEBIT;

    const res = await request(app)
      .post('/api/admin/wallet/debit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).to.equal(201);
  });
});
