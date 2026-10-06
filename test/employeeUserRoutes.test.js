const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const sendOtpUtils = require('../utils/sendOtp');
const mailUtils = require('../utils/mail');
let sentRegistrationSmsArgs = null;
let sentMailArgs = null;
sendOtpUtils.sendRegistrationSms = async (...args) => {
  sentRegistrationSmsArgs = args;
  return { success: true };
};
mailUtils.sendMail = async (payload) => {
  sentMailArgs = payload;
  return { accepted: ['test@example.com'] };
};

const userRoutes = require('../routes/userRoutes');
const User = require('../models/User');
const EmployeeAccessRole = require('../models/EmployeeAccessRole');
const UsernameSequence = require('../models/UsernameSequence');
const Tpin = require('../models/Tpin');
const PosMachine = require('../models/posMachine');
const PosTransactionCharge = require('../models/PosTransactionCharge');
const PayoutCharge = require('../models/PayoutCharge');
const Rental = require('../models/Rental');
const ServiceSetting = require('../models/ServiceSetting');
const UserServiceSetting = require('../models/UserServiceSetting');
const ServiceToggleAuditLog = require('../models/ServiceToggleAuditLog');
const ledgerService = require('../services/ledgerService');
const db = require('../config/database');
const { EMPLOYEE_PERMISSIONS } = require('../utils/permissions');

const app = express();
app.use(express.json({ strict: false }));
app.use('/api/user', userRoutes);
app.use((err, req, res, _next) => {
  res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
    .json({ message: err.message });
});

const SECRET = process.env.ACCESS_TOKEN_SECRET;
const makeToken = (user) => jwt.sign({ user }, SECRET);
const makeEmployeeToken = (permissions) => makeToken({
  id: 7,
  role: 'employee',
  name: 'Employee',
  employee_access_role_id: 3,
  employee_access_role: {
    id: 3,
    name: 'Operations',
    slug: 'operations',
    status: 'active',
    permissions,
  },
});

const adminToken = makeToken({ id: 1, role: 'admin', name: 'Admin' });
const franchiseToken = makeToken({ id: 5, role: 'franchaise', name: 'Franchise' });
const employeeListToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.USERS_LIST]);
const employeeReadToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.USERS_READ]);
const employeeUpdateToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.USERS_UPDATE]);
const employeeStatusToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.USERS_STATUS_UPDATE]);
const employeeCreateToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.USERS_CREATE]);
const employeeLedgerToken = makeEmployeeToken([EMPLOYEE_PERMISSIONS.LEDGER_MANAGE]);
const employeeSettlementToken = makeEmployeeToken([
  EMPLOYEE_PERMISSIONS.USERS_UPDATE,
  EMPLOYEE_PERMISSIONS.USERS_SETTLEMENT_UPDATE,
  EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE,
]);
const employeeSettlementManageOnlyToken = makeEmployeeToken([
  EMPLOYEE_PERMISSIONS.SETTLEMENT_MANAGE,
]);
const noPermissionEmployeeToken = makeEmployeeToken([]);

let stubs = {};

beforeEach(() => {
  sentRegistrationSmsArgs = null;
  sentMailArgs = null;
  stubs = {
    userFindAndCountAll: User.findAndCountAll,
    userFindAll: User.findAll,
    userFindByPk: User.findByPk,
    userFindOne: User.findOne,
    userCreate: User.create,
    employeeAccessRoleFindByPk: EmployeeAccessRole.findByPk,
    usernameSequenceFindOne: UsernameSequence.findOne,
    usernameSequenceFindOrCreate: UsernameSequence.findOrCreate,
    usernameSequenceCreate: UsernameSequence.create,
    tpinFindOne: Tpin.findOne,
    posMachineFindAll: PosMachine.findAll,
    posTxnChargeFindAll: PosTransactionCharge.findAll,
    payoutChargeFindAll: PayoutCharge.findAll,
    rentalFindAll: Rental.findAll,
    serviceSettingFindAll: ServiceSetting.findAll,
    userServiceSettingFindAll: UserServiceSetting.findAll,
    serviceToggleAuditLogCreate: ServiceToggleAuditLog.create,
    ledgerGetAvailableBalance: ledgerService.getAvailableBalance,
    dbTransaction: db.transaction,
  };
});

