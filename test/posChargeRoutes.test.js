const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const posChargeRoutes = require('../routes/posChargeRoutes');
const PosChargeDefault = require('../models/PosChargeDefault');
const UserPosCharge = require('../models/UserPosCharge');
const User = require('../models/User');

// ── Mini express app ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/api/pos-charge', posChargeRoutes);
// Simple error handler mirrors the real one
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
     .json({ message: err.message });
});

// ── JWT helpers ──────────────────────────────────────────────────────────────
const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken      = jwt.sign({ user: { id: 1, role: 'admin',      name: 'Admin'      } }, SECRET);
const franchaiseToken = jwt.sign({ user: { id: 5, role: 'franchaise', name: 'Franchise'  } }, SECRET);
const merchantToken   = jwt.sign({ user: { id: 9, role: 'merchant',   name: 'Merchant'   } }, SECRET);

// ── Stub helpers ─────────────────────────────────────────────────────────────
let stubs = {};

beforeEach(() => {
  stubs = {
    pcDefaultFindAll:   PosChargeDefault.findAll,
    pcDefaultFindOne:   PosChargeDefault.findOne,
    pcDefaultCreate:    PosChargeDefault.create,
    pcDefaultFindByPk:  PosChargeDefault.findByPk,
    userPcFindAll:      UserPosCharge.findAll,
    userPcFindOne:      UserPosCharge.findOne,
    userPcCreate:       UserPosCharge.create,
    userPcFindByPk:     UserPosCharge.findByPk,
    userFindByPk:       User.findByPk,
    userFindAll:        User.findAll,
    userFindOne:        User.findOne,
  };
});

afterEach(() => {
  PosChargeDefault.findAll  = stubs.pcDefaultFindAll;
  PosChargeDefault.findOne  = stubs.pcDefaultFindOne;
  PosChargeDefault.create   = stubs.pcDefaultCreate;
  PosChargeDefault.findByPk = stubs.pcDefaultFindByPk;
  UserPosCharge.findAll     = stubs.userPcFindAll;
  UserPosCharge.findOne     = stubs.userPcFindOne;
  UserPosCharge.create      = stubs.userPcCreate;
  UserPosCharge.findByPk    = stubs.userPcFindByPk;
  User.findByPk             = stubs.userFindByPk;
  User.findAll              = stubs.userFindAll;
  User.findOne              = stubs.userFindOne;
});

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT POS CHARGE
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/pos-charge/default', () => {
  it('rejects non-admin', async () => {
    const res = await request(app)
      .post('/api/pos-charge/default')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ paymentMode: 'CARD', percent_fee: 1.5 });
    expect(res.status).to.equal(403);
  });

  it('rejects when percent_fee is 0', async () => {
    const res = await request(app)
      .post('/api/pos-charge/default')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMode: 'CARD', percent_fee: 0 });
    expect(res.status).to.equal(400);
  });

  it('rejects when percent_fee is missing', async () => {
    const res = await request(app)
      .post('/api/pos-charge/default')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMode: 'CARD' });
    expect(res.status).to.equal(400);
  });

  it('rejects duplicate combination', async () => {
    PosChargeDefault.findOne = async () => ({ id: 10, payment_mode: 'CARD', percent_fee: 1.5 });

    const res = await request(app)
      .post('/api/pos-charge/default')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMode: 'CARD', percent_fee: 2.0 });
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/already exists/i);
  });

  it('creates a default slab (admin)', async () => {
    PosChargeDefault.findOne = async () => null;
    PosChargeDefault.create  = async (data) => ({ id: 42, ...data });

    const res = await request(app)
      .post('/api/pos-charge/default')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMode: 'CARD', paymentCardType: 'CREDIT', paymentCardBrand: 'VISA', percent_fee: 1.5 });

    expect(res.status).to.equal(201);
    expect(res.body.record.id).to.equal(42);
    expect(res.body.record.percent_fee).to.equal(1.5);
  });

  it('creates a wildcard slab (all nulls)', async () => {
    PosChargeDefault.findOne = async () => null;
    PosChargeDefault.create  = async (data) => ({ id: 43, ...data });

    const res = await request(app)
      .post('/api/pos-charge/default')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ percent_fee: 0.8 });

    expect(res.status).to.equal(201);
    expect(res.body.record.payment_mode).to.be.null;
  });
});

describe('GET /api/pos-charge/default', () => {
  it('returns list for all authenticated roles', async () => {
    const records = [
      { id: 1, payment_mode: 'CARD', percent_fee: 1.5 },
      { id: 2, payment_mode: null,   percent_fee: 0.5 }
    ];
    PosChargeDefault.findAll = async () => records;

    for (const token of [adminToken, franchaiseToken, merchantToken]) {
      const res = await request(app)
        .get('/api/pos-charge/default')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).to.equal(200);
      expect(res.body).to.have.length(2);
    }
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/pos-charge/default');
    expect(res.status).to.equal(401);
  });
});

