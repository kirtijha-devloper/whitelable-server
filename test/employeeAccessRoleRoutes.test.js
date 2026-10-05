const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const employeeAccessRoleRoutes = require('../routes/employeeAccessRoleRoutes');
const EmployeeAccessRole = require('../models/EmployeeAccessRole');
const User = require('../models/User');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');

const app = express();
app.use(express.json({ strict: false }));
app.use('/api/admin/employee-access-roles', employeeAccessRoleRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const adminToken = jwt.sign({ user: { id: 1, role: 'admin', name: 'Admin' } }, SECRET);
const merchantToken = jwt.sign({ user: { id: 2, role: 'merchant', name: 'Merchant' } }, SECRET);

let stubs = {};

beforeEach(() => {
  stubs = {
    findAll: EmployeeAccessRole.findAll,
    findOne: EmployeeAccessRole.findOne,
    findByPk: EmployeeAccessRole.findByPk,
    create: EmployeeAccessRole.create,
    userCount: User.count,
  };
});

afterEach(() => {
  EmployeeAccessRole.findAll = stubs.findAll;
  EmployeeAccessRole.findOne = stubs.findOne;
  EmployeeAccessRole.findByPk = stubs.findByPk;
  EmployeeAccessRole.create = stubs.create;
  User.count = stubs.userCount;
});

describe('Employee access role admin routes', () => {
  it('returns permission catalog metadata for admin', async () => {
    const res = await request(app)
      .get('/api/admin/employee-access-roles/meta')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data.permissions).to.be.an('array').that.is.not.empty;
    const usersModule = res.body.data.permissions.find((module) => module.module === 'users');
    expect(usersModule.permissions.map((permission) => permission.slug)).to.include(EMPLOYEE_PERMISSIONS.USERS_IMPERSONATE);
    expect(usersModule.permissions.map((permission) => permission.slug)).to.include(EMPLOYEE_PERMISSIONS.USERS_SERVICE_SETTINGS_MANAGE);
    const settlementModule = res.body.data.permissions.find((module) => module.module === 'settlement');
    expect(settlementModule.permissions.map((permission) => permission.slug)).to.include.members([
      EMPLOYEE_PERMISSIONS.SETTLEMENT_READ,
      EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE,
    ]);
  });

  it('rejects non-admin access', async () => {
    const res = await request(app)
      .get('/api/admin/employee-access-roles')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(403);
  });

  it('creates an employee access role with valid permissions', async () => {
    EmployeeAccessRole.findOne = async () => null;
    EmployeeAccessRole.create = async (data) => ({
      id: 5,
      ...data,
      toJSON() {
        return { ...this };
      },
    });

    const res = await request(app)
      .post('/api/admin/employee-access-roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Accounts',
        permissions: ['wallet.read', 'wallet.credit'],
      });

    expect(res.status).to.equal(201);
    expect(res.body.data.slug).to.equal('accounts');
    expect(res.body.data.permissions).to.deep.equal(['wallet.read', 'wallet.credit']);
  });

  it('rejects invalid permission slugs on create', async () => {
    const res = await request(app)
      .post('/api/admin/employee-access-roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Broken Role',
        permissions: ['wallet.read', 'wallet.manage'],
      });

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/invalid permissions/i);
  });

  it('updates an employee access role', async () => {
    const role = {
      id: 7,
      name: 'Support',
      slug: 'support',
      description: null,
      status: 'active',
      permissions: ['complaints.read'],
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
      toJSON() {
        return { ...this };
      },
    };

    EmployeeAccessRole.findByPk = async () => role;
    EmployeeAccessRole.findOne = async () => null;

    const res = await request(app)
      .put('/api/admin/employee-access-roles/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        permissions: ['complaints.read', 'complaints.manage'],
      });

    expect(res.status).to.equal(200);
    expect(res.body.data.permissions).to.deep.equal(['complaints.read', 'complaints.manage']);
  });

  it('blocks delete when the role is assigned to employees', async () => {
    EmployeeAccessRole.findByPk = async () => ({
      id: 9,
      destroy: async () => {},
    });
    User.count = async () => 2;

    const res = await request(app)
      .delete('/api/admin/employee-access-roles/9')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(409);
    expect(res.body.message).to.match(/assigned to employees/i);
  });
});
