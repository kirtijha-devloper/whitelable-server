const { expect } = require('chai');
const sinon = require('sinon');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const PosMachine = require('../models/posMachine');
const superFranchiseRoutes = require('../routes/superFranchiseRoutes');

const SECRET = process.env.ACCESS_TOKEN_SECRET || 'testsecret';

describe('Super Franchise Module & Routes', () => {
  let app;
  let adminToken;
  let superFranchiseToken;
  let franchiseToken;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.ACCESS_TOKEN_SECRET = SECRET;

    app = express();
    app.use(express.json());
    app.use('/api/super-franchise', superFranchiseRoutes);

    adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin', company_id: 'COMP_DEFAULT' } }, SECRET);
    superFranchiseToken = jwt.sign({ user: { id: 10, role: 'super_franchise', name: 'Super Franchise', company_id: 'COMP_DEFAULT' } }, SECRET);
    franchiseToken = jwt.sign({ user: { id: 20, role: 'franchaise', name: 'Franchise', company_id: 'COMP_DEFAULT' } }, SECRET);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('GET /api/super-franchise - lists super franchises', async () => {
    sinon.stub(User, 'findByPk').withArgs(1).resolves({ id: 1, role: 'admin', company_id: 'COMP_DEFAULT', status: 'active' });
    sinon.stub(User, 'findAndCountAll').resolves({
      count: 1,
      rows: [
        {
          id: 10,
          name: 'SF Partner',
          email: 'sf@test.com',
          role: 'super_franchise',
          company_id: 'COMP_DEFAULT',
          username: 'APSF00001'
        }
      ]
    });

    const res = await request(app)
      .get('/api/super-franchise')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data).to.be.an('array');
    expect(res.body.data[0].username).to.equal('APSF00001');
  });

  it('GET /api/super-franchise - filters by company_id for admin user', async () => {
    sinon.stub(User, 'findByPk').withArgs(1).resolves({ id: 1, role: 'admin', company_id: 'COMP_DEFAULT', status: 'active' });
    const findStub = sinon.stub(User, 'findAndCountAll').resolves({
      count: 1,
      rows: [
        {
          id: 10,
          name: 'SF Partner',
          role: 'super_franchise',
          company_id: 'COMP_DEFAULT',
          username: 'APSF00001'
        }
      ]
    });

    const res = await request(app)
      .get('/api/super-franchise')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(findStub.calledOnce).to.be.true;
    expect(findStub.firstCall.args[0].where.company_id).to.equal('COMP_DEFAULT');
  });

  it('GET /api/super-franchise/:id - returns super franchise metrics', async () => {
    sinon.stub(User, 'findByPk').withArgs(1).resolves({ id: 1, role: 'admin', company_id: 'COMP_DEFAULT', status: 'active' });
    sinon.stub(User, 'findOne').resolves({
      id: 10,
      name: 'SF Partner',
      role: 'super_franchise',
      company_id: 'COMP_DEFAULT'
    });
    sinon.stub(User, 'count')
      .onFirstCall().resolves(5) // totalFranchises
      .onSecondCall().resolves(25); // totalMerchants
    sinon.stub(PosMachine, 'count').resolves(30);

    const res = await request(app)
      .get('/api/super-franchise/10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data.metrics.totalFranchises).to.equal(5);
    expect(res.body.data.metrics.totalMerchants).to.equal(25);
    expect(res.body.data.metrics.totalPosMachines).to.equal(30);
  });

  it('PUT /api/super-franchise/assign-franchise - links franchise to super franchise', async () => {
    const fakeFranchise = {
      id: 20,
      role: 'franchaise',
      company_id: 'COMP_DEFAULT',
      super_franchise_id: null,
      save: sinon.stub().resolves()
    };
    const fakeSF = { id: 10, role: 'super_franchise', company_id: 'COMP_DEFAULT' };

    sinon.stub(User, 'findByPk')
      .withArgs(1).resolves({ id: 1, role: 'admin', company_id: 'COMP_DEFAULT', status: 'active' })
      .withArgs(20).resolves(fakeFranchise)
      .withArgs(10).resolves(fakeSF);
    sinon.stub(User, 'update').resolves([2]);

    const res = await request(app)
      .put('/api/super-franchise/assign-franchise')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ franchise_id: 20, super_franchise_id: 10 });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(fakeFranchise.super_franchise_id).to.equal(10);
  });

  it('GET /api/super-franchise/:id - rejects access to super franchise belonging to another company (403)', async () => {
    sinon.stub(User, 'findByPk').withArgs(1).resolves({ id: 1, role: 'admin', company_id: 'COMP_DEFAULT', status: 'active' });
    sinon.stub(User, 'findOne').resolves({
      id: 99,
      name: 'Other SF',
      role: 'super_franchise',
      company_id: 'COMP_OTHER'
    });

    const res = await request(app)
      .get('/api/super-franchise/99')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.success).to.be.false;
    expect(res.body.message).to.include('Super Franchise does not belong to your company');
  });

  it('PUT /api/super-franchise/assign-franchise - rejects cross-company assignment (403)', async () => {
    const fakeFranchise = {
      id: 20,
      role: 'franchaise',
      company_id: 'COMP_DEFAULT',
      super_franchise_id: null,
      save: sinon.stub().resolves()
    };
    const otherSF = { id: 99, role: 'super_franchise', company_id: 'COMP_OTHER' };

    sinon.stub(User, 'findByPk')
      .withArgs(1).resolves({ id: 1, role: 'admin', company_id: 'COMP_DEFAULT', status: 'active' })
      .withArgs(20).resolves(fakeFranchise)
      .withArgs(99).resolves(otherSF);

    const res = await request(app)
      .put('/api/super-franchise/assign-franchise')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ franchise_id: 20, super_franchise_id: 99 });

    expect(res.status).to.equal(403);
    expect(res.body.success).to.be.false;
    expect(res.body.message).to.include('Super Franchise does not belong to your company');
  });
});
