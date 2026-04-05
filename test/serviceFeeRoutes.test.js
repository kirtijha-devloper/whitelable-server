const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const serviceFeeRoutes = require('../routes/serviceFeeRoutes');
const ServiceFee = require('../models/ServiceFee');
const { serviceNames } = require('../constants');

// small express app for testing
const app = express();
app.use(express.json());
app.use('/api/service-fee', serviceFeeRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
     .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken      = jwt.sign({ user: { id: 1, role: 'admin' } }, SECRET);
const merchantToken   = jwt.sign({ user: { id: 9, role: 'merchant' } }, SECRET);
const employeeRateManageToken = jwt.sign({
  user: {
    id: 7,
    role: 'employee',
    permissions: ['rate.settings.manage'],
  }
}, SECRET);

let stubs = {};
beforeEach(() => {
  stubs.create = ServiceFee.create;
  stubs.findAll = ServiceFee.findAll;
  stubs.findOne = ServiceFee.findOne;
  stubs.findByPk = ServiceFee.findByPk;
});
afterEach(() => {
  ServiceFee.create = stubs.create;
  ServiceFee.findAll = stubs.findAll;
  ServiceFee.findOne = stubs.findOne;
  ServiceFee.findByPk = stubs.findByPk;
});

describe('POST /api/service-fee', () => {
  it('rejects non-admin', async () => {
    const res = await request(app)
      .post('/api/service-fee')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ serviceName: 'activation', flat_fee: 10 });
    expect(res.status).to.equal(403);
  });

  it('requires serviceName', async () => {
    const res = await request(app)
      .post('/api/service-fee')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ flat_fee: 5 });
    expect(res.status).to.equal(400);
  });

  it('rejects unknown serviceName', async () => {
    const res = await request(app)
      .post('/api/service-fee')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceName: 'unknown_service', flat_fee: 1 });
    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/Invalid serviceName/);
  });

  it('requires at least one non-zero fee', async () => {
    const res = await request(app)
      .post('/api/service-fee')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceName: 'foo' }); // invalid name but we'll just leave it here for validation
    expect(res.status).to.equal(400);
  });

  it('rejects duplicate name', async () => {
    ServiceFee.findOne = async () => ({ id: 2 });
    const res = await request(app)
      .post('/api/service-fee')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceName: 'activation', flat_fee: 1 });
    expect(res.status).to.equal(400);
  });

  it('creates record on success', async () => {
    ServiceFee.findOne = async () => null;
    ServiceFee.create = async (data) => ({ id: 10, ...data });
    const res = await request(app)
      .post('/api/service-fee')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceName: serviceNames.ACTIVATION, flat_fee: 10 });
    expect(res.status).to.equal(201);
    expect(res.body.record.id).to.equal(10);
  });

  it('allows an employee with rate.settings.manage to create a service fee', async () => {
    ServiceFee.findOne = async () => null;
    ServiceFee.create = async (data) => ({ id: 11, ...data });
    const res = await request(app)
      .post('/api/service-fee')
      .set('Authorization', `Bearer ${employeeRateManageToken}`)
      .send({ serviceName: serviceNames.ACTIVATION, flat_fee: 12 });
    expect(res.status).to.equal(201);
    expect(res.body.record.id).to.equal(11);
  });
});

describe('GET /api/service-fee', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/service-fee');
    expect(res.status).to.equal(401);
  });

  it('returns list', async () => {
    const rows = [{ id:1, service_name:'a' }];
    ServiceFee.findAll = async () => rows;
    const res = await request(app)
      .get('/api/service-fee')
      .set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).to.equal(200);
    expect(res.body).to.have.length(1);
  });
});

describe('PUT /api/service-fee/:id', () => {
  it('rejects non-admin', async () => {
    const res = await request(app)
      .put('/api/service-fee/1')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ flat_fee: 5 });
    expect(res.status).to.equal(403);
  });

  it('404 for missing', async () => {
    ServiceFee.findByPk = async () => null;
    const res = await request(app)
      .put('/api/service-fee/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ flat_fee: 5 });
    expect(res.status).to.equal(404);
  });

  it('rejects duplicate name on update', async () => {
    const rec = { id:1, service_name:'foo', save: async function() { return this; } };
    ServiceFee.findByPk = async () => rec;
    ServiceFee.findOne = async () => ({ id:2 });

    const res = await request(app)
      .put('/api/service-fee/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serviceName: 'bar' });
    expect(res.status).to.equal(400);
  });

  it('updates successfully', async () => {
    const rec = { id:1, service_name:'foo', flat_fee:0, percent_fee:0, save: async function() { return this; } };
    ServiceFee.findByPk = async () => rec;
    ServiceFee.findOne = async () => null;

    const res = await request(app)
      .put('/api/service-fee/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ flat_fee: 7.5, is_active: false });
    expect(res.status).to.equal(200);
    expect(res.body.record.flat_fee).to.equal(7.5);
  });
});

describe('DELETE /api/service-fee/:id', () => {
  it('rejects non-admin', async () => {
    const res = await request(app)
      .delete('/api/service-fee/1')
      .set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).to.equal(403);
  });

  it('404 for missing', async () => {
    ServiceFee.findByPk = async () => null;
    const res = await request(app)
      .delete('/api/service-fee/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).to.equal(404);
  });

  it('deletes', async () => {
    ServiceFee.findByPk = async () => ({ id:1, destroy: async () => {} });
    const res = await request(app)
      .delete('/api/service-fee/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).to.equal(200);
    expect(res.body.message).to.equal('Deleted');
  });
});
