const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const adminRoutes = require('../routes/adminRoutes');
const User = require('../models/User');

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);
app.use('/api/admin', adminRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ success: false, message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin' } }, SECRET);

describe('POS Setting API Endpoints', () => {
  let testUser;

  before(async () => {
    testUser = await User.findOne({ where: { role: 'merchant' } });
    if (!testUser) {
      testUser = await User.create({
        name: 'Test Merchant POS',
        email: 'testposmerchant@example.com',
        password: 'hashedpassword',
        role: 'merchant',
        settlement_type: 'T0',
        t0_daily_limit: 100000
      });
    }
  });

  it('GET /admin/pos-setting should return list of users with t0_daily_limit and settlement_type', async () => {
    const res = await request(app)
      .get('/admin/pos-setting')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    const list = Array.isArray(res.body.data) ? res.body.data : res.body.data.merchants;
    expect(list).to.be.an('array');
    if (list.length > 0) {
      const userObj = list[0];
      expect(userObj).to.have.property('id');
      expect(userObj).to.have.property('settlement_type');
      expect(userObj).to.have.property('t0_daily_limit');
    }
  });

  it('GET /admin/pg-setting should also return list of users with t0_daily_limit and settlement_type', async () => {
    const res = await request(app)
      .get('/admin/pg-setting')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    const list = Array.isArray(res.body.data) ? res.body.data : res.body.data.merchants;
    expect(list).to.be.an('array');
  });

  it('POST /admin/pos-setting/update-t0-limit should update user t0_daily_limit', async () => {
    const res = await request(app)
      .post('/admin/pos-setting/update-t0-limit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: testUser.id, t0_daily_limit: 75000 });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(Number(res.body.data.t0_daily_limit)).to.equal(75000);

    const updated = await User.findByPk(testUser.id);
    expect(Number(updated.t0_daily_limit)).to.equal(75000);
  });

  it('POST /admin/pos-setting/update-t0-limit with null should unassign limit', async () => {
    const res = await request(app)
      .post('/admin/pos-setting/update-t0-limit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: testUser.id, t0_daily_limit: null });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.t0_daily_limit).to.equal(null);
  });

  it('POST /admin/pos-setting/update-settlement-type should update settlement type to T1 and T0', async () => {
    const resT1 = await request(app)
      .post('/admin/pos-setting/update-settlement-type')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: testUser.id, settlement_type: 'T1' });

    expect(resT1.status).to.equal(200);
    expect(resT1.body.success).to.equal(true);
    expect(resT1.body.data.settlement_type).to.equal('T1');

    const resT0 = await request(app)
      .post('/admin/pos-setting/update-settlement-type')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: testUser.id, settlement_type: 'T0' });

    expect(resT0.status).to.equal(200);
    expect(resT0.body.success).to.equal(true);
    expect(resT0.body.data.settlement_type).to.equal('T0');
  });
});
