const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const adminRoutes = require('../routes/adminRoutes');
const ServiceSetting = require('../models/ServiceSetting');
const UserServiceSetting = require('../models/UserServiceSetting');
const User = require('../models/User');
const db = require('../config/database');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin' } }, SECRET);
const employeeToken = jwt.sign({ user: { id: 2, role: 'employee', name: 'Employee' } }, SECRET);
const employeeUserServiceSettingsToken = jwt.sign({
  user: {
    id: 3,
    role: 'employee',
    name: 'Service Settings Employee',
    employee_access_role_id: 5,
    employee_access_role: {
      id: 5,
      name: 'Service Settings Manager',
      slug: 'service-settings-manager',
      status: 'active',
      permissions: [EMPLOYEE_PERMISSIONS.USERS_SERVICE_SETTINGS_MANAGE],
    },
  },
}, SECRET);

function makeSetting(serviceKey, overrides = {}) {
  return {
    service_key: serviceKey,
    is_enabled: true,
    updated_by: null,
    updatedAt: new Date('2026-04-07T10:00:00Z'),
    ...overrides,
  };
}

let stubs = {};

beforeEach(() => {
  stubs = {
    serviceSettingFindAll: ServiceSetting.findAll,
    serviceSettingUpsert: ServiceSetting.upsert,
    userServiceSettingFindAll: UserServiceSetting.findAll,
    userServiceSettingUpsert: UserServiceSetting.upsert,
    userFindByPk: User.findByPk,
    dbTransaction: db.transaction,
  };
});

afterEach(() => {
  ServiceSetting.findAll = stubs.serviceSettingFindAll;
  ServiceSetting.upsert = stubs.serviceSettingUpsert;
  UserServiceSetting.findAll = stubs.userServiceSettingFindAll;
  UserServiceSetting.upsert = stubs.userServiceSettingUpsert;
  User.findByPk = stubs.userFindByPk;
  db.transaction = stubs.dbTransaction;
});

