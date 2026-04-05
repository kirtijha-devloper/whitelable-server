const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'test-secret';

const sendOtpUtils = require('../utils/sendOtp');
const mailUtils = require('../utils/mail');
sendOtpUtils.sendRegistrationSms = async () => ({ success: true });
mailUtils.sendMail = async () => ({ accepted: ['test@example.com'] });

const userRoutes = require('../routes/userRoutes');
const User = require('../models/User');
const UsernameSequence = require('../models/UsernameSequence');
const Tpin = require('../models/Tpin');
const PosMachine = require('../models/posMachine');
const PosTransactionCharge = require('../models/PosTransactionCharge');
const PayoutCharge = require('../models/PayoutCharge');
const Rental = require('../models/Rental');
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

const adminToken = makeToken({ id: 1, role: 'admin', name: 'Admin' });
const franchiseToken = makeToken({ id: 5, role: 'franchaise', name: 'Franchise' });
const employeeListToken = makeToken({
  id: 7,
  role: 'employee',
  name: 'Employee',
  permissions: [EMPLOYEE_PERMISSIONS.USERS_LIST],
});
const employeeReadToken = makeToken({
  id: 7,
  role: 'employee',
  name: 'Employee',
  permissions: [EMPLOYEE_PERMISSIONS.USERS_READ],
});
const employeeUpdateToken = makeToken({
  id: 7,
  role: 'employee',
  name: 'Employee',
  permissions: [EMPLOYEE_PERMISSIONS.USERS_UPDATE],
});
const employeeStatusToken = makeToken({
  id: 7,
  role: 'employee',
  name: 'Employee',
  permissions: [EMPLOYEE_PERMISSIONS.USERS_STATUS_UPDATE],
});
const employeeCreateToken = makeToken({
  id: 7,
  role: 'employee',
  name: 'Employee',
  permissions: [EMPLOYEE_PERMISSIONS.USERS_CREATE],
});
const noPermissionEmployeeToken = makeToken({
  id: 7,
  role: 'employee',
  name: 'Employee',
  permissions: [],
});

let stubs = {};

beforeEach(() => {
  stubs = {
    userFindAndCountAll: User.findAndCountAll,
    userFindByPk: User.findByPk,
    userFindOne: User.findOne,
    userCreate: User.create,
    usernameSequenceFindOne: UsernameSequence.findOne,
    usernameSequenceCreate: UsernameSequence.create,
    tpinFindOne: Tpin.findOne,
    posMachineFindAll: PosMachine.findAll,
    posTxnChargeFindAll: PosTransactionCharge.findAll,
    payoutChargeFindAll: PayoutCharge.findAll,
    rentalFindAll: Rental.findAll,
    ledgerGetAvailableBalance: ledgerService.getAvailableBalance,
    dbTransaction: db.transaction,
  };
});

afterEach(() => {
  User.findAndCountAll = stubs.userFindAndCountAll;
  User.findByPk = stubs.userFindByPk;
  User.findOne = stubs.userFindOne;
  User.create = stubs.userCreate;
  UsernameSequence.findOne = stubs.usernameSequenceFindOne;
  UsernameSequence.create = stubs.usernameSequenceCreate;
  Tpin.findOne = stubs.tpinFindOne;
  PosMachine.findAll = stubs.posMachineFindAll;
  PosTransactionCharge.findAll = stubs.posTxnChargeFindAll;
  PayoutCharge.findAll = stubs.payoutChargeFindAll;
  Rental.findAll = stubs.rentalFindAll;
  ledgerService.getAvailableBalance = stubs.ledgerGetAvailableBalance;
  db.transaction = stubs.dbTransaction;
});

describe('Employee role on user routes', () => {
  it('allows admin to create an employee with permissions and no bank passbook', async () => {
    User.findOne = async () => null;
    UsernameSequence.findOne = async () => null;
    UsernameSequence.create = async () => ({ current_value: 1, save: async function () { return this; } });
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
        permissions: JSON.stringify([EMPLOYEE_PERMISSIONS.USERS_LIST, EMPLOYEE_PERMISSIONS.USERS_READ]),
      });

    expect(res.status).to.equal(201);
    expect(res.body.user.role).to.equal('employee');
    expect(res.body.user.username).to.equal('APE00001');
    expect(res.body.user.permissions).to.deep.equal([
      EMPLOYEE_PERMISSIONS.USERS_LIST,
      EMPLOYEE_PERMISSIONS.USERS_READ,
    ]);
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

  it('allows an employee with users.create to create a merchant user', async () => {
    User.findOne = async () => null;
    UsernameSequence.findOne = async () => null;
    UsernameSequence.create = async () => ({ current_value: 1, save: async function () { return this; } });
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
      permissions: [EMPLOYEE_PERMISSIONS.USERS_LIST],
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
    Tpin.findOne = async () => null;
    ledgerService.getAvailableBalance = async () => 450;

    const res = await request(app)
      .get('/api/user/current')
      .set('Authorization', `Bearer ${employeeListToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.role).to.equal('employee');
    expect(res.body.permissions).to.deep.equal([EMPLOYEE_PERMISSIONS.USERS_LIST]);
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

  it('rejects employee attempts to change role or permissions', async () => {
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
    expect(res.body.message).to.match(/only admins can update role or permissions/i);
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
