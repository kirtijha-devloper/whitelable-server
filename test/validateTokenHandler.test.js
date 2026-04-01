const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const validateToken = require('../middleware/validateTokenHandler');
const User = require('../models/User');

const app = express();
app.get('/secure', validateToken, (req, res) => {
  res.json({ user: req.user });
});
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

describe('validateTokenHandler fresh auth user loading', () => {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  let originalFindByPk;
  let originalEnforceDbAuth;

  beforeEach(() => {
    originalFindByPk = User.findByPk;
    originalEnforceDbAuth = process.env.ENFORCE_DB_AUTH;
    process.env.ENFORCE_DB_AUTH = 'true';
  });

  afterEach(() => {
    User.findByPk = originalFindByPk;
    if (originalEnforceDbAuth === undefined) {
      delete process.env.ENFORCE_DB_AUTH;
    } else {
      process.env.ENFORCE_DB_AUTH = originalEnforceDbAuth;
    }
  });

  it('uses the latest DB role and permissions instead of stale token claims', async () => {
    User.findByPk = async () => ({
      id: 7,
      name: 'Employee',
      mobile_number: '9000000001',
      role: 'employee',
      status: 'active',
      ipay_outlet_id: null,
      permissions: ['users.list'],
    });

    const token = jwt.sign({
      user: {
        id: 7,
        role: 'admin',
        permissions: ['users.update'],
      }
    }, secret);

    const res = await request(app)
      .get('/secure')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(200);
    expect(res.body.user.role).to.equal('employee');
    expect(res.body.user.permissions).to.deep.equal(['users.list']);
  });

  it('rejects inactive users even if the token is otherwise valid', async () => {
    User.findByPk = async () => ({
      id: 7,
      name: 'Employee',
      mobile_number: '9000000001',
      role: 'employee',
      status: 'inactive',
      ipay_outlet_id: null,
      permissions: [],
    });

    const token = jwt.sign({
      user: {
        id: 7,
        role: 'employee',
      }
    }, secret);

    const res = await request(app)
      .get('/secure')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).to.equal(401);
    expect(res.body.message).to.match(/inactive/i);
  });
});
