'use strict';
require('./test-setup');
const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const dashboardRoutes = require('../routes/dashboardRoutes');
const PosMachine = require('../models/posMachine');
const User = require('../models/User');
const RazorpayNotification = require('../models/RazorpayNotification');
const CcBillPayment = require('../models/CcBillPayment');
const PayoutTransaction = require('../models/PayoutTransaction');
const PayoutRequest = require('../models/PayoutRequest');
const BillAvenuePayment = require('../models/BillAvenuePayment');

const app = express();
app.use(express.json());
app.use('/api/dashboard', dashboardRoutes);

const makeToken = (id, role) =>
  jwt.sign({ user: { id, role, name: `${role} user` } }, process.env.ACCESS_TOKEN_SECRET);

const adminToken = makeToken(1, 'admin');
const merchantToken = makeToken(2, 'merchant');
const franchiseToken = makeToken(3, 'franchaise');

const toScopedIds = (value) => {
  if (value && typeof value === 'object' && value[Op.in]) {
    return value[Op.in];
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
};

const getScopeMembers = (where, field) => {
  const scopedWhere = where && where[Op.and] ? where[Op.and][1] : where;
  const orClauses = scopedWhere && scopedWhere[Op.or] ? scopedWhere[Op.or] : [];
  const fieldClause = orClauses.find((clause) => clause[field] !== undefined);
  return fieldClause ? toScopedIds(fieldClause[field]) : [];
};

const getCcScopeMembers = (where) => {
  const baseWhere = where && where[Op.and] ? where[Op.and][0] : where;
  return baseWhere ? toScopedIds(baseWhere.user_id) : [];
};

const getCcVariant = (where) => {
  if (!where || !where[Op.and]) return 'total';
  const statusFilter = where[Op.and][1];
  if (statusFilter.statuscode && statusFilter.statuscode[Op.in]) return 'success';
  return 'fail';
};

const getBaCcVariant = (where) => {
  if (!where || !where.status) return 'total';
  const statusIn = where.status[Op.in];
  if (statusIn && statusIn.includes('success')) return 'success';
  return 'fail';
};

describe('GET /api/dashboard', () => {
  let originals;

  beforeEach(() => {
    originals = {
      posMachineCount: PosMachine.count,
      posMachineFindAll: PosMachine.findAll,
      userCount: User.count,
      userFindAll: User.findAll,
      razorpayCount: RazorpayNotification.count,
      razorpaySum: RazorpayNotification.sum,
      ccBillSum: CcBillPayment.sum,
      baCcBillSum: BillAvenuePayment.sum,
      payoutTransactionSum: PayoutTransaction.sum,
      payoutRequestSum: PayoutRequest.sum
    };
  });

  afterEach(() => {
    PosMachine.count = originals.posMachineCount;
    PosMachine.findAll = originals.posMachineFindAll;
    User.count = originals.userCount;
    User.findAll = originals.userFindAll;
    RazorpayNotification.count = originals.razorpayCount;
    RazorpayNotification.sum = originals.razorpaySum;
    CcBillPayment.sum = originals.ccBillSum;
    BillAvenuePayment.sum = originals.baCcBillSum;
    PayoutTransaction.sum = originals.payoutTransactionSum;
    PayoutRequest.sum = originals.payoutRequestSum;
  });

  it('returns admin dashboard totals including current payout and CC bill values', async () => {
    PosMachine.count = async ({ where }) => where.status === 'in_active' ? 2 : 11;
    User.count = async ({ where }) => where.role === 'merchant' ? 50 : 5;

    RazorpayNotification.count = async () => 120;
    RazorpayNotification.sum = async (_field, { where }) => {
      if (!where.status) return 150000;
      const statusIn = where.status[Op.in];
      if (statusIn.includes('CAPTURED')) return 140000;
      if (statusIn.includes('FAILED')) return 10000;
      return 0;
    };

    CcBillPayment.sum = async (_field, { where }) => {
      const variant = getCcVariant(where);
      if (variant === 'success') return 7000;
      if (variant === 'fail') return 2000;
      return 9000;
    };

    BillAvenuePayment.sum = async (_field, { where }) => {
      const variant = getBaCcVariant(where);
      if (variant === 'success') return 800;
      if (variant === 'fail') return 200;
      return 1000;
    };

    PayoutTransaction.sum = async () => 18000;
    PayoutRequest.sum = async () => 7000;

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('data');
    expect(res.body.data.pos_machines).to.deep.equal({ active: 11, inactive: 2 });
    expect(res.body.data.merchants).to.deep.equal({ count: 50 });
    expect(res.body.data.franchaises).to.deep.equal({ count: 5 });
    expect(res.body.data.pos_transactions).to.include({ total: 150000, success: 140000, fail: 10000 });
    expect(res.body.data.today_total_payout).to.equal(25000);
    expect(res.body.data.ccBillPaymentTXN).to.equal(10000);
    expect(res.body.data.ccBillPaymentSuccess).to.equal(7800);
    expect(res.body.data.ccBillPaymentFailed).to.equal(2200);
  });

  it('returns merchant dashboard scoped to own user and machine data', async () => {
    let capturedRazorpayWhere;

    PosMachine.findAll = async ({ where }) => {
      expect(where.assigned_to).to.equal(2);
      return [{ mid_number: 'MID123' }];
    };
    PosMachine.count = async ({ where }) => {
      expect(where.assigned_to).to.equal(2);
      return 1;
    };

    RazorpayNotification.count = async ({ where }) => {
      capturedRazorpayWhere = where;
      return 5;
    };
    RazorpayNotification.sum = async (_field, { where }) => {
      if (!where.status) return 1200;
      const statusIn = where.status[Op.in];
      if (statusIn.includes('CAPTURED')) return 1100;
      if (statusIn.includes('FAILED')) return 100;
      return 0;
    };

    CcBillPayment.sum = async (_field, { where }) => {
      expect(getCcScopeMembers(where)).to.deep.equal([2]);
      const variant = getCcVariant(where);
      if (variant === 'success') return 700;
      if (variant === 'fail') return 100;
      return 800;
    };

    BillAvenuePayment.sum = async (_field, { where }) => {
      expect(toScopedIds(where.user_id)).to.deep.equal([2]);
      const variant = getBaCcVariant(where);
      if (variant === 'success') return 100;
      if (variant === 'fail') return 50;
      return 150;
    };

    PayoutTransaction.sum = async (_field, { where }) => {
      expect(toScopedIds(where.merchant_id)).to.deep.equal([2]);
      return 500;
    };
    PayoutRequest.sum = async (_field, { where }) => {
      expect(toScopedIds(where.user_id)).to.deep.equal([2]);
      return 300;
    };

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data.pos_machines).to.deep.equal({ count: 1 });
    expect(res.body.data.pos_transactions).to.include({ total: 1200, success: 1100, fail: 100 });
    expect(res.body.data.today_total_payout).to.equal(800);
    expect(res.body.data.ccBillPaymentTXN).to.equal(950);
    expect(res.body.data.ccBillPaymentSuccess).to.equal(800);
    expect(res.body.data.ccBillPaymentFailed).to.equal(150);
    expect(getScopeMembers(capturedRazorpayWhere, 'user_id')).to.deep.equal([2]);
    expect(getScopeMembers(capturedRazorpayWhere, 'mid')).to.deep.equal(['MID123']);
  });

  it('returns franchise dashboard with self plus franchise merchants in scope', async () => {
    let capturedRazorpayWhere;

    User.findAll = async ({ where }) => {
      expect(where).to.deep.equal({ franchaise_id: 3, role: 'merchant', status: 'active' });
      return [{ id: 11 }, { id: 12 }];
    };
    User.count = async ({ where }) => {
      expect(where).to.deep.equal({ franchaise_id: 3, role: 'merchant', status: 'active' });
      return 2;
    };

    PosMachine.count = async ({ where }) => {
      const assignedIds = toScopedIds(where.assigned_to);
      if (assignedIds.length === 1 && assignedIds[0] === 3) return 1;
      if (assignedIds.length === 2 && assignedIds.includes(11) && assignedIds.includes(12)) return 2;
      return 0;
    };
    PosMachine.findAll = async ({ where }) => {
      const assignedIds = toScopedIds(where.assigned_to);
      expect(assignedIds).to.have.members([3, 11, 12]);
      return [
        { mid_number: 'MID-FR-1' },
        { mid_number: 'MID-M-11' },
        { mid_number: 'MID-M-12' }
      ];
    };

    RazorpayNotification.count = async ({ where }) => {
      capturedRazorpayWhere = where;
      return 8;
    };
    RazorpayNotification.sum = async (_field, { where }) => {
      if (!where.status) return 4500;
      const statusIn = where.status[Op.in];
      if (statusIn.includes('CAPTURED')) return 4000;
      if (statusIn.includes('FAILED')) return 500;
      return 0;
    };

    CcBillPayment.sum = async (_field, { where }) => {
      expect(getCcScopeMembers(where)).to.have.members([3, 11, 12]);
      const variant = getCcVariant(where);
      if (variant === 'success') return 2300;
      if (variant === 'fail') return 200;
      return 2500;
    };

    BillAvenuePayment.sum = async (_field, { where }) => {
      expect(toScopedIds(where.user_id)).to.have.members([3, 11, 12]);
      const variant = getBaCcVariant(where);
      if (variant === 'success') return 300;
      if (variant === 'fail') return 100;
      return 400;
    };

    PayoutTransaction.sum = async (_field, { where }) => {
      expect(toScopedIds(where.merchant_id)).to.have.members([3, 11, 12]);
      return 3000;
    };
    PayoutRequest.sum = async (_field, { where }) => {
      expect(toScopedIds(where.user_id)).to.have.members([3, 11, 12]);
      return 2000;
    };

    const res = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${franchiseToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data.assigned_merchants).to.deep.equal({ count: 2 });
    expect(res.body.data.pos_machines).to.deep.equal({
      assigned_to_franchise: 1,
      assigned_to_merchants: 2
    });
    expect(res.body.data.pos_transactions).to.include({ total: 4500, success: 4000, fail: 500 });
    expect(res.body.data.today_total_payout).to.equal(5000);
    expect(res.body.data.ccBillPaymentTXN).to.equal(2900);
    expect(res.body.data.ccBillPaymentSuccess).to.equal(2600);
    expect(res.body.data.ccBillPaymentFailed).to.equal(300);
    expect(getScopeMembers(capturedRazorpayWhere, 'user_id')).to.have.members([3, 11, 12]);
    expect(getScopeMembers(capturedRazorpayWhere, 'mid')).to.have.members(['MID-FR-1', 'MID-M-11', 'MID-M-12']);
  });
});
