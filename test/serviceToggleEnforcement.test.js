const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const branchxRoutes = require('../routes/payments/branchxRoutes');
const vimoRoutes = require('../routes/vimoRoutes');
const bbpsCCBillRoutes = require('../routes/cc/bbps/bbpsCCBillRoutes');
const billAvenueRoutes = require('../routes/cc/billAvenue/billAvenueRoutes');
const ServiceSetting = require('../models/ServiceSetting');
const UserServiceSetting = require('../models/UserServiceSetting');
const User = require('../models/User');
const Beneficiary = require('../models/Beneficiary');

const app = express();
app.use(express.json());
app.use('/api/payment/v2', branchxRoutes);
app.use('/api/vimo', vimoRoutes);
app.use('/api/bbps-cc', bbpsCCBillRoutes);
app.use('/api/bill-avenue', billAvenueRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const merchantToken = jwt.sign({ user: { id: 2, role: 'merchant', name: 'Merchant' } }, SECRET);

function makeDisabledSetting(serviceKey) {
  return [{
    service_key: serviceKey,
    is_enabled: false,
    updated_by: 1,
    updatedAt: new Date('2026-04-07T09:00:00Z'),
  }];
}

let stubs = {};

beforeEach(() => {
  stubs = {
    serviceSettingFindAll: ServiceSetting.findAll,
    userServiceSettingFindAll: UserServiceSetting.findAll,
    userFindByPk: User.findByPk,
    beneficiaryFindOne: Beneficiary.findOne,
  };
});

afterEach(() => {
  ServiceSetting.findAll = stubs.serviceSettingFindAll;
  UserServiceSetting.findAll = stubs.userServiceSettingFindAll;
  User.findByPk = stubs.userFindByPk;
  Beneficiary.findOne = stubs.beneficiaryFindOne;
});

describe('Service toggle enforcement', () => {
  it('blocks BranchX payout when branchx_payout is disabled globally', async () => {
    ServiceSetting.findAll = async () => makeDisabledSetting('branchx_payout');
    User.findByPk = async () => ({ id: 2, is_payout_enabled: true, wallet: 1000, save: async () => {} });

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 2, amount: 100, tpin: '1234', beneficiary_id: 1 });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('SERVICE_DISABLED');
    expect(res.body.service_key).to.equal('branchx_payout');
  });

  it('blocks Vimo payout when vimo_payout is disabled globally', async () => {
    ServiceSetting.findAll = async () => makeDisabledSetting('vimo_payout');
    User.findByPk = async () => ({ id: 2, is_payout_enabled: true });
    Beneficiary.findOne = async () => ({
      id: 1,
      merchant_id: 2,
      bank_name: 'Test Bank',
      account_number: '1234567890',
      ifsc_code: 'TEST0001234',
      mobile_number: '9999999999',
      beneficiary_name: 'Test Beneficiary',
      state: 'JH',
    });

    const res = await request(app)
      .post('/api/vimo/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ user_id: 2, amount: 100, beneficiary_id: 1 });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('SERVICE_DISABLED');
    expect(res.body.service_key).to.equal('vimo_payout');
  });

  it('blocks BranchX payout when branchx_payout is disabled for the user', async () => {
    ServiceSetting.findAll = async () => [];
    UserServiceSetting.findAll = async () => ([
      {
        user_id: 2,
        service_key: 'branchx_payout',
        is_enabled: false,
      },
    ]);
    User.findByPk = async () => ({ id: 2, is_payout_enabled: true, wallet: 1000, save: async () => {} });

    const res = await request(app)
      .post('/api/payment/v2/payout')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ merchant_id: 2, amount: 100, tpin: '1234', beneficiary_id: 1 });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('SERVICE_DISABLED');
    expect(res.body.service_key).to.equal('branchx_payout');
  });

  it('blocks BBPS CC payment when cc_bill_pay is disabled globally', async () => {
    ServiceSetting.findAll = async () => makeDisabledSetting('cc_bill_pay');

    const res = await request(app)
      .post('/api/bbps-cc/pay')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        billerId: 'HDFC_CC_001',
        param1: '4111111111111111',
        transactionAmount: 1000,
        customerMobile: '9876543210',
      });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('SERVICE_DISABLED');
    expect(res.body.service_key).to.equal('cc_bill_pay');
  });

  it('blocks BBPS CC payment when cc_bill_pay is disabled for the user', async () => {
    ServiceSetting.findAll = async () => [];
    UserServiceSetting.findAll = async () => ([
      {
        user_id: 2,
        service_key: 'cc_bill_pay',
        is_enabled: false,
      },
    ]);

    const res = await request(app)
      .post('/api/bbps-cc/pay')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        billerId: 'HDFC_CC_001',
        param1: '4111111111111111',
        transactionAmount: 1000,
        customerMobile: '9876543210',
      });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('SERVICE_DISABLED');
    expect(res.body.service_key).to.equal('cc_bill_pay');
  });

  it('blocks BillAvenue CC payment when ba_cc_bill_pay is disabled globally', async () => {
    ServiceSetting.findAll = async () => makeDisabledSetting('ba_cc_bill_pay');

    const res = await request(app)
      .post('/api/bill-avenue/pay')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        billerId: 'HDFC000CC00ANZ',
        customerParams: { CRN: '4111111111111234' },
        amount: 5000,
      });

    expect(res.status).to.equal(403);
    expect(res.body.code).to.equal('SERVICE_DISABLED');
    expect(res.body.service_key).to.equal('ba_cc_bill_pay');
  });
});
