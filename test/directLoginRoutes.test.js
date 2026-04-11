const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const directLoginRoutes = require('../routes/directLoginRoutes');
const DirectLoginToken = require('../models/DirectLoginToken');
const EmployeeAccessRole = require('../models/EmployeeAccessRole');
const User = require('../models/User');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');

const app = express();
app.use(express.json({ strict: false }));
app.use('/api/auth', directLoginRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

describe('direct login employee impersonation support', () => {
  let originalFindToken;
  let originalCreateToken;
  let originalDestroyToken;
  let originalFindUser;
  let originalFindUserByPk;
  let originalEmployeeAccessRoleFindByPk;
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin' } }, secret);
  const employeeImpersonateToken = jwt.sign({
    user: {
      id: 7,
      role: 'employee',
      name: 'Ops Employee',
      employee_access_role_id: 3,
      employee_access_role: {
        id: 3,
        name: 'Ops',
        slug: 'ops',
        status: 'active',
        permissions: [EMPLOYEE_PERMISSIONS.USERS_IMPERSONATE],
      },
    },
  }, secret);
  const employeeNoImpersonateToken = jwt.sign({
    user: {
      id: 8,
      role: 'employee',
      name: 'Viewer Employee',
      employee_access_role_id: 4,
      employee_access_role: {
        id: 4,
        name: 'Viewer',
        slug: 'viewer',
        status: 'active',
        permissions: [],
      },
    },
  }, secret);

  beforeEach(() => {
    originalFindToken = DirectLoginToken.findOne;
    originalCreateToken = DirectLoginToken.create;
    originalDestroyToken = DirectLoginToken.destroy;
    originalFindUser = User.findOne;
    originalFindUserByPk = User.findByPk;
    originalEmployeeAccessRoleFindByPk = EmployeeAccessRole.findByPk;
  });

  afterEach(() => {
    DirectLoginToken.findOne = originalFindToken;
    DirectLoginToken.create = originalCreateToken;
    DirectLoginToken.destroy = originalDestroyToken;
    User.findOne = originalFindUser;
    User.findByPk = originalFindUserByPk;
    EmployeeAccessRole.findByPk = originalEmployeeAccessRoleFindByPk;
  });

  it('allows an employee with users.impersonate permission to generate a direct-login token', async () => {
    let destroyWhere = null;
    let createdPayload = null;

    DirectLoginToken.destroy = async ({ where }) => {
      destroyWhere = where;
      return 0;
    };
    DirectLoginToken.create = async (payload) => {
      createdPayload = payload;
      return { id: 1, ...payload };
    };

    const res = await request(app)
      .post('/api/auth/dl-token')
      .set('Authorization', `Bearer ${employeeImpersonateToken}`);

    expect(res.status).to.equal(201);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.dl_token).to.be.a('string').and.to.have.length.greaterThan(10);
    expect(destroyWhere).to.deep.equal({ admin_id: 7 });
    expect(createdPayload.admin_id).to.equal(7);
  });

  it('rejects direct-login token generation for an employee without impersonation permission', async () => {
    const res = await request(app)
      .post('/api/auth/dl-token')
      .set('Authorization', `Bearer ${employeeNoImpersonateToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to manage impersonation login/i);
  });

  it('allows an admin direct-login token to open an employee account', async () => {
    DirectLoginToken.findOne = async () => ({
      admin_id: 1,
      used_user_ids: '[]',
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
    });
    User.findByPk = async (id) => {
      expect(id).to.equal(1);
      return {
        id: 1,
        name: 'Admin',
        mobile_number: '9000000000',
        role: 'admin',
        status: 'active',
        employee_access_role_id: null,
      };
    };

    User.findOne = async ({ where }) => {
      expect(where.id).to.equal(7);
      return {
        id: 7,
        name: 'Ops Employee',
        mobile_number: '9000000001',
        role: 'employee',
        status: 'active',
        abheepay_id: 'APE00001',
        organization_name: 'ABHEEPAY',
      };
    };

    const res = await request(app)
      .post('/api/auth/direct-login')
      .send({
        dl_token: 'raw-direct-login-token',
        user_id: 7,
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.user.role).to.equal('employee');

    const decoded = jwt.verify(res.body.token, process.env.ACCESS_TOKEN_SECRET);
    expect(decoded.user.role).to.equal('employee');
    expect(decoded.user.id).to.equal(7);
  });

  it('still blocks admin accounts from being impersonated', async () => {
    DirectLoginToken.findOne = async () => ({
      admin_id: 1,
      used_user_ids: '[]',
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
    });
    User.findByPk = async () => ({
      id: 1,
      name: 'Admin',
      mobile_number: '9000000000',
      role: 'admin',
      status: 'active',
      employee_access_role_id: null,
    });

    User.findOne = async () => null;

    const res = await request(app)
      .post('/api/auth/direct-login')
      .send({
        dl_token: 'raw-direct-login-token',
        user_id: 1,
      });

    expect(res.status).to.equal(404);
    expect(res.body.message).to.match(/cannot be impersonated/i);
  });

  it('allows an impersonation-enabled employee token to open a merchant account', async () => {
    DirectLoginToken.findOne = async () => ({
      admin_id: 7,
      used_user_ids: '[]',
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
    });
    User.findByPk = async (id) => {
      expect(id).to.equal(7);
      return {
        id: 7,
        name: 'Ops Employee',
        mobile_number: '9000000007',
        role: 'employee',
        status: 'active',
        employee_access_role_id: 3,
      };
    };
    EmployeeAccessRole.findByPk = async (id) => {
      expect(id).to.equal(3);
      return {
        id: 3,
        name: 'Ops',
        slug: 'ops',
        status: 'active',
        permissions: [EMPLOYEE_PERMISSIONS.USERS_IMPERSONATE],
        toJSON() {
          return { ...this };
        },
      };
    };
    User.findOne = async ({ where }) => {
      expect(where.id).to.equal(11);
      return {
        id: 11,
        name: 'Merchant Target',
        mobile_number: '9000000011',
        role: 'merchant',
        status: 'active',
        abheepay_id: 'APM00011',
        organization_name: 'Merchant Org',
      };
    };

    const res = await request(app)
      .post('/api/auth/direct-login')
      .send({
        dl_token: 'employee-direct-login-token',
        user_id: 11,
      });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.user.role).to.equal('merchant');
  });

  it('blocks an employee-owned token from opening another employee account', async () => {
    DirectLoginToken.findOne = async () => ({
      admin_id: 7,
      used_user_ids: '[]',
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
    });
    User.findByPk = async () => ({
      id: 7,
      name: 'Ops Employee',
      mobile_number: '9000000007',
      role: 'employee',
      status: 'active',
      employee_access_role_id: 3,
    });
    EmployeeAccessRole.findByPk = async () => ({
      id: 3,
      name: 'Ops',
      slug: 'ops',
      status: 'active',
      permissions: [EMPLOYEE_PERMISSIONS.USERS_IMPERSONATE],
      toJSON() {
        return { ...this };
      },
    });
    User.findOne = async () => null;

    const res = await request(app)
      .post('/api/auth/direct-login')
      .send({
        dl_token: 'employee-direct-login-token',
        user_id: 12,
      });

    expect(res.status).to.equal(404);
    expect(res.body.message).to.match(/cannot be impersonated by this login token/i);
  });

  it('blocks an employee-owned token when the impersonation permission has been removed', async () => {
    DirectLoginToken.findOne = async () => ({
      admin_id: 7,
      used_user_ids: '[]',
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
    });
    User.findByPk = async () => ({
      id: 7,
      name: 'Ops Employee',
      mobile_number: '9000000007',
      role: 'employee',
      status: 'active',
      employee_access_role_id: 3,
    });
    EmployeeAccessRole.findByPk = async () => ({
      id: 3,
      name: 'Ops',
      slug: 'ops',
      status: 'active',
      permissions: [],
      toJSON() {
        return { ...this };
      },
    });

    const res = await request(app)
      .post('/api/auth/direct-login')
      .send({
        dl_token: 'employee-direct-login-token',
        user_id: 11,
      });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/no longer authorized to impersonate users/i);
  });
});