afterEach(() => {
  User.findAndCountAll = stubs.userFindAndCountAll;
  User.findAll = stubs.userFindAll;
  User.findByPk = stubs.userFindByPk;
  User.findOne = stubs.userFindOne;
  User.create = stubs.userCreate;
  EmployeeAccessRole.findByPk = stubs.employeeAccessRoleFindByPk;
  UsernameSequence.findOne = stubs.usernameSequenceFindOne;
  UsernameSequence.findOrCreate = stubs.usernameSequenceFindOrCreate;
  UsernameSequence.create = stubs.usernameSequenceCreate;
  Tpin.findOne = stubs.tpinFindOne;
  PosMachine.findAll = stubs.posMachineFindAll;
  PosTransactionCharge.findAll = stubs.posTxnChargeFindAll;
  PayoutCharge.findAll = stubs.payoutChargeFindAll;
  Rental.findAll = stubs.rentalFindAll;
  ServiceSetting.findAll = stubs.serviceSettingFindAll;
  UserServiceSetting.findAll = stubs.userServiceSettingFindAll;
  ServiceToggleAuditLog.create = stubs.serviceToggleAuditLogCreate;
  ledgerService.getAvailableBalance = stubs.ledgerGetAvailableBalance;
  db.transaction = stubs.dbTransaction;
});

