const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const sinon = require('sinon');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const adminRoutes = require('../routes/adminRoutes');
const User = require('../models/User');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');
const serviceSettingsService = require('../services/serviceSettingsService');

const app = express();
app.use(bodyParser.json());
app.use('/api/admin', adminRoutes);

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken = jwt.sign({ user: { id: 1, role: 'admin', email: 'admin@example.com' } }, SECRET);
const makeEmployeeToken = (id, permissions) => jwt.sign({
  user: {
    id,
    role: 'employee',
    employee_access_role: {
      id,
      name: 'Settlement Role',
      slug: 'settlement-role',
      status: 'active',
      permissions,
    },
  },
}, SECRET);
const settlementReadToken = makeEmployeeToken(2, ['settlement.read']);
const settlementManageToken = makeEmployeeToken(3, ['settlement.manage']);
const noSettlementPermissionToken = makeEmployeeToken(4, []);

describe('POS Settlement Admin Endpoints Tests', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /api/admin/pos-setting', () => {
    it('should return merchants list and summary statistics', async () => {
      const mockMerchants = [
        {
          id: 101,
          name: 'Merchant 1',
          email: 'm1@example.com',
          role: 'merchant',
          status: 'active',
          settlement_type: 'T0',
          t0_daily_limit: 50000,
          toJSON: () => ({
            id: 101,
            name: 'Merchant 1',
            email: 'm1@example.com',
            role: 'merchant',
            status: 'active',
            settlement_type: 'T0',
            t0_daily_limit: 50000,
          })
        },
        {
          id: 102,
          name: 'Merchant 2',
          email: 'm2@example.com',
          role: 'merchant',
          status: 'active',
          settlement_type: 'T1',
          t0_daily_limit: null,
          toJSON: () => ({
            id: 102,
            name: 'Merchant 2',
            email: 'm2@example.com',
            role: 'merchant',
            status: 'active',
            settlement_type: 'T1',
            t0_daily_limit: null,
          })
        },
        {
          id: 103,
          name: 'Super Franchise',
          email: 'sf@example.com',
          role: 'super_franchise',
          status: 'active',
          settlement_type: 'T1',
          t0_daily_limit: 90000,
          toJSON: () => ({
            id: 103,
            name: 'Super Franchise',
            email: 'sf@example.com',
            role: 'super_franchise',
            status: 'active',
            settlement_type: 'T1',
            t0_daily_limit: 90000,
          }),
        },
        {
          id: 104,
          name: 'Legacy User Account',
          email: 'legacy@example.com',
          role: 'user',
          status: 'active',
          settlement_type: 'T0',
          t0_daily_limit: 25000,
          toJSON: () => ({
            id: 104,
            name: 'Legacy User Account',
            email: 'legacy@example.com',
            role: 'user',
            status: 'active',
            settlement_type: 'T0',
            t0_daily_limit: 25000,
          }),
        }
      ];

      const findAllStub = sandbox.stub(User, 'findAll').resolves(mockMerchants);

      const res = await request(app)
        .get('/api/admin/pos-setting')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.summary.t0_active_count).to.equal(2);
      expect(res.body.data.summary.t1_active_count).to.equal(1);
      expect(res.body.data.summary.total_merchants).to.equal(2);
      expect(res.body.data.summary.total_customers).to.equal(4);
      expect(res.body.data.merchants.length).to.equal(2);
      expect(res.body.data.customers.map((customer) => customer.id)).to.deep.equal([101, 102, 103, 104]);
      expect(findAllStub.firstCall.args[0].order).to.deep.equal([['id', 'ASC']]);
    });

    it('allows settlement.read employees to read the complete Settlement response from both URLs', async () => {
      const mockCustomers = [
        { id: 101, name: 'Merchant 1', role: 'merchant', status: 'active', settlement_type: 'T0', t0_daily_limit: 50000 },
        { id: 102, name: 'Merchant 2', role: 'franchaise', status: 'active', settlement_type: 'T1', t0_daily_limit: null },
        { id: 103, name: 'Super Franchise', role: 'super_franchise', status: 'active', settlement_type: 'T1', t0_daily_limit: 90000 },
        { id: 104, name: 'Legacy User Account', role: 'user', status: 'active', settlement_type: 'T0', t0_daily_limit: 25000 },
      ];
      const findAllStub = sandbox.stub(User, 'findAll').resolves(mockCustomers);
      sandbox.stub(serviceSettingsService, 'getServiceFlagValue').resolves(true);

      for (const token of [settlementReadToken, settlementManageToken]) {
        for (const path of ['/api/admin/pos-setting', '/api/admin/pg-setting']) {
          const res = await request(app)
            .get(path)
            .set('Authorization', `Bearer ${token}`);

          expect(res.status).to.equal(200);
          expect(res.body.success).to.equal(true);
          expect(res.body.data.summary.total_merchants).to.equal(2);
          expect(res.body.data.summary.total_customers).to.equal(4);
          expect(res.body.data.customers.map((customer) => customer.id)).to.deep.equal([101, 102, 103, 104]);
          expect(res.body.data.customers[0]).to.include({ settlement_type: 'T0', t0_daily_limit: 50000 });
          expect(findAllStub.lastCall.args[0].order).to.deep.equal([['createdAt', 'DESC']]);
        }
      }
    });

    it('denies employees without Settlement permissions', async () => {
      const res = await request(app)
        .get('/api/admin/pos-setting')
        .set('Authorization', `Bearer ${noSettlementPermissionToken}`);

      expect(res.status).to.equal(403);
      expect(res.body.message).to.match(/permission to view settlement/i);
    });

    it('keeps settlement.read employees read-only on all POS mutation routes', async () => {
      const routes = [
        ['/api/admin/pos-setting/update-t0-limit', { id: 101, t0_daily_limit: 60000 }],
        ['/api/admin/pos-setting/update-settlement-type', { id: 101, settlement_type: 'T1' }],
        ['/api/admin/pos-setting/bulk-settlement', { settlement_type: 'T1' }],
      ];

      for (const [path, body] of routes) {
        const res = await request(app)
          .post(path)
          .set('Authorization', `Bearer ${settlementReadToken}`)
          .send(body);

        expect(res.status).to.equal(403);
        expect(res.body.message).to.match(/permission to manage settlement/i);
      }
    });

    it('allows settlement.manage employees to update T0 limits and settlement modes', async () => {
      const mockUser = {
        id: 101,
        role: 'merchant',
        franchaise_id: null,
        t0_daily_limit: null,
        settlement_type: 'T1',
        save: sandbox.stub().resolves(true),
      };
      sandbox.stub(User, 'findByPk').resolves(mockUser);
      sandbox.stub(User, 'update').resolves([1]);
      sandbox.stub(ServiceToggleAuditLog, 'create').resolves({});
      sandbox.stub(serviceSettingsService, 'getServiceFlagValue').resolves(true);

      const limitRes = await request(app)
        .post('/api/admin/pos-setting/update-t0-limit')
        .set('Authorization', `Bearer ${settlementManageToken}`)
        .send({ id: 101, t0_daily_limit: 60000 });
      const modeRes = await request(app)
        .post('/api/admin/pos-setting/update-settlement-type')
        .set('Authorization', `Bearer ${settlementManageToken}`)
        .send({ id: 101, settlement_type: 'T0' });
      const bulkRes = await request(app)
        .post('/api/admin/pos-setting/bulk-settlement')
        .set('Authorization', `Bearer ${settlementManageToken}`)
        .send({ settlement_type: 'T1' });

      expect(limitRes.status).to.equal(200);
      expect(modeRes.status).to.equal(200);
      expect(bulkRes.status).to.equal(200);
    });
  });

  describe('POST /api/admin/pos-setting/update-t0-limit', () => {
    it('should update t0_daily_limit for user', async () => {
      const mockUser = {
        id: 101,
        t0_daily_limit: null,
        save: sandbox.stub().resolves(true)
      };

      sandbox.stub(User, 'findByPk').resolves(mockUser);

      const res = await request(app)
        .post('/api/admin/pos-setting/update-t0-limit')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: 101, t0_daily_limit: 75000 });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(mockUser.t0_daily_limit).to.equal(75000);
      expect(mockUser.save.calledOnce).to.be.true;
    });

    it('should allow setting t0_daily_limit to null for unlimited', async () => {
      const mockUser = {
        id: 101,
        t0_daily_limit: 50000,
        save: sandbox.stub().resolves(true)
      };

      sandbox.stub(User, 'findByPk').resolves(mockUser);

      const res = await request(app)
        .post('/api/admin/pos-setting/update-t0-limit')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: 101, t0_daily_limit: null });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(mockUser.t0_daily_limit).to.be.null;
    });

    it('should update t0_daily_limit using user_id and amount keys', async () => {
      const mockUser = {
        id: 102,
        t0_daily_limit: null,
        save: sandbox.stub().resolves(true)
      };

      sandbox.stub(User, 'findByPk').resolves(mockUser);

      const res = await request(app)
        .post('/api/admin/pos-setting/update-t0-limit')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ user_id: 102, amount: 60000 });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(mockUser.t0_daily_limit).to.equal(60000);
    });

    it('should support bulk excel upload array with user_id and amount', async () => {
      const mockUser1 = { id: 101, t0_daily_limit: null, save: sandbox.stub().resolves(true) };
      const mockUser2 = { id: 102, t0_daily_limit: null, save: sandbox.stub().resolves(true) };

      sandbox.stub(User, 'findByPk').callsFake(async (id) => {
        if (id === 101) return mockUser1;
        if (id === 102) return mockUser2;
        return null;
      });

      const res = await request(app)
        .post('/api/admin/pos-setting/update-t0-limit')
        .set('Authorization', `Bearer ${adminToken}`)
        .send([
          { user_id: 101, amount: 50000 },
          { user_id: 102, amount: 75000 }
        ]);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.updated_count).to.equal(2);
      expect(mockUser1.t0_daily_limit).to.equal(50000);
      expect(mockUser2.t0_daily_limit).to.equal(75000);
    });
  });

  describe('POST /api/admin/pos-setting/update-settlement-type', () => {
    it('should update settlement_type for user', async () => {
      const mockUser = {
        id: 101,
        role: 'merchant',
        settlement_type: 'T1',
        save: sandbox.stub().resolves(true)
      };

      sandbox.stub(User, 'findByPk').resolves(mockUser);

      const res = await request(app)
        .post('/api/admin/pos-setting/update-settlement-type')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: 101, settlement_type: 'T0' });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(mockUser.settlement_type).to.equal('T0');
    });
  });

  describe('POST /api/admin/pos-setting/bulk-settlement', () => {
    it('should bulk update settlement_type for all merchants', async () => {
      sandbox.stub(User, 'update').resolves([5]);

      const res = await request(app)
        .post('/api/admin/pos-setting/bulk-settlement')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settlement_type: 'T0' });

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.updated_count).to.equal(5);
    });
  });
});