describe('PUT /api/pos-charge/default/:id', () => {
  it('rejects non-admin', async () => {
    const res = await request(app)
      .put('/api/pos-charge/default/1')
      .set('Authorization', `Bearer ${franchaiseToken}`)
      .send({ percent_fee: 2.0 });
    expect(res.status).to.equal(403);
  });

  it('returns 404 for missing record', async () => {
    PosChargeDefault.findByPk = async () => null;

    const res = await request(app)
      .put('/api/pos-charge/default/999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ percent_fee: 2.0 });
    expect(res.status).to.equal(404);
  });

  it('rejects duplicate combination on update', async () => {
    const existing = {
      id: 1, payment_mode: 'CARD', payment_card_type: null, payment_card_brand: null, percent_fee: 1.5,
      update: async function(d) { Object.assign(this, d); return this; }
    };
    PosChargeDefault.findByPk = async (id) => String(id) === '1' ? existing : null;
    PosChargeDefault.findOne  = async () => ({ id: 2 }); // duplicate found

    const res = await request(app)
      .put('/api/pos-charge/default/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMode: 'CARD', percent_fee: 2.0 });
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/already exists/i);
  });

  it('updates rate successfully', async () => {
    const rec = {
      id: 1, payment_mode: 'CARD', payment_card_type: null, payment_card_brand: null, percent_fee: 1.5,
      update: async function(d) { Object.assign(this, d); return this; }
    };
    PosChargeDefault.findByPk = async () => rec;
    PosChargeDefault.findOne  = async () => null; // no duplicate

    const res = await request(app)
      .put('/api/pos-charge/default/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ percent_fee: 2.5 });
    expect(res.status).to.equal(200);
    expect(res.body.record.percent_fee).to.equal(2.5);
  });
});

describe('DELETE /api/pos-charge/default/:id', () => {
  it('rejects non-admin', async () => {
    const res = await request(app)
      .delete('/api/pos-charge/default/1')
      .set('Authorization', `Bearer ${franchaiseToken}`);
    expect(res.status).to.equal(403);
  });

  it('returns 404 for missing record', async () => {
    PosChargeDefault.findByPk = async () => null;
    const res = await request(app)
      .delete('/api/pos-charge/default/999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).to.equal(404);
  });

  it('deletes successfully', async () => {
    PosChargeDefault.findByPk = async () => ({ id: 1, destroy: async () => {} });
    const res = await request(app)
      .delete('/api/pos-charge/default/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).to.equal(200);
    expect(res.body.message).to.equal('Deleted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// USER POS CHARGE
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/pos-charge/user', () => {
  it('rejects merchant role', async () => {
    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ user_id: 9, pos_charge_default_id: 1 });
    expect(res.status).to.equal(403);
  });

  it('rejects missing user_id', async () => {
    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pos_charge_default_id: 1 });
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/user_id/i);
  });

  it('rejects when user not found', async () => {
    User.findByPk = async () => null;
    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: 999, pos_charge_default_id: 1 });
    expect(res.status).to.equal(404);
  });

  it('franchaise: rejects merchant belonging to another franchise', async () => {
    User.findByPk = async () => ({ id: 9, role: 'merchant', franchaise_id: 99 }); // different franchise

    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${franchaiseToken}`) // franchise id=5
      .send({ user_id: 9, pos_charge_default_id: 1 });
    expect(res.status).to.equal(403);
  });

  it('franchaise: rejects without pos_charge_default_id', async () => {
    User.findByPk = async () => ({ id: 9, role: 'merchant', franchaise_id: 5 });

    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${franchaiseToken}`)
      .send({ user_id: 9, percent_fee: 1.5 }); // no pos_charge_default_id
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/pos_charge_default_id/i);
  });

  it('franchaise: links merchant with existing default', async () => {
    User.findByPk        = async () => ({ id: 9, role: 'merchant', franchaise_id: 5 });
    PosChargeDefault.findByPk = async () => ({ id: 1, payment_mode: 'CARD', percent_fee: 1.5 });
    UserPosCharge.findOne = async () => null;
    UserPosCharge.create  = async (data) => ({ id: 50, ...data });

    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${franchaiseToken}`)
      .send({ user_id: 9, pos_charge_default_id: 1 });

    expect(res.status).to.equal(201);
    expect(res.body.link.user_id).to.equal(9);
    expect(res.body.link.pos_charge_default_id).to.equal(1);
  });

  it('admin: creates inline default when pos_charge_default_id not provided', async () => {
    User.findByPk         = async () => ({ id: 9, role: 'merchant', franchaise_id: 5 });
    PosChargeDefault.findOne  = async () => null; // no existing default
    PosChargeDefault.create   = async (data) => ({ id: 99, ...data });
    UserPosCharge.findOne     = async () => null;
    UserPosCharge.create      = async (data) => ({ id: 51, ...data });

    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: 9, paymentMode: 'CARD', paymentCardType: 'DEBIT', paymentCardBrand: 'RUPAY', percent_fee: 2.0 });

    expect(res.status).to.equal(201);
    expect(res.body.link.pos_charge_default_id).to.equal(99);
  });

  it('admin: returns 400 when inline creation attempted without percent_fee', async () => {
    User.findByPk = async () => ({ id: 9, role: 'merchant' });

    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: 9, paymentMode: 'CARD' }); // no pos_charge_default_id, no percent_fee
    expect(res.status).to.equal(400);
  });

  it('rejects duplicate user+default link', async () => {
    User.findByPk         = async () => ({ id: 9, role: 'merchant' });
    PosChargeDefault.findByPk = async () => ({ id: 1, payment_mode: 'CARD', percent_fee: 1.5 });
    UserPosCharge.findOne     = async () => ({ id: 50 }); // already linked

    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: 9, pos_charge_default_id: 1 });
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/already has/i);
  });

  it('admin: allows per-user percent_fee override alongside pos_charge_default_id', async () => {
    User.findByPk         = async () => ({ id: 9, role: 'merchant' });
    PosChargeDefault.findByPk = async () => ({ id: 1, percent_fee: 1.5 });
    UserPosCharge.findOne     = async () => null;
    UserPosCharge.create      = async (data) => ({ id: 55, ...data });

    const res = await request(app)
      .post('/api/pos-charge/user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: 9, pos_charge_default_id: 1, percent_fee: 0.75 });

    expect(res.status).to.equal(201);
    expect(res.body.link.percent_fee).to.equal(0.75);
  });
});

describe('GET /api/pos-charge/user', () => {
  it('merchant sees only their own records', async () => {
    UserPosCharge.findAll = async (opts) => {
      expect(opts.where.user_id).to.equal(9);
      return [{ id: 1, user_id: 9, defaultPosCharge: { percent_fee: 1.5 } }];
    };

    const res = await request(app)
      .get('/api/pos-charge/user')
      .set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).to.equal(200);
    expect(res.body).to.have.length(1);
  });

  it('franchaise: returns records for all their merchants when no user_id specified', async () => {
    User.findAll  = async () => [{ id: 9 }, { id: 10 }];
    UserPosCharge.findAll = async () => [
      { id: 1, user_id: 9 }, { id: 2, user_id: 10 }
    ];

    const res = await request(app)
      .get('/api/pos-charge/user')
      .set('Authorization', `Bearer ${franchaiseToken}`);
    expect(res.status).to.equal(200);
    expect(res.body).to.have.length(2);
  });

  it('admin can filter by user_id', async () => {
    UserPosCharge.findAll = async (opts) => {
      expect(String(opts.where.user_id)).to.equal('9');
      return [{ id: 1, user_id: 9 }];
    };

    const res = await request(app)
      .get('/api/pos-charge/user?user_id=9')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).to.equal(200);
  });
});

describe('PUT /api/pos-charge/user/:id', () => {
  it('rejects merchant role', async () => {
    const res = await request(app)
      .put('/api/pos-charge/user/1')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ percent_fee: 2.0 });
    expect(res.status).to.equal(403);
  });

  it('returns 404 for missing record', async () => {
    UserPosCharge.findByPk = async () => null;
    const res = await request(app)
      .put('/api/pos-charge/user/999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ percent_fee: 2.0 });
    expect(res.status).to.equal(404);
  });

  it('admin: updates percent_fee override', async () => {
    const rec = {
      id: 1, user_id: 9, pos_charge_default_id: 1, percent_fee: 1.5,
      save: async function() { return this; }
    };
    UserPosCharge.findByPk = async (id) => {
      if (id === 1) return rec;
      // second call for returning updated record with include
      return { ...rec, defaultPosCharge: { percent_fee: 1.5 } };
    };

    const res = await request(app)
      .put('/api/pos-charge/user/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ percent_fee: 3.0 });
    expect(res.status).to.equal(200);
  });

  it('franchaise: rejects updating charge belonging to another franchises merchant', async () => {
    UserPosCharge.findByPk = async () => ({ id: 1, user_id: 9 });
    User.findOne = async () => null; // assertFranchaiseOwnsMerchant returns null

    const res = await request(app)
      .put('/api/pos-charge/user/1')
      .set('Authorization', `Bearer ${franchaiseToken}`)
      .send({ percent_fee: 2.0 });
    expect(res.status).to.equal(403);
  });
});

describe('DELETE /api/pos-charge/user/:id', () => {
  it('rejects merchant role', async () => {
    const res = await request(app)
      .delete('/api/pos-charge/user/1')
      .set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).to.equal(403);
  });

  it('returns 404 for missing record', async () => {
    UserPosCharge.findByPk = async () => null;
    const res = await request(app)
      .delete('/api/pos-charge/user/999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).to.equal(404);
  });

  it('deletes successfully (admin)', async () => {
    UserPosCharge.findByPk = async () => ({ id: 1, destroy: async () => {} });
    const res = await request(app)
      .delete('/api/pos-charge/user/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).to.equal(200);
    expect(res.body.message).to.equal('Deleted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CALCULATE — resolution logic
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/pos-charge/calculate', () => {
  it('returns 404 when no match found', async () => {
    UserPosCharge.findAll    = async () => [];
    PosChargeDefault.findAll = async () => [];

    const res = await request(app)
      .post('/api/pos-charge/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ paymentMode: 'CARD', paymentCardType: 'CREDIT', paymentCardBrand: 'VISA' });
    expect(res.status).to.equal(404);
  });

  it('resolves from global default when no user-specific link', async () => {
    UserPosCharge.findAll = async () => [];
    PosChargeDefault.findAll = async () => [
      { id: 1, payment_mode: 'CARD', payment_card_type: null, payment_card_brand: null, percent_fee: 1.5, is_active: true }
    ];

    const res = await request(app)
      .post('/api/pos-charge/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ paymentMode: 'CARD', paymentCardType: 'DEBIT', paymentCardBrand: 'VISA', amount: 1000 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('default');
    expect(res.body.fee.fee).to.equal(15); // 1.5% of 1000
  });

  it('prefers user-specific link over global default', async () => {
    UserPosCharge.findAll = async () => [
      {
        percent_fee: null,
        defaultPosCharge: {
          id: 1, payment_mode: 'CARD', payment_card_type: 'CREDIT', payment_card_brand: 'VISA',
          percent_fee: 2.0, is_active: true,
          get: function(opts) { return opts && opts.plain ? { ...this } : this; }
        }
      }
    ];

    const res = await request(app)
      .post('/api/pos-charge/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ paymentMode: 'CARD', paymentCardType: 'CREDIT', paymentCardBrand: 'VISA', amount: 500 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('user');
    expect(res.body.fee.fee).to.equal(10); // 2% of 500
  });

  it('applies per-user percent_fee override from UserPosCharge', async () => {
    UserPosCharge.findAll = async () => [
      {
        percent_fee: 1.0, // user override
        defaultPosCharge: {
          id: 1, payment_mode: 'CARD', payment_card_type: 'CREDIT', payment_card_brand: 'VISA',
          percent_fee: 2.0, is_active: true,
          get: function(opts) { return opts && opts.plain ? { ...this } : this; }
        }
      }
    ];

    const res = await request(app)
      .post('/api/pos-charge/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ paymentMode: 'CARD', paymentCardType: 'CREDIT', paymentCardBrand: 'VISA', amount: 1000 });

    expect(res.status).to.equal(200);
    expect(res.body.source).to.equal('user');
    expect(res.body.fee.fee).to.equal(10); // 1% of 1000
  });

  it('picks most specific match: brand+type+mode wins over just mode', async () => {
    UserPosCharge.findAll = async () => [];
    PosChargeDefault.findAll = async () => [
      { id: 1, payment_mode: 'CARD', payment_card_type: null,     payment_card_brand: null,   percent_fee: 0.5, is_active: true },
      { id: 2, payment_mode: 'CARD', payment_card_type: 'CREDIT', payment_card_brand: 'VISA', percent_fee: 1.8, is_active: true }
    ];

    const res = await request(app)
      .post('/api/pos-charge/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ paymentMode: 'CARD', paymentCardType: 'CREDIT', paymentCardBrand: 'VISA', amount: 100 });

    expect(res.status).to.equal(200);
    expect(res.body.charge.id).to.equal(2);  // more specific record
    expect(res.body.fee.fee).to.equal(1.8);  // 1.8% of 100
  });

  it('returns charge without fee when amount not supplied', async () => {
    UserPosCharge.findAll = async () => [];
    PosChargeDefault.findAll = async () => [
      { id: 1, payment_mode: null, payment_card_type: null, payment_card_brand: null, percent_fee: 1.0, is_active: true }
    ];

    const res = await request(app)
      .post('/api/pos-charge/calculate')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ paymentMode: 'CARD' });

    expect(res.status).to.equal(200);
    expect(res.body.fee).to.be.null;
  });

  it('franchaise: verifies merchant ownership before calculating', async () => {
    User.findOne = async () => null; // not belonging to franchise

    const res = await request(app)
      .post('/api/pos-charge/calculate')
      .set('Authorization', `Bearer ${franchaiseToken}`)
      .send({ user_id: 9, paymentMode: 'CARD' });

    expect(res.status).to.equal(403);
  });
});