describe('GET /api/admin/service-settings', () => {
  it('returns the fixed settings map with metadata', async () => {
    ServiceSetting.findAll = async () => ([
      makeSetting('vimo_payout', { is_enabled: false, updated_by: 12 }),
      makeSetting('branchx_payout', { updated_by: 9 }),
      makeSetting('cc_bill_pay'),
      makeSetting('ba_cc_bill_pay', { is_enabled: false }),
      makeSetting('cc_bill_3'),
    ]);

    const res = await request(app)
      .get('/api/admin/service-settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.vimo_payout.is_enabled).to.equal(false);
    expect(res.body.data.vimo_payout.updated_by).to.equal(12);
    expect(res.body.data.vimo_payout.updated_at).to.exist;
    expect(res.body.data.branchx_payout.is_enabled).to.equal(true);
    expect(res.body.data.cc_bill_pay).to.have.property('is_enabled');
    expect(res.body.data.ba_cc_bill_pay.is_enabled).to.equal(false);
    expect(res.body.data.cc_bill_3.is_enabled).to.equal(true);
  });
});

describe('PUT /api/admin/service-settings', () => {
  it('updates only the provided keys and returns the refreshed map', async () => {
    const upsertCalls = [];

    ServiceSetting.upsert = async (payload) => {
      upsertCalls.push(payload);
      return [payload, true];
    };
    ServiceSetting.findAll = async () => ([
      makeSetting('vimo_payout', { is_enabled: false, updated_by: 1 }),
      makeSetting('branchx_payout', { updated_by: 1 }),
      makeSetting('cc_bill_pay', { is_enabled: false, updated_by: 1 }),
      makeSetting('ba_cc_bill_pay'),
    ]);

    const res = await request(app)
      .put('/api/admin/service-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vimo_payout: false,
        cc_bill_pay: false,
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.vimo_payout.is_enabled).to.equal(false);
    expect(res.body.data.cc_bill_pay.is_enabled).to.equal(false);
    expect(res.body.data.vimo_payout.updated_by).to.equal(1);
    expect(upsertCalls).to.have.length(2);
    expect(upsertCalls.map((call) => call.service_key)).to.deep.equal(['vimo_payout', 'cc_bill_pay']);
    expect(upsertCalls.every((call) => call.updated_by === 1)).to.equal(true);
  });
});

describe('PUT /api/admin/user/:id/service-settings', () => {
  it('updates user-specific settings, returns expanded booleans, and syncs legacy payout flag', async () => {
    const upsertCalls = [];
    const targetUser = {
      id: 22,
      role: 'merchant',
      is_payout_enabled: true,
      save: async function () {
        return this;
      },
      toJSON() {
        return {
          id: this.id,
          role: this.role,
          is_payout_enabled: this.is_payout_enabled,
        };
      },
    };

    db.transaction = async (handler) => handler({});
    User.findByPk = async () => targetUser;
    UserServiceSetting.findAll = async () => ([
      { user_id: 22, service_key: 'vimo_payout', is_enabled: true },
      { user_id: 22, service_key: 'branchx_payout', is_enabled: true },
    ]);
    UserServiceSetting.upsert = async (payload) => {
      upsertCalls.push(payload);
      return [payload, true];
    };
    ServiceSetting.findAll = async () => ([
      makeSetting('branchx_payout', { is_enabled: false, updated_by: 1 }),
    ]);

    const res = await request(app)
      .put('/api/admin/user/22/service-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vimo_payout: false,
        branchx_payout: false,
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data).to.deep.equal({
      user_id: 22,
      user_service_settings: {
        vimo_payout: false,
        branchx_payout: false,
        sevenpay_payout: true,
        cc_bill_pay: true,
        ba_cc_bill_pay: true,
        cc_bill_3: true,
      },
      service_flags: {
        vimo_payout: false,
        branchx_payout: false,
        sevenpay_payout: true,
        cc_bill_pay: true,
        ba_cc_bill_pay: true,
        cc_bill_3: true,
      },
    });
    expect(targetUser.is_payout_enabled).to.equal(true);
    expect(upsertCalls).to.have.length(2);
    expect(upsertCalls.every((call) => call.user_id === 22)).to.equal(true);
    expect(upsertCalls.map((call) => call.service_key)).to.deep.equal(['vimo_payout', 'branchx_payout']);
  });

  it('rejects non-admin callers', async () => {
    const res = await request(app)
      .put('/api/admin/user/22/service-settings')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ vimo_payout: false });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to manage user service settings/i);
  });

  it('allows an employee with users.service_settings.manage permission', async () => {
    const upsertCalls = [];
    const targetUser = {
      id: 22,
      role: 'merchant',
      is_payout_enabled: true,
      save: async function () {
        return this;
      },
      toJSON() {
        return {
          id: this.id,
          role: this.role,
          is_payout_enabled: this.is_payout_enabled,
        };
      },
    };

    db.transaction = async (handler) => handler({});
    User.findByPk = async () => targetUser;
    UserServiceSetting.findAll = async () => [];
    UserServiceSetting.upsert = async (payload) => {
      upsertCalls.push(payload);
      return [payload, true];
    };
    ServiceSetting.findAll = async () => [];

    const res = await request(app)
      .put('/api/admin/user/22/service-settings')
      .set('Authorization', `Bearer ${employeeUserServiceSettingsToken}`)
      .send({
        vimo_payout: false,
        cc_bill_pay: false,
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data).to.deep.equal({
      user_id: 22,
      user_service_settings: {
        vimo_payout: false,
        branchx_payout: true,
        sevenpay_payout: true,
        cc_bill_pay: false,
        ba_cc_bill_pay: true,
        cc_bill_3: true,
      },
      service_flags: {
        vimo_payout: false,
        branchx_payout: true,
        sevenpay_payout: true,
        cc_bill_pay: false,
        ba_cc_bill_pay: true,
        cc_bill_3: true,
      },
    });
    expect(upsertCalls.map((call) => call.service_key)).to.deep.equal(['vimo_payout', 'cc_bill_pay']);
    expect(upsertCalls.every((call) => call.updated_by === 3)).to.equal(true);
  });

  it('rejects unsupported target roles', async () => {
    db.transaction = async (handler) => handler({});
    User.findByPk = async () => ({
      id: 7,
      role: 'employee',
      is_payout_enabled: true,
    });

    const res = await request(app)
      .put('/api/admin/user/7/service-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vimo_payout: false });

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/merchant and franchise users/i);
  });
});