describe('Employee role on user routes', () => {
  it('allows admin to create an employee with an access role and no bank passbook', async () => {
    User.findOne = async () => null;
    EmployeeAccessRole.findByPk = async () => ({
      id: 3,
      name: 'Operations',
      slug: 'operations',
      status: 'active',
      permissions: [EMPLOYEE_PERMISSIONS.USERS_LIST, EMPLOYEE_PERMISSIONS.USERS_READ],
      toJSON() {
        return { ...this };
      },
    });
    UsernameSequence.findOrCreate = async () => ([{
      current_value: 0,
      save: async function () { return this; },
    }]);
    db.transaction = async (handler) => handler({ LOCK: { UPDATE: 'UPDATE' } });
    User.create = async (data) => ({
      id: 22,
      ...data,
      toJSON() {
        return { ...this };
      }
    });

    const res = await request(app)
      .post('/api/user/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'employee',
        name: 'Ops Employee',
        email: 'employee@example.com',
        mobile_number: '9000000001',
        password: 'Test@1234',
        employee_access_role_id: 3,
      });

    expect(res.status).to.equal(201);
    expect(res.body.user.role).to.equal('employee');
    expect(res.body.user.username).to.equal('APE00001');
    expect(res.body.user.employee_access_role_id).to.equal(3);
    expect(res.body.user.permissions).to.deep.equal([
      EMPLOYEE_PERMISSIONS.USERS_LIST,
      EMPLOYEE_PERMISSIONS.USERS_READ,
    ]);
    expect(res.body.sms.sent).to.equal(true);
    expect(sentRegistrationSmsArgs).to.deep.equal([
      '9000000001',
      'APE00001',
      'Test@1234',
      'Ops Employee',
    ]);
    expect(res.body.email.sent).to.equal(true);
    expect(sentMailArgs).to.include({
      to: 'employee@example.com',
      subject: 'Abheepay POS Account Created',
    });
    expect(sentMailArgs.html).to.include('APE00001');
    expect(sentMailArgs.html).to.include('Test@1234');
  });

  it('rejects franchise attempts to create an employee', async () => {
    const res = await request(app)
      .post('/api/user/register')
      .set('Authorization', `Bearer ${franchiseToken}`)
      .send({
        role: 'employee',
        email: 'employee@example.com',
        mobile_number: '9000000002',
        password: 'Test@1234',
      });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/merchant users only|only admins can create employee/i);
  });

  it('requires employee_access_role_id when creating an employee', async () => {
    const res = await request(app)
      .post('/api/user/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'employee',
        email: 'employee@example.com',
        mobile_number: '9000000002',
        password: 'Test@1234',
      });

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/employee_access_role_id is required/i);
  });
  it('allows an employee with users.create to create a merchant user', async () => {
    User.findOne = async () => null;
    UsernameSequence.findOrCreate = async () => ([{
      current_value: 0,
      save: async function () { return this; },
    }]);
    db.transaction = async (handler) => handler({ LOCK: { UPDATE: 'UPDATE' } });
    User.create = async (data) => ({
      id: 23,
      ...data,
      toJSON() {
        return { ...this };
      }
    });

    const tempApp = express();
    tempApp.use(express.json({ strict: false }));
    tempApp.use((req, res, next) => {
      req.files = {
        bank_passbook: {
          tempFilePath: 'test/dummy_passbook.txt',
        },
      };
      next();
    });
    tempApp.use('/api/user', userRoutes);
    tempApp.use((err, req, res, _next) => {
      res.status(res.statusCode && res.statusCode !== 200 ? res.statusCode : 500)
        .json({ message: err.message });
    });

    const res = await request(tempApp)
      .post('/api/user/register')
      .set('Authorization', `Bearer ${employeeCreateToken}`)
      .send({
        role: 'merchant',
        name: 'Created Merchant',
        email: 'merchant-created@example.com',
        mobile_number: '9000000009',
        password: 'Test@1234',
      });

    expect(res.status).to.equal(201);
    expect(res.body.user.role).to.equal('merchant');
  });

  it('returns permissions from current user profile for employee login flow', async () => {
    User.findByPk = async () => ({
      id: 7,
      email: 'employee@example.com',
      mobile_number: '9000000001',
      name: 'Ops Employee',
      mobile_number_country_code: '+91',
      role: 'employee',
      permissions: [],
      employee_access_role_id: 3,
      abheepay_id: 'APE00001',
      is_approved: true,
      organization_name: 'NA',
      status: 'active',
      is_pos_asigned: false,
      wallet: '500.00',
      wallet_hold: '50.00',
      ipay_outlet_id: null,
      is_payout_enabled: true,
    });
    EmployeeAccessRole.findByPk = async () => ({
      id: 3,
      name: 'Operations',
      slug: 'operations',
      status: 'active',
      permissions: [EMPLOYEE_PERMISSIONS.USERS_LIST],
      toJSON() {
        return { ...this };
      },
    });
    Tpin.findOne = async () => null;
    ServiceSetting.findAll = async () => ([
      {
        service_key: 'branchx_payout',
        is_enabled: false,
        updated_by: 1,
        updatedAt: new Date('2026-04-07T10:00:00Z'),
      },
    ]);
    ledgerService.getAvailableBalance = async () => 450;

    const res = await request(app)
      .get('/api/user/current')
      .set('Authorization', `Bearer ${employeeListToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.role).to.equal('employee');
    expect(res.body.employee_access_role_id).to.equal(3);
    expect(res.body.permissions).to.deep.equal([EMPLOYEE_PERMISSIONS.USERS_LIST]);
    expect(res.body.service_flags).to.deep.equal({
      vimo_payout: true,
      branchx_payout: false,
      cc_bill_pay: true,
      ba_cc_bill_pay: true,
    });
  });

  it('allows employee with users.list permission to load user list', async () => {
    User.findAndCountAll = async () => ({
      count: 1,
      rows: [{
        id: 11,
        role: 'merchant',
        wallet: '100.00',
        wallet_hold: '10.00',
        toJSON() {
          return { id: 11, role: 'merchant', wallet: '100.00', wallet_hold: '10.00' };
        }
      }]
    });
    PosMachine.findAll = async () => [];

    const res = await request(app)
      .get('/api/user')
      .set('Authorization', `Bearer ${employeeListToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data).to.have.length(1);
  });

  it('includes user service settings and effective flags in user list results', async () => {
    User.findAndCountAll = async () => ({
      count: 1,
      rows: [{
        id: 11,
        role: 'merchant',
        wallet: '100.00',
        wallet_hold: '10.00',
        is_payout_enabled: true,
        toJSON() {
          return {
            id: 11,
            role: 'merchant',
            wallet: '100.00',
            wallet_hold: '10.00',
            is_payout_enabled: true,
          };
        }
      }]
    });
    PosMachine.findAll = async () => [];
    ServiceSetting.findAll = async () => ([
      {
        service_key: 'branchx_payout',
        is_enabled: false,
        updated_by: 1,
        updatedAt: new Date('2026-04-07T10:00:00Z'),
      },
    ]);
    UserServiceSetting.findAll = async () => ([
      {
        user_id: 11,
        service_key: 'vimo_payout',
        is_enabled: false,
      },
    ]);

    const res = await request(app)
      .get('/api/user')
      .set('Authorization', `Bearer ${employeeListToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data[0].user_service_settings).to.deep.equal({
      vimo_payout: false,
      branchx_payout: true,
      cc_bill_pay: true,
      ba_cc_bill_pay: true,
    });
    expect(res.body.data[0].service_flags).to.deep.equal({
      vimo_payout: false,
      branchx_payout: false,
      cc_bill_pay: true,
      ba_cc_bill_pay: true,
    });
  });

  it('adds merchant counts for franchise rows and franchise details for merchant rows in user list', async () => {
    User.findAndCountAll = async () => ({
      count: 2,
      rows: [
        {
          id: 5,
          role: 'franchaise',
          wallet: '0.00',
          toJSON() {
            return { id: 5, role: 'franchaise', wallet: '0.00' };
          }
        },
        {
          id: 11,
          role: 'merchant',
          franchaise_id: 5,
          wallet: '100.00',
          toJSON() {
            return { id: 11, role: 'merchant', franchaise_id: 5, wallet: '100.00' };
          }
        }
      ],
    });
    PosMachine.findAll = async () => [];
    User.findAll = async (options) => {
      if (options?.group) {
        return [{
          get(field) {
            if (field === 'franchaise_id') return 5;
            if (field === 'merchant_count') return '3';
            return null;
          },
        }];
      }

      return [{
        toJSON() {
          return { id: 5, name: 'Franchise One', abheepay_id: 'APF00005' };
        },
      }];
    };

    const res = await request(app)
      .get('/api/user')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    const franchiseUser = res.body.data.find((user) => user.id === 5);
    const merchantUser = res.body.data.find((user) => user.id === 11);

    expect(franchiseUser.merchant_count).to.equal(3);
    expect(franchiseUser.franchise_details).to.equal(null);
    expect(merchantUser.merchant_count).to.equal(null);
    expect(merchantUser.franchise_details).to.deep.equal({
      name: 'Franchise One',
      abheepay_id: 'APF00005',
    });
  });

  it('adds merchant counts and franchise details in user search results', async () => {
    User.findAndCountAll = async () => ({
      count: 2,
      rows: [
        {
          id: 6,
          role: 'franchaise',
          wallet: '0.00',
          toJSON() {
            return { id: 6, role: 'franchaise', wallet: '0.00' };
          }
        },
        {
          id: 12,
          role: 'merchant',
          franchaise_id: 6,
          wallet: '250.00',
          toJSON() {
            return { id: 12, role: 'merchant', franchaise_id: 6, wallet: '250.00' };
          }
        }
      ],
    });
    PosMachine.findAll = async () => [];
    User.findAll = async (options) => {
      if (options?.group) {
        return [{
          get(field) {
            if (field === 'franchaise_id') return 6;
            if (field === 'merchant_count') return '1';
            return null;
          },
        }];
      }

      return [{
        toJSON() {
          return { id: 6, name: 'Franchise Search', abheepay_id: 'APF00006' };
        },
      }];
    };

    const res = await request(app)
      .get('/api/user/search?q=test')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    const franchiseUser = res.body.data.find((user) => user.id === 6);
    const merchantUser = res.body.data.find((user) => user.id === 12);

    expect(franchiseUser.merchant_count).to.equal(1);
    expect(merchantUser.franchise_details).to.deep.equal({
      name: 'Franchise Search',
      abheepay_id: 'APF00006',
    });
  });

  it('includes user service settings and effective flags in user search results', async () => {
    User.findAndCountAll = async () => ({
      count: 1,
      rows: [
        {
          id: 12,
          role: 'merchant',
          wallet: '250.00',
          is_payout_enabled: true,
          toJSON() {
            return { id: 12, role: 'merchant', wallet: '250.00', is_payout_enabled: true };
          }
        }
      ],
    });
    PosMachine.findAll = async () => [];
    ServiceSetting.findAll = async () => ([
      {
        service_key: 'cc_bill_pay',
        is_enabled: false,
        updated_by: 1,
        updatedAt: new Date('2026-04-07T10:00:00Z'),
      },
    ]);
    UserServiceSetting.findAll = async () => ([
      {
        user_id: 12,
        service_key: 'ba_cc_bill_pay',
        is_enabled: false,
      },
    ]);

    const res = await request(app)
      .get('/api/user/search?q=merchant')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.data[0].user_service_settings).to.deep.equal({
      vimo_payout: true,
      branchx_payout: true,
      cc_bill_pay: true,
      ba_cc_bill_pay: false,
    });
    expect(res.body.data[0].service_flags).to.deep.equal({
      vimo_payout: true,
      branchx_payout: true,
      cc_bill_pay: false,
      ba_cc_bill_pay: false,
    });
  });
  it('rejects employee user list access without permission', async () => {
    const res = await request(app)
      .get('/api/user')
      .set('Authorization', `Bearer ${noPermissionEmployeeToken}`);

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to list users/i);
  });

  it('allows employee with users.read permission to view a user', async () => {
    User.findByPk = async () => ({
      id: 22,
      role: 'employee',
      franchaise_id: null,
    });

    const res = await request(app)
      .get('/api/user/22')
      .set('Authorization', `Bearer ${employeeReadToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.user.id).to.equal(22);
  });

  it('returns user service settings and effective flags in user detail', async () => {
    User.findByPk = async () => ({
      id: 22,
      role: 'merchant',
      franchaise_id: null,
      is_payout_enabled: true,
      employee_access_role_id: null,
      toJSON() {
        return {
          id: 22,
          role: 'merchant',
          franchaise_id: null,
          is_payout_enabled: true,
          employee_access_role_id: null,
        };
      },
    });
    PosTransactionCharge.findAll = async () => [];
    PayoutCharge.findAll = async () => [];
    Rental.findAll = async () => [];
    ServiceSetting.findAll = async () => ([
      {
        service_key: 'vimo_payout',
        is_enabled: false,
        updated_by: 1,
        updatedAt: new Date('2026-04-07T10:00:00Z'),
      },
    ]);
    UserServiceSetting.findAll = async () => ([
      {
        user_id: 22,
        service_key: 'branchx_payout',
        is_enabled: false,
      },
    ]);

    const res = await request(app)
      .get('/api/user/22')
      .set('Authorization', `Bearer ${employeeReadToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.user.user_service_settings).to.deep.equal({
      vimo_payout: true,
      branchx_payout: false,
      cc_bill_pay: true,
      ba_cc_bill_pay: true,
    });
    expect(res.body.user.service_flags).to.deep.equal({
      vimo_payout: false,
      branchx_payout: false,
      cc_bill_pay: true,
      ba_cc_bill_pay: true,
    });
  });
  it('allows employee with ledger.manage permission to enable ledger tracking', async () => {
    const targetUser = {
      id: 77,
      start_ledger: false,
      save: async function () {
        return this;
      },
    };
    User.findByPk = async () => targetUser;

    const res = await request(app)
      .put('/api/user/77/enable-ledger')
      .set('Authorization', `Bearer ${employeeLedgerToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.start_ledger).to.equal(true);
  });
  it('allows employee with users.update permission to edit common fields only', async () => {
    const targetUser = {
      id: 42,
      role: 'merchant',
      permissions: [],
      email: 'merchant@example.com',
      mobile_number: '9000000009',
      update: async function (updates) {
        Object.assign(this, updates);
      },
      reload: async function () {
        return this;
      },
      toJSON() {
        return {
          id: this.id,
          role: this.role,
          name: this.name,
          email: this.email,
          permissions: this.permissions,
        };
      }
    };

    User.findByPk = async () => targetUser;
    User.findOne = async () => null;

    const res = await request(app)
      .put('/api/user/42')
      .set('Authorization', `Bearer ${employeeUpdateToken}`)
      .send({ name: 'Updated Merchant' });

    expect(res.status).to.equal(200);
    expect(res.body.data.name).to.equal('Updated Merchant');
  });
  it('allows employee with settlement permission to update settlement_type', async () => {
    const targetUser = {
      id: 55,
      role: 'merchant',
      settlement_type: 'today_settlement',
      update: async function (updates) {
        Object.assign(this, updates);
      },
      reload: async function () {
        return this;
      },
      toJSON() {
        return {
          id: this.id,
          role: this.role,
          settlement_type: this.settlement_type,
        };
      }
    };
    User.findByPk = async () => targetUser;
    ServiceToggleAuditLog.create = async () => ({});

    const res = await request(app)
      .put('/api/user/55')
      .set('Authorization', `Bearer ${employeeSettlementToken}`)
      .send({ settlement_type: 'next_day_settlement' });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.settlement_type).to.equal('next_day_settlement');
  });

  it('allows settlement.manage without users.update to change only settlement fields', async () => {
    const targetUser = {
      id: 58,
      role: 'merchant',
      settlement_type: 'today_settlement',
      update: async function (updates) {
        Object.assign(this, updates);
      },
      reload: async function () {
        return this;
      },
      toJSON() {
        return {
          id: this.id,
          role: this.role,
          settlement_type: this.settlement_type,
        };
      },
    };
    User.findByPk = async () => targetUser;
    ServiceToggleAuditLog.create = async () => ({});

    const res = await request(app)
      .put('/api/user/58')
      .set('Authorization', `Bearer ${employeeSettlementManageOnlyToken}`)
      .send({ settlement_type: 'next_day_settlement' });

    expect(res.status).to.equal(200);
    expect(res.body.data.settlement_type).to.equal('next_day_settlement');
  });

  it('rejects employee settlement updates without permission', async () => {
    const targetUser = {
      id: 56,
      role: 'merchant',
      settlement_type: 'today_settlement',
      update: async function () {
        return this;
      },
      reload: async function () {
        return this;
      },
      toJSON() {
        return {
          id: this.id,
          role: this.role,
          settlement_type: this.settlement_type,
        };
      }
    };
    User.findByPk = async () => targetUser;

    const res = await request(app)
      .put('/api/user/56')
      .set('Authorization', `Bearer ${employeeUpdateToken}`)
      .send({ settlement_type: 'next_day_settlement' });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to manage settlement settings/i);
  });

  it('rejects employee T0 limit updates without settlement.manage', async () => {
    User.findByPk = async () => ({ id: 57, role: 'merchant' });

    const res = await request(app)
      .put('/api/user/57')
      .set('Authorization', `Bearer ${employeeUpdateToken}`)
      .send({ t0_daily_limit: 50000 });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/permission to manage settlement settings/i);
  });

  it('rejects employee attempts to change role or access controls', async () => {
    User.findByPk = async () => ({
      id: 42,
      role: 'merchant',
      permissions: [],
      email: 'merchant@example.com',
      mobile_number: '9000000009',
    });

    const res = await request(app)
      .put('/api/user/42')
      .set('Authorization', `Bearer ${employeeUpdateToken}`)
      .send({ role: 'employee' });

    expect(res.status).to.equal(403);
    expect(res.body.message).to.match(/only admins can update role or employee access controls/i);
  });

  it('allows admin to promote an employee to admin', async () => {
    const targetUser = {
      id: 99,
      role: 'employee',
      employee_access_role_id: 3,
      permissions: ['users.read'],
      update: async function (updates) {
        Object.assign(this, updates);
      },
      reload: async function () {
        return this;
      },
      toJSON() {
        return {
          id: this.id,
          role: this.role,
          employee_access_role_id: this.employee_access_role_id,
          permissions: this.permissions,
        };
      },
    };

    User.findByPk = async () => targetUser;

    const res = await request(app)
      .post('/api/user/99/promote-to-admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.equal(true);
    expect(res.body.data.role).to.equal('admin');
    expect(res.body.data.employee_access_role_id).to.equal(null);
    expect(res.body.data.permissions).to.deep.equal([]);
  });

  it('rejects admin promotion for non-employee users', async () => {
    User.findByPk = async () => ({
      id: 100,
      role: 'merchant',
    });

    const res = await request(app)
      .post('/api/user/100/promote-to-admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).to.equal(400);
    expect(res.body.message).to.match(/only employee users can be promoted to admin/i);
  });

  it('allows employee with users.status.update permission to soft deactivate a user', async () => {
    const targetUser = {
      id: 42,
      status: 'active',
      is_payout_enabled: true,
      save: async function () {
        return this;
      }
    };

    User.findByPk = async () => targetUser;

    const res = await request(app)
      .put('/api/user/42/status')
      .set('Authorization', `Bearer ${employeeStatusToken}`)
      .send({ status: 'inactive' });

    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('inactive');
  });
});
