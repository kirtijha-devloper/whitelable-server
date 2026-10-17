const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const branchxRoutes = require('../routes/payments/branchxRoutes');
const superAdminRoutes = require('../routes/superAdminRoutes');
const ServiceSetting = require('../models/ServiceSetting');
const UserServiceSetting = require('../models/UserServiceSetting');
const User = require('../models/User');

const app = express();
app.use(express.json());
// Mock domain validation middleware by adding req.company
app.use((req, res, next) => {
  req.company = 'COMP_TEST';
  next();
});
app.use('/api/payment/v2', branchxRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message, code: err.code, service_key: err.service_key });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const superAdminToken = jwt.sign({ user: { id: 99, role: 'super_admin', name: 'Super Admin' } }, SECRET);
const admin1Token = jwt.sign({ user: { id: 10, role: 'admin', name: 'Admin One', company_id: 'COMP_1' } }, SECRET);
const admin2Token = jwt.sign({ user: { id: 20, role: 'admin', name: 'Admin Two', company_id: 'COMP_2' } }, SECRET);
const merchantAdmin1Token = jwt.sign({ user: { id: 101, role: 'merchant', name: 'Merchant One', company_id: 'COMP_1' } }, SECRET);
const merchantAdmin2Token = jwt.sign({ user: { id: 201, role: 'merchant', name: 'Merchant Two', company_id: 'COMP_2' } }, SECRET);

let stubs = {};

beforeEach(() => {
  stubs = {
    serviceSettingFindAll: ServiceSetting.findAll,
    userServiceSettingFindAll: UserServiceSetting.findAll,
    userFindByPk: User.findByPk,
    userFindOne: User.findOne,
  };
});

afterEach(() => {
  ServiceSetting.findAll = stubs.serviceSettingFindAll;
  UserServiceSetting.findAll = stubs.userServiceSettingFindAll;
  User.findByPk = stubs.userFindByPk;
  User.findOne = stubs.userFindOne;
});

