const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const directLoginRoutes = require('../routes/directLoginRoutes');
const DirectLoginToken = require('../models/DirectLoginToken');
const User = require('../models/User');

const app = express();
app.use(express.json({ strict: false }));
app.use('/api/auth', directLoginRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

describe('direct login employee impersonation support', () => {
  let originalFindToken;
  let originalFindUser;

  beforeEach(() => {
    originalFindToken = DirectLoginToken.findOne;
    originalFindUser = User.findOne;
  });

  afterEach(() => {
    DirectLoginToken.findOne = originalFindToken;
    User.findOne = originalFindUser;
  });

  it('allows an admin direct-login token to open an employee account', async () => {
    DirectLoginToken.findOne = async () => ({
      used_user_ids: '[]',
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
    });

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
      used_user_ids: '[]',
      update: async function (updates) {
        Object.assign(this, updates);
        return this;
      },
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
});
