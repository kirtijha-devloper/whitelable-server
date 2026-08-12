const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const payoutRoutes = require('../routes/payoutRoutes');
const Beneficiary = require('../models/Beneficiary');

const app = express();
app.use(express.json());
app.use('/api/payout', payoutRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500).json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken = jwt.sign({ user: { id: 1, role: 'admin' } }, SECRET);
const merchantToken = jwt.sign({ user: { id: 2, role: 'merchant' } }, SECRET);
const franchiseToken = jwt.sign({ user: { id: 3, role: 'franchaise' } }, SECRET);
const employeeToken = jwt.sign({ user: { id: 4, role: 'employee' } }, SECRET);

let findAllStub;
let findByPkStub;

beforeEach(() => {
  findAllStub = Beneficiary.findAll;
  findByPkStub = Beneficiary.findByPk;
});

afterEach(() => {
  Beneficiary.findAll = findAllStub;
  Beneficiary.findByPk = findByPkStub;
});

describe('GET /api/payout/beneficiaries', () => {
  it('returns all beneficiaries for admin', async () => {
    Beneficiary.findAll = async (options) => {
      expect(options.order).to.deep.equal([['createdAt', 'DESC']]);
      expect(options.where.status).to.exist;
      return [{ id: 1, merchant_id: 2 }];
    };

    const res = await request(app)
      .get('/api/payout/beneficiaries')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data).to.deep.equal([{ id: 1, merchant_id: 2 }]);
  });

  it('returns only merchant-owned beneficiaries for merchant', async () => {
    Beneficiary.findAll = async (options) => {
      expect(options.order).to.deep.equal([['createdAt', 'DESC']]);
      expect(options.where.merchant_id).to.equal(2);
      expect(options.where.status).to.exist;
      return [{ id: 10, merchant_id: 2 }];
    };

    const res = await request(app)
      .get('/api/payout/beneficiaries')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data).to.deep.equal([{ id: 10, merchant_id: 2 }]);
  });

  it('returns only franchise-owned beneficiaries for franshaise', async () => {
    Beneficiary.findAll = async (options) => {
      expect(options.order).to.deep.equal([['createdAt', 'DESC']]);
      expect(options.where.merchant_id).to.equal(3);
      expect(options.where.status).to.exist;
      return [{ id: 20, merchant_id: 3 }];
    };

    const res = await request(app)
      .get('/api/payout/beneficiaries')
      .set('Authorization', `Bearer ${franchiseToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data).to.deep.equal([{ id: 20, merchant_id: 3 }]);
  });

  it('returns 403 for unsupported roles', async () => {
    const res = await request(app)
      .get('/api/payout/beneficiaries')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.success).to.equal(false);
  });
});

describe('PUT /api/payout/beneficiaries/:id', () => {
  it('updates a beneficiary for the owning merchant', async () => {
    Beneficiary.findByPk = async (id) => ({
      id,
      merchant_id: 2,
      beneficiary_name: 'MD ABDULLAH',
      update: async function (data) {
        Object.assign(this, data);
        return this;
      },
    });

    const res = await request(app)
      .put('/api/payout/beneficiaries/21')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ state: 'JH', branch_name: 'N/A' });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.state).to.equal('JH');
    expect(res.body.data.branch_name).to.equal('N/A');
  });

  it('prevents a merchant from updating someone else\'s beneficiary', async () => {
    Beneficiary.findByPk = async (id) => ({
      id,
      merchant_id: 999,
      beneficiary_name: 'Other User',
      update: async function () {
        throw new Error('should not update');
      },
    });

    const res = await request(app)
      .put('/api/payout/beneficiaries/21')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ state: 'MH' });

    expect(res.status).to.equal(403);
    expect(res.body.success).to.equal(false);
  });
});

describe('POST/GET /api/payout/ndia5/callback', () => {
  it('accepts and logs POST callback requests without authentication', async () => {
    const res = await request(app)
      .post('/api/payout/ndia5/callback')
      .send({ event: 'payout.success', transactionId: '703560' });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.message).to.equal('Callback logged successfully');
  });

  it('accepts and logs GET callback requests without authentication', async () => {
    const res = await request(app)
      .get('/api/payout/ndia5/callback')
      .query({ event: 'payout.success', transactionId: '703560' });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.message).to.equal('Callback logged successfully');
  });
});