describe('Hierarchical Global and Admin-Specific Service Management', () => {
  describe('GET /api/super-admin/admin/:id/services (Modal Payload & State Calculation)', () => {
    it('Case 1: Global ON + Admin ON -> is_globally_disabled: false, admin_enabled: true, is_enabled: true', async () => {
      // Global: all enabled
      ServiceSetting.findAll = async () => [];
      // Admin: branchx_payout enabled (or default true)
      UserServiceSetting.findAll = async () => ([
        { user_id: 10, service_key: 'branchx_payout', is_enabled: true }
      ]);
      User.findByPk = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });
      User.findOne = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });

      const res = await request(app)
        .get('/api/super-admin/admin/10/services')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).to.equal(200);
      const branchx = res.body.data.branchx_payout;
      expect(branchx.global_enabled).to.equal(true);
      expect(branchx.is_globally_disabled).to.equal(false);
      expect(branchx.admin_enabled).to.equal(true);
      expect(branchx.is_enabled).to.equal(true);
    });

    it('Case 2: Global ON + Admin OFF -> is_globally_disabled: false, admin_enabled: false, is_enabled: false', async () => {
      ServiceSetting.findAll = async () => [];
      // Admin: branchx_payout disabled
      UserServiceSetting.findAll = async () => ([
        { user_id: 10, service_key: 'branchx_payout', is_enabled: false }
      ]);
      User.findByPk = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });
      User.findOne = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });

      const res = await request(app)
        .get('/api/super-admin/admin/10/services')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).to.equal(200);
      const branchx = res.body.data.branchx_payout;
      expect(branchx.global_enabled).to.equal(true);
      expect(branchx.is_globally_disabled).to.equal(false);
      expect(branchx.admin_enabled).to.equal(false);
      expect(branchx.is_enabled).to.equal(false);
    });

    it('Case 3: Global OFF + Admin ON -> is_globally_disabled: true, admin_enabled: true, is_enabled: false', async () => {
      // Global: branchx_payout disabled
      ServiceSetting.findAll = async () => ([
        { service_key: 'branchx_payout', is_enabled: false }
      ]);
      // Admin saved preference: enabled
      UserServiceSetting.findAll = async () => ([
        { user_id: 10, service_key: 'branchx_payout', is_enabled: true }
      ]);
      User.findByPk = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });
      User.findOne = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });

      const res = await request(app)
        .get('/api/super-admin/admin/10/services')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).to.equal(200);
      const branchx = res.body.data.branchx_payout;
      expect(branchx.global_enabled).to.equal(false);
      expect(branchx.is_globally_disabled).to.equal(true);
      expect(branchx.admin_enabled).to.equal(true); // Retains Admin preference!
      expect(branchx.is_enabled).to.equal(false);   // Effective is OFF
    });

    it('Case 4: Global OFF + Admin OFF -> is_globally_disabled: true, admin_enabled: false, is_enabled: false', async () => {
      ServiceSetting.findAll = async () => ([
        { service_key: 'branchx_payout', is_enabled: false }
      ]);
      UserServiceSetting.findAll = async () => ([
        { user_id: 10, service_key: 'branchx_payout', is_enabled: false }
      ]);
      User.findByPk = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });
      User.findOne = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });

      const res = await request(app)
        .get('/api/super-admin/admin/10/services')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).to.equal(200);
      const branchx = res.body.data.branchx_payout;
      expect(branchx.global_enabled).to.equal(false);
      expect(branchx.is_globally_disabled).to.equal(true);
      expect(branchx.admin_enabled).to.equal(false);
      expect(branchx.is_enabled).to.equal(false);
    });

    it('Case 5: Global OFF followed by ON -> Admin preference is restored', async () => {
      // Admin saved preference is true
      UserServiceSetting.findAll = async () => ([
        { user_id: 10, service_key: 'branchx_payout', is_enabled: true }
      ]);
      User.findByPk = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });
      User.findOne = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });

      // First check while Global OFF
      ServiceSetting.findAll = async () => ([
        { service_key: 'branchx_payout', is_enabled: false }
      ]);
      let res = await request(app)
        .get('/api/super-admin/admin/10/services')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.body.data.branchx_payout.is_globally_disabled).to.equal(true);
      expect(res.body.data.branchx_payout.admin_enabled).to.equal(true);
      expect(res.body.data.branchx_payout.is_enabled).to.equal(false);

      // Now Global ON again
      ServiceSetting.findAll = async () => [];
      res = await request(app)
        .get('/api/super-admin/admin/10/services')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.body.data.branchx_payout.is_globally_disabled).to.equal(false);
      expect(res.body.data.branchx_payout.admin_enabled).to.equal(true);
      expect(res.body.data.branchx_payout.is_enabled).to.equal(true); // Restored!
    });
  });

  describe('Direct API Enforcement (Transactions & Execution Paths)', () => {
    it('blocks transaction when Global is OFF, even if Admin is ON', async () => {
      ServiceSetting.findAll = async () => ([
        { service_key: 'branchx_payout', is_enabled: false }
      ]);
      UserServiceSetting.findAll = async () => ([
        { user_id: 10, service_key: 'branchx_payout', is_enabled: true }
      ]);
      User.findByPk = async (id) => ({ id, role: id === 10 ? 'admin' : 'merchant', company_id: 'COMP_1', is_payout_enabled: true });
      User.findOne = async () => ({ id: 10, role: 'admin', company_id: 'COMP_1' });

      const res = await request(app)
        .post('/api/payment/v2/payout')
        .set('Authorization', `Bearer ${merchantAdmin1Token}`)
        .send({ merchant_id: 101, amount: 100, tpin: '1234', beneficiary_id: 1 });

      expect(res.status).to.equal(403);
      expect(res.body.code).to.equal('SERVICE_DISABLED');
      expect(res.body.service_key).to.equal('branchx_payout');
    });

    it('blocks transaction for Admin 2 (OFF) while permitting Admin 1 (ON) when Global is ON', async () => {
      ServiceSetting.findAll = async () => []; // Global ON
      // Admin 1 has it ON, Admin 2 has it OFF
      const { Op } = require('sequelize');
      UserServiceSetting.findAll = async (opts) => {
        const rawUserId = opts?.where?.user_id;
        const ids = Array.isArray(rawUserId)
          ? rawUserId
          : (rawUserId && rawUserId[Op.in]) || [rawUserId];
        const res = [];
        for (const id of ids) {
          if (id === 20 || id === 201) {
            res.push({ user_id: id, service_key: 'branchx_payout', is_enabled: false });
          } else {
            res.push({ user_id: id, service_key: 'branchx_payout', is_enabled: true });
          }
        }
        return res;
      };
      User.findByPk = async (id) => {
        if (id === 20 || id === 201) return { id, role: id === 20 ? 'admin' : 'merchant', company_id: 'COMP_2', is_payout_enabled: true };
        return { id, role: id === 10 ? 'admin' : 'merchant', company_id: 'COMP_1', is_payout_enabled: true, wallet: 1000, save: async () => {} };
      };
      User.findOne = async (opts) => {
        if (opts?.where?.company_id === 'COMP_2') return { id: 20, role: 'admin', company_id: 'COMP_2' };
        return { id: 10, role: 'admin', company_id: 'COMP_1' };
      };

      // Admin 2 merchant should be blocked (403)
      const res2 = await request(app)
        .post('/api/payment/v2/payout')
        .set('Authorization', `Bearer ${merchantAdmin2Token}`)
        .send({ merchant_id: 201, amount: 100, tpin: '1234', beneficiary_id: 1 });

      expect(res2.status).to.equal(403);
      expect(res2.body.code).to.equal('SERVICE_DISABLED');

      // Admin 1 merchant should pass service check (reaches transaction execution)
      const res1 = await request(app)
        .post('/api/payment/v2/payout')
        .set('Authorization', `Bearer ${merchantAdmin1Token}`)
        .send({ merchant_id: 101, amount: 100, tpin: '1234', beneficiary_id: 1 });

      expect(res1.status).to.not.equal(403);
    });
  });
});
