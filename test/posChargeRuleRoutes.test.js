const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const posChargeRuleRoutes = require('../routes/posChargeRuleRoutes');
const PosChargeRule = require('../models/PosChargeRule');
const User = require('../models/User');

const app = express();
app.use(express.json());
app.use('/api/pos-charge-rules', posChargeRuleRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
     .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken = jwt.sign({ user: { id: 1, role: 'admin' } }, SECRET);
const franToken  = jwt.sign({ user: { id: 5, role: 'franchaise' } }, SECRET);
const merchToken = jwt.sign({ user: { id: 9, role: 'merchant' } }, SECRET);

let stubs = {};
beforeEach(() => {
  stubs = {
    findAll: PosChargeRule.findAll,
    findAndCountAll: PosChargeRule.findAndCountAll,
    findByPk: PosChargeRule.findByPk
  };
});
afterEach(() => {
  PosChargeRule.findAll = stubs.findAll;
  PosChargeRule.findAndCountAll = stubs.findAndCountAll;
  PosChargeRule.findByPk = stubs.findByPk;
});

describe('franchise helper lists', () => {
  it('admin list returns global defaults and non-owned franchise rules', async () => {
    // simulate two rules: one global, one franchise-owned by someone else
    PosChargeRule.findAndCountAll = async ({ where }) => {
      // expect the OR clause structure
      return { count: 2, rows: [
        { id: 1, franchaise_id: null },
        { id: 2, franchaise_id: 5, created_by: 99 }
      ] };
    };

    const res = await request(app)
      .get('/api/pos-charge-rules/list/admin')
      .set('Authorization', `Bearer ${franToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data).to.have.length(2);
  });

  it('custom list only returns rules created by the franchise', async () => {
    PosChargeRule.findAndCountAll = async ({ where }) => {
      expect(where.created_by).to.equal(5);
      return { count: 1, rows: [{ id: 10, franchaise_id: 5, created_by: 5 }] };
    };

    const res = await request(app)
      .get('/api/pos-charge-rules/list/franchise')
      .set('Authorization', `Bearer ${franToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data[0].id).to.equal(10);

    // verify that non-franchise cannot call these endpoints
    const bad1 = await request(app)
      .get('/api/pos-charge-rules/list/admin')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bad1.status).to.equal(403);

    const bad2 = await request(app)
      .get('/api/pos-charge-rules/list/franchise')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bad2.status).to.equal(403);
  });

  it('franchise cannot update a rule they did not create', async () => {
    const existing = { id: 20, franchaise_id: 5, created_by: 99, update: async () => {} };
    PosChargeRule.findByPk = async () => existing;

    const res = await request(app)
      .put('/api/pos-charge-rules/20')
      .set('Authorization', `Bearer ${franToken}`)
      .send({ charge_percent: 2.0 });

    expect(res.status).to.equal(403);
  });

  it('franchise cannot delete a rule they did not create', async () => {
    const existing = { id: 21, franchaise_id: 5, created_by: null, destroy: async () => {} };
    PosChargeRule.findByPk = async () => existing;

    const res = await request(app)
      .delete('/api/pos-charge-rules/21')
      .set('Authorization', `Bearer ${franToken}`);

    expect(res.status).to.equal(403);
  });
});
