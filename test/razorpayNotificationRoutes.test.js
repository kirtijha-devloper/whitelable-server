const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const notificationRoutes = require('../routes/razorpay/webhook/notificationRoutes');
const RazorpayNotification = require('../models/RazorpayNotification');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');

const app = express();
app.use(express.json());
app.use('/api/razorpay', notificationRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const makeToken = (user) => jwt.sign({ user }, SECRET);
const makeEmployeeToken = (permissions) => makeToken({
  id: 7,
  role: 'employee',
  employee_access_role_id: 9,
  employee_access_role: {
    id: 9,
    name: 'Notifications',
    slug: 'notifications',
    status: 'active',
    permissions,
  },
});

const employeeListToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.RAZORPAY_NOTIFICATIONS_LIST]);
const employeeReadToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.RAZORPAY_NOTIFICATIONS_READ]);
const noPermissionEmployeeToken = makeEmployeeToken([]);

let stubs = {};

beforeEach(() => {
  stubs = {
    findAndCountAll: RazorpayNotification.findAndCountAll,
    findByPk: RazorpayNotification.findByPk,
  };
});

afterEach(() => {
  RazorpayNotification.findAndCountAll = stubs.findAndCountAll;
  RazorpayNotification.findByPk = stubs.findByPk;
});

describe('Employee access to Razorpay notification routes', () => {
  it('allows employee with list permission to fetch notifications', async () => {
    RazorpayNotification.findAndCountAll = async () => ({
      count: 1,
      rows: [{
        id: 91,
        txn_id: 'TXN1',
        source: 'agro_hdfc',
        status: 'CAPTURED',
        event_json: { cardClassification: 'PLATINUM' },
        createdAt: new Date(),
        updatedAt: new Date(),
      }]
    });

    const res = await request(app)
      .get('/api/razorpay/notification')
      .set('Authorization', `Bearer ${employeeListToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data).to.have.length(1);
    expect(res.body.data[0].source).to.equal('agro_hdfc');
    expect(res.body.data[0].cardClassification).to.equal('PLATINUM');
  });

  it('rejects employee notification list access without permission', async () => {
    const res = await request(app)
      .get('/api/razorpay/notification')
      .set('Authorization', `Bearer ${noPermissionEmployeeToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to view razorpay notifications/i);
  });

  it('treats agro_axis source filter as compatible with legacy agro rows', async () => {
    let capturedWhere;
    RazorpayNotification.findAndCountAll = async ({ where }) => {
      capturedWhere = where;
      return { count: 0, rows: [] };
    };

    const res = await request(app)
      .get('/api/razorpay/notification?source=agro_axis')
      .set('Authorization', `Bearer ${employeeListToken}`);

    expect(res.status).to.equal(200);
    expect(capturedWhere.source[Op.in]).to.deep.equal(['agro_axis', 'agro']);
  });

  it('allows employee with read permission to fetch a notification detail', async () => {
    RazorpayNotification.findByPk = async () => ({
      id: 91,
      txn_id: 'TXN1',
      status: 'CAPTURED',
      source: 'agro_axis',
      event_json: { amount: 1000, cardClassification: 'CLASSIC' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/razorpay/notification/91')
      .set('Authorization', `Bearer ${employeeReadToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data.id).to.equal(91);
    expect(res.body.data.source).to.equal('agro_axis');
    expect(res.body.data.cardClassification).to.equal('CLASSIC');
  });

  it('rejects detail access when employee only has list permission', async () => {
    const res = await request(app)
      .get('/api/razorpay/notification/91')
      .set('Authorization', `Bearer ${employeeListToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to view razorpay notification details/i);
  });
});
